#!/usr/bin/env node
/**
 * El gate: única definición de "entregable".
 *
 * Está en Node y no en bash por una razón concreta: **el arnés tiene que correr en Windows**.
 * El resto del arnés ya lo hacía (los hooks son `node`), pero el entregable dependía de un
 * intérprete que en Windows no está garantizado — y un gate que no corre es un gate que no
 * existe. `scripts/gate.sh` sigue existiendo como envoltorio de una línea para no romper a
 * quien ya lo invoca: la implementación es ésta y es una sola.
 *
 *   node scripts/gate.mjs          todas las señales (entregable)
 *   node scripts/gate.mjs fast     omite las marcadas `fastSkip`
 *                                  → señal de DESARROLLO, no entregable
 *
 * Genérico a propósito: no sabe de stacks. Las señales se declaran en
 * `.claude/harness.config.json` → `gate.signals`, así que portarlo a un repo de Go, Python o
 * Java es editar JSON.
 *
 * Contrato de cada señal en el config:
 *   name           lo que se imprime
 *   command        array argv (["npm","run","test"]) — sin shell, sin comillas mágicas
 *   why            por qué esta señal no la cubre otra (documentación, no se ejecuta)
 *   fastSkip       true = se omite en modo fast
 *   skipIfMissing  ruta que, si no existe, hace que la señal se reporte OMITIDA en vez de
 *                  fallar (herramienta local no instalada, índice ausente en CI).
 *                  "Omitido" se imprime SIEMPRE: nunca se confunde con "pasó".
 *
 * Ciclo acotado (`loop` en el config, opcional): el gate es el único que VE el resultado de
 * cada intento, así que es el que los cuenta. Ver `contarIntentos` al final.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolverEjecutable } from "../.claude/hooks/harness.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CONFIG_PATH = path.join(REPO_ROOT, ".claude", "harness.config.json");
const MODE = process.argv[2] ?? "full";

/** Un gate que no puede leer su config no verifica nada: eso es rojo, no verde. */
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
} catch (e) {
  const falta = e.code === "ENOENT";
  console.log(
    falta
      ? `GATE ROJO — falta ${path.relative(REPO_ROOT, CONFIG_PATH)}: el arnés no está configurado.`
      : `GATE ROJO — config inválido: ${path.relative(REPO_ROOT, CONFIG_PATH)} (${e.message})`,
  );
  process.exit(1);
}

const senales = config.gate?.signals ?? [];
if (!senales.length) {
  console.log("GATE ROJO — `gate.signals` está vacío: el gate no verifica nada.");
  process.exit(1);
}

const nombreRepo = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).name;
  } catch {
    return path.basename(REPO_ROOT);
  }
})();

console.log(`Gate (modo: ${MODE}) — ${nombreRepo}`);

// El libro de intentos se lee ANTES de correr las señales: una señal puede tocar el estado de la
// sesión (el self-test corre `ask-first`, que repone el presupuesto), y leerlo al final contaba
// cada corrida como la primera — el freno quedaba muerto justo en el repo que lo prueba.
//
// Un `loop` a medio escribir (sin libro, sin marcador, un máximo que no es número) se trata como
// ausente: contar sin poder anotar imprimiría un presupuesto que no existe (P5: lo roto deja pasar).
const loop = (() => {
  const max = Number(config.loop?.maxAttempts);
  if (!Number.isFinite(max) || max < 1 || !config.loop?.ledger || !config.loop?.marker) return null;
  return { ...config.loop, maxAttempts: Math.floor(max) };
})();
const libroPrevio = loop ? leerLibro() : {};
let libroActual = {};

/**
 * Lo que se borra de la salida antes de compararla: lo que cambia entre dos corridas aunque el
 * error sea el mismo. Sin esto, mover una línea cambiaba `a.js:12` por `a.js:13`, la huella
 * salía distinta y el contador volvía a 1 para siempre — un freno que nunca muerde.
 *
 * Deliberadamente NO borra cualquier número: «3 tests fallan» → «2 tests fallan» es progreso, y
 * contarlo como el mismo error frenaría a quien está avanzando.
 */
const RUIDO_POR_DEFECTO = [
  "\\x1b\\[[0-9;]*[A-Za-z]", //                                   colores ANSI
  "\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:?\\d{2})?", // fechas ISO
  "\\b\\d+(\\.\\d+)?\\s?(ms|s|sec|segundos|seconds)\\b", //            duraciones
  ":\\d+(:\\d+)?\\b", //                                          línea:columna
  "\\b[0-9a-f]{7,64}\\b", //                                         hashes
  "\\S*(tmp|temp|Temp|TEMP)[\\\\/]\\S*", //                             rutas temporales con nombre
  // …y el temporal de ESTA máquina, que no siempre se llama así: en macOS es `/var/folders/…/T`
  // (y `/private/var/…` resuelto). Sale de `os.tmpdir()` en vez de una lista de sistemas operativos.
  ...[...new Set([os.tmpdir(), realSiExiste(os.tmpdir())])].map((d) => `${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\\\/]?\\S*`),
];

