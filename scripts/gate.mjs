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
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
  const r = spawnSync(resolverEjecutable(argv[0]), argv.slice(1), {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: false,
  });
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
registrar(veredicto);
regenerarPanel();

if (corridas === 0) {
  console.log("GATE ROJO — ninguna señal llegó a correr: todas quedaron omitidas.");
  console.log("Revisá `gate.signals` en el config (rutas de `skipIfMissing`, `fastSkip` de más).");
  process.exit(1);
}

if (fallidas.length) {
  console.log(`GATE ROJO — señales fallidas: ${fallidas.join(" ")}`);
  console.log("Leé el error real (archivo, línea, mensaje) antes de reintentar. Presupuesto: 2 intentos sobre el mismo error.");
  process.exit(1);
}

if (MODE === "fast") {
  console.log("GATE FAST VERDE — señal de desarrollo. NO es entregable: faltan las señales lentas.");
  process.exit(0);
}

console.log("GATE VERDE — entregable.");

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
    senalesReg[nombre] = { ...res, fecha, ultimoVerde: res.estado === "verde" ? { fecha, head, ms: res.ms } : antes };
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