function realSiExiste(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

const fallidas = [];
const duraciones = [];
const omitidas = [];
let corridas = 0;
// Lo que corrió EN ESTA MÁQUINA, por señal: lo escribe `registrar` y lo lee el panel. Sin esto,
// el panel sólo podía repetir lo que dice STATUS.md, que es prosa con fecha.
const resultados = {};
const inicio = new Date();

for (const senal of senales) {
  const argv = senal.command;
  if (!Array.isArray(argv) || !argv.length) {
    console.log(`\nGATE ROJO — señal sin command: ${senal.name}`);
    process.exit(1);
  }

  if (MODE === "fast" && senal.fastSkip) {
    console.log(`\n──▶ ${senal.name}\n    – omitida en modo fast`);
    omitidas.push(senal.name);
    resultados[senal.name] = { estado: "omitida", motivo: "modo fast" };
    continue;
  }

  if (senal.skipIfMissing && !fs.existsSync(path.join(REPO_ROOT, senal.skipIfMissing))) {
    console.log(`\n──▶ ${senal.name}\n    – OMITIDA: no existe \`${senal.skipIfMissing}\` (omitido ≠ pasó)`);
    omitidas.push(senal.name);
    resultados[senal.name] = { estado: "omitida", motivo: `no existe ${senal.skipIfMissing}` };
    continue;
  }

  console.log(`\n──▶ ${senal.name}`);
  // `shell: false` es deliberado: ningún dato del config se interpola en una línea de
  // comandos. En Windows, los lanzadores `.cmd`/`.bat` (npm, npx, gradlew) sólo se pueden
  // ejecutar a través del shell, así que ESOS —y sólo ésos— se resuelven a su archivo real.
  const t0 = process.hrtime.bigint();
  const r = await correr(resolverEjecutable(argv[0]), argv.slice(1));
  // Cuánto tardó cada señal. Sin el número, «el gate tarda» es una sensación, y la discusión
  // termina sacando la señal que a alguien le molesta en vez de la que cuesta. Con el número
  // se discute la cara, y `fastSkip` se decide con datos.
  const ms = Math.round(Number(process.hrtime.bigint() - t0) / 1e6);
  duraciones.push({ name: senal.name, ms });
  corridas += 1;

  if (r.error?.code === "ENOENT") {
    console.log(`    ✗ ${senal.name} — no encontré el ejecutable \`${argv[0]}\``);
    fallidas.push(senal.name);
    resultados[senal.name] = { estado: "rojo", ms, motivo: `no existe el ejecutable ${argv[0]}` };
  } else if (r.status === 0) {
    console.log(`    ✓ ${senal.name} (${ms} ms)`);
    resultados[senal.name] = { estado: "verde", ms };
  } else {
    console.log(`    ✗ ${senal.name} (${ms} ms)`);
    fallidas.push(senal.name);
    resultados[senal.name] = { estado: "rojo", ms, motivo: `salió con ${r.status}` };
  }
  if (r.cola !== undefined) resultados[senal.name].cola = r.cola;
}

console.log("");
if (omitidas.length) console.log(`Señales omitidas (NO son verde): ${omitidas.join(" ")}`);
if (duraciones.length) {
  const total = duraciones.reduce((a, d) => a + d.ms, 0);
  const caras = [...duraciones].sort((a, b) => b.ms - a.ms).slice(0, 3);
  const fmt = (d) => `${d.name} ${(d.ms / 1000).toFixed(1)}s`;
  console.log(`Tiempo: ${(total / 1000).toFixed(1)}s en ${duraciones.length} señal(es) — las más caras: ${caras.map(fmt).join(' · ')}`);
}

// Un gate donde NO corrió ninguna señal no es verde: es un gate que no existe. Pasó una vez
// (un separador de campos mal elegido omitía todo) y reportó "entregable".
const veredicto = corridas === 0 || fallidas.length ? "rojo" : MODE === "fast" ? "fast-verde" : "verde";
if (veredicto === "verde") {
  const marcador = config.gate?.marker;
  if (marcador) fs.rmSync(path.join(REPO_ROOT, marcador), { force: true });
}
const agotadas = loop ? contarIntentos() : [];
registrar(veredicto);
regenerarPanel();

if (corridas === 0) {
  console.log("GATE ROJO — ninguna señal llegó a correr: todas quedaron omitidas.");
  console.log("Revisá `gate.signals` en el config (rutas de `skipIfMissing`, `fastSkip` de más).");
  process.exit(1);
}

if (fallidas.length) {
  console.log(`GATE ROJO — señales fallidas: ${fallidas.join(" ")}`);
  if (agotadas.length) {
    console.log(
      [
        `PRESUPUESTO AGOTADO — el mismo error, ${agotadas.map((a) => `${a.senal} ${a.intentos} veces`).join(" · ")} (loop.maxAttempts = ${loop.maxAttempts}).`,
        "PARÁ. Otro intento sin hipótesis nueva es el bucle que el arnés existe para cortar.",
        "Escalá al humano con el diagnóstico: qué falla (archivo, línea, mensaje), qué probaste y por qué no anduvo, y tu próxima hipótesis.",
        "Las ediciones dentro del repo quedan frenadas hasta que el humano conteste.",
      ].join("\n"),
    );
  } else if (loop) {
    const intentos = fallidas.map((n) => libroActual[n]?.intentos).filter(Boolean);
    console.log(`Leé el error real (archivo, línea, mensaje) antes de reintentar. Mismo error ${Math.max(...intentos, 1)} vez/veces de ${loop.maxAttempts + 1}: a la ${loop.maxAttempts + 1}ª se para y se escala. Reintentá sólo con hipótesis nueva.`);
  } else {
    console.log("Leé el error real (archivo, línea, mensaje) antes de reintentar. Presupuesto: 2 intentos sobre el mismo error.");
  }
  // `exitCode` y no `process.exit(1)`: con la salida de las señales reenviada por pipe, salir en
  // seco puede cortar lo último que se escribió (stdout a un pipe es asíncrono en macOS), y lo
  // último es justo el error que el agente tiene que leer.
  process.exitCode = 1;
} else if (MODE === "fast") {
  console.log("GATE FAST VERDE — señal de desarrollo. NO es entregable: faltan las señales lentas.");
} else {
  console.log("GATE VERDE — entregable.");
}

/**
 * El registro de la corrida (`gate.registry`, default `.git/harness-gate.json`): por señal, su
 * último resultado y su último verde. Va en `.git/` porque es de ESTA máquina y no se versiona.
 * Escribirlo nunca cambia el veredicto: un registro que no se pudo escribir es un panel con menos
 * datos, no un gate rojo.
 */
function registrar(veredicto) {
  const rel = config.gate?.registry ?? ".git/harness-gate.json";
  const abs = path.join(REPO_ROOT, rel);
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  let previo = {};
  try {
    previo = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    previo = {};
  }
  const fecha = new Date().toISOString();
  const head = git("rev-parse", "--short", "HEAD");
  const senalesReg = { ...(previo.senales ?? {}) };
  for (const [nombre, res] of Object.entries(resultados)) {
    const antes = senalesReg[nombre]?.ultimoVerde ?? null;
    const { cola: _cola, ...sinCola } = res;
    senalesReg[nombre] = { ...sinCola, fecha, ultimoVerde: res.estado === "verde" ? { fecha, head, ms: res.ms } : antes };
  }
  const registro = { fecha, modo: MODE, veredicto, ms: Date.now() - inicio.getTime(), head, rama: git("rev-parse", "--abbrev-ref", "HEAD"), senales: senalesReg };
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(registro, null, 2) + "\n");
  } catch (e) {
    console.log(`  (no pude escribir el registro ${rel}: ${e.message})`);
  }
}

/**
 * El panel se regenera en CADA corrida, verde o roja: un panel que hay que acordarse de
 * regenerar es un panel viejo, y el gate es el momento en que la salud cambia.
 *
 * En un PROCESO HIJO y con tiempo límite, y su exit code se ignora: el panel no puede decidir el
 * veredicto. Lo cazó el reviewer con el panel importado en este proceso —un `process.exit(0)` ahí
 * adentro volvía verde a un gate rojo y borraba el marcador, y un panel colgado colgaba al gate—.
 * Que el panel genere lo verifica el self-test, no el gate (P5: lo roto deja pasar, no decide).
 */
function regenerarPanel() {
  const script = path.join(REPO_ROOT, "scripts/panel/generar.mjs");
  if (config.panel?.enabled === false) return;
  if (!fs.existsSync(script)) {
    console.log("Panel: no instalado (falta scripts/panel/).");
    return;
  }
  const timeout = Number.isFinite(config.panel?.timeoutMs) ? config.panel.timeoutMs : 60000;
  const r = spawnSync(process.execPath, [script], { cwd: REPO_ROOT, encoding: "utf8", timeout, windowsHide: true });
  if (r.error?.code === "ETIMEDOUT") console.log(`Panel: no terminó en ${timeout} ms (\`panel.timeoutMs\`). El veredicto del gate no cambia.`);
  else if (r.status !== 0) console.log(`Panel: no se pudo generar (${`${r.stderr || r.stdout}`.trim().split("\n")[0] || `exit ${r.status}`}). El veredicto del gate no cambia.`);
  else process.stdout.write(r.stdout);
}

/**
 * Corre una señal. Sin `loop`, con `stdio: "inherit"` como siempre: el gate de un repo que no
 * pidió contar intentos no cambia ni un byte. Con `loop`, la salida se reenvía MIENTRAS sale (una
 * señal de un minuto no se queda muda) y se guarda la cola, que es de donde sale la huella.
 *
 * `shell: false` es deliberado: ningún dato del config se interpola en una línea de comandos.
 * En Windows, los lanzadores `.cmd`/`.bat` (npm, npx, gradlew) sólo se pueden ejecutar a través
 * del shell, así que ESOS —y sólo ésos— se resuelven a su archivo real (`resolverEjecutable`).
 */
function correr(cmd, args) {
  return new Promise((resolve) => {
    const hijo = spawn(cmd, args, { cwd: REPO_ROOT, shell: false, stdio: loop ? ["inherit", "pipe", "pipe"] : "inherit" });
    let cola = "";
    const max = 64 * 1024; // la cola alcanza para la huella; el resto ya se imprimió
    const tee = (destino) => (trozo) => {
      destino.write(trozo);
      cola = (cola + trozo.toString("utf8")).slice(-max);
    };
    hijo.stdout?.on("data", tee(process.stdout));
    hijo.stderr?.on("data", tee(process.stderr));
    hijo.on("error", (error) => resolve({ status: null, error }));
    hijo.on("close", (status) => resolve({ status, ...(loop ? { cola } : {}) }));
  });
}


function huella(nombre, salida) {
  const patrones = Array.isArray(loop.normalize) && loop.normalize.length ? loop.normalize : RUIDO_POR_DEFECTO;
  let texto = String(salida ?? "");
  for (const p of patrones) {
    try {
      texto = texto.replace(new RegExp(p, "g"), "·");
    } catch {
      /* un patrón inválido lo caza el self-test; acá no puede tumbar el gate */
    }
  }
  const lineas = texto.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const cola = lineas.slice(-(Number(loop.tailLines) > 0 ? Number(loop.tailLines) : 40));
  return {
    huella: createHash("sha1").update(`${nombre}\n${cola.join("\n")}`).digest("hex").slice(0, 16),
    // La muestra es la salida CRUDA: al humano que recibe la escalada, «a.js·» no le dice nada.
    muestra: String(salida ?? "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-3).join(" ⏎ ").slice(0, 300),
  };
}

function leerLibro() {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, loop.ledger), "utf8"));
  } catch {
    return {};
  }
}


/**
 * Cuenta los intentos sobre el mismo error y, al agotarse el presupuesto, deja el marcador que
 * lee `action-guard` (frena editar) y `gate-stop` (deja cerrar para escalar).
 *
 *  - misma huella que la corrida anterior → un intento más;
 *  - huella distinta → 1: el error cambió, o sea hubo hipótesis nueva;
 *  - señal verde → se borra su cuenta; señal omitida → no se toca (omitido no es verde).
 *
 * Todo vive en `.git/` (P7) y escribirlo nunca cambia el veredicto: un libro que no se pudo
 * escribir es un freno menos esta vez, no un gate rojo.
 */
function contarIntentos() {
  const libro = { ...libroPrevio };
  const agotadas = [];
  for (const [nombre, res] of Object.entries(resultados)) {
    if (res.estado === "verde") delete libro[nombre];
    if (res.estado !== "rojo") continue;
    const h = huella(nombre, res.cola ?? res.motivo);
    const antes = libro[nombre];
    const intentos = antes?.huella === h.huella ? antes.intentos + 1 : 1;
    libro[nombre] = { huella: h.huella, intentos, desde: antes?.huella === h.huella ? antes.desde : new Date().toISOString(), muestra: h.muestra };
    if (intentos > loop.maxAttempts) agotadas.push({ senal: nombre, intentos, muestra: h.muestra });
  }
  libroActual = libro;
  try {
    const abs = path.join(REPO_ROOT, loop.ledger);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(libro, null, 2) + "\n");
    if (agotadas.length && loop.marker) {
      const marcador = path.join(REPO_ROOT, loop.marker);
      fs.mkdirSync(path.dirname(marcador), { recursive: true });
      fs.writeFileSync(marcador, `${new Date().toISOString()}\n${agotadas.map((a) => `${a.senal} (${a.intentos} intentos): ${a.muestra}`).join("\n")}\n`);
    }
  } catch (e) {
    console.log(`  (no pude escribir el libro de intentos ${loop.ledger}: ${e.message})`);
  }
  return agotadas;
}
