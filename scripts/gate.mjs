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
 *   node scripts/gate.mjs retry    corre SÓLO las señales que el registro de la última corrida
 *                                  (`gate.registry`) dejó en rojo, como un pipeline que se
 *                                  reanuda desde la etapa que falló; las demás conservan su
 *                                  resultado anterior → señal de DESARROLLO, no entregable:
 *                                  ese resultado es de OTRO árbol, el de antes del arreglo
 *   node scripts/gate.mjs changed  corre SÓLO las señales cuyo alcance (`paths` + los archivos de
 *                                  su `command`) toca lo que cambió desde el último gate COMPLETO;
 *                                  el ciclo para arreglar el arnés → señal de DESARROLLO, no
 *                                  entregable. `--plan` dice qué correría, sin correrlo.
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
 *   skipExitCode   código de salida (≠ 0) con el que la señal dice «en este checkout no hay nada
 *                  que verificar»: se reporta OMITIDA y no cuenta como corrida. Es para lo que
 *                  una sola ruta no alcanza a decidir (una suite acotada cuyo tsconfig vive en
 *                  otra rama). Cualquier otro código distinto de 0 sigue siendo rojo.
 *   lane           carril: las señales de un mismo carril corren EN SERIE (comparten árbol,
 *                  caché o artefactos); carriles distintos corren A LA VEZ cuando
 *                  `gate.lanes.max` > 1. Sin `lane`, la señal va al carril `principal`.
 *   exclusive      true = corre SOLA, después de todos los carriles (una medición de latencia
 *                  con la máquina ocupada mide la máquina, no el hook).
 *   paths          prefijos relativos a la raíz que hacen relevante a la señal en el modo
 *                  `changed`. Sin `paths`, la señal es relevante SIEMPRE (fail-safe).
 *   timeoutMinutes cuánto puede tardar antes de darla por COLGADA (roja, cortada con su árbol);
 *                  sin él rige `gate.signalTimeoutMinutes`; 0 = sin límite.
 *
 * Paralelismo (`gate.lanes.max`, default 1 = todo en serie, como siempre): el gate medía 15
 * minutos porque 27 señales corrían una detrás de otra sin compartir nada. Con carriles, la
 * salida de cada señal se captura y se imprime entera cuando termina, para que dos señales a
 * la vez no se mezclen línea a línea.
 *
 * Cerrojo (`gate.lock`, default `.git/gate.lock`; `false` lo apaga): dos gates a la vez sobre
 * el mismo árbol se pisan los artefactos (el mismo directorio de build) y los marcadores de sesión, y los
 * dos salen rojos sin que nada esté roto. El segundo ESPERA a que termine el primero
 * (`waitMinutes`, default 30) y, si el primero corrió completo sobre el mismo HEAD con el
 * árbol limpio, ADOPTA su veredicto en vez de repetirlo (`adopt: false` lo desactiva).
 *
 * Estados de una señal en el registro: `verde`, `rojo` (corrió y lo que mide falló), `omitida`
 * (no le tocaba correr) y `abortada` (NO llegó a medir: el proceso no arrancó o lo cortaron desde
 * afuera). Una abortada tiñe el veredicto —nada que no corrió es verde— pero no es un rojo de lo
 * que mide, no gasta el presupuesto del ciclo acotado y `retry` la vuelve a correr. Toda señal
 * que no queda verde lleva `motivo`: ver `diagnosticar`.
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
import { prepararLanzamiento, rutaDeEstado, isoLocal, DEFAULT_STATUS_JOURNAL } from "../.claude/hooks/harness.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CONFIG_PATH = path.join(REPO_ROOT, ".claude", "harness.config.json");
// El modo es el primer argumento que no es bandera: `npm run gate -- --no-cache` es el completo.
const MODE = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "full";
const SIN_CACHE = process.argv.includes("--no-cache");
if (!["full", "fast", "retry", "changed"].includes(MODE)) {
  console.log(`GATE ROJO — modo desconocido «${MODE}»: full (sin argumento), fast, retry o changed.`);
  process.exit(1);
}

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
// Toda señal se valida ANTES de correr la primera: con carriles en paralelo, abortar a mitad
// de camino por una señal mal declarada dejaría procesos hijos huérfanos y artefactos a medias.
for (const senal of senales) {
  if (!Array.isArray(senal.command) || !senal.command.length) {
    console.log(`GATE ROJO — señal sin command: ${senal.name}`);
    process.exit(1);
  }
  // Un `paths` mal escrito no puede volverse «esta señal nunca es relevante»: eso es un freno
  // apagado en silencio en el modo changed. Mal formado = rojo, antes de correr nada.
  if (senal.paths !== undefined && (!Array.isArray(senal.paths) || senal.paths.some((p) => typeof p !== "string" || !p.trim()))) {
    console.log(`GATE ROJO — \`paths\` de «${senal.name}» tiene que ser una lista de rutas (prefijos relativos a la raíz).`);
    process.exit(1);
  }
  if (senal.timeoutMinutes !== undefined && !(Number.isFinite(senal.timeoutMinutes) && senal.timeoutMinutes >= 0)) {
    console.log(`GATE ROJO — \`timeoutMinutes\` de «${senal.name}» tiene que ser un número ≥ 0 (0 = sin límite).`);
    process.exit(1);
  }
  // 0 convertiría un verde en «omitida»: eso no es configuración, es apagar la señal.
  // …y 1 es el código de CUALQUIER fallo (una excepción sin atrapar, un `exit 1` genérico): con
  // él, todo rojo de la señal saldría «omitida». Tiene que ser un código que el script elija.
  if (senal.skipExitCode !== undefined && !(Number.isInteger(senal.skipExitCode) && senal.skipExitCode > 1)) {
    console.log(`GATE ROJO — skipExitCode inválido en «${senal.name}»: ${JSON.stringify(senal.skipExitCode)} (tiene que ser un entero mayor que 1: 0 es «pasó» y 1 es el fallo genérico)`);
    process.exit(1);
  }
}

/** Cuántos carriles corren a la vez. 1 (o sin `lanes`) = el gate de siempre, en serie. */
const CARRILES = (() => {
  const max = Number(config.gate?.lanes?.max);
  return Number.isFinite(max) && max >= 1 ? Math.trunc(max) : 1;
})();
const PARALELO = CARRILES > 1;

/** El cerrojo: `gate.lock` con `file`, `waitMinutes`, `pollMs`, `adopt`; `false` lo apaga. */
const CERROJO = (() => {
  const l = config.gate?.lock;
  if (l === false) return null;
  const minutos = Number(l?.waitMinutes);
  const sondeo = Number(l?.pollMs);
  return {
    file: typeof l?.file === "string" && l.file ? l.file : ".git/gate.lock",
    esperaMs: (Number.isFinite(minutos) && minutos >= 0 ? minutos : 30) * 60000,
    sondeoMs: Number.isFinite(sondeo) && sondeo > 0 ? sondeo : 10000,
    adopta: l?.adopt !== false,
  };
})();

/**
 * Los REPOS ANIDADOS (`gate.nestedRepos`): carpetas de la raíz cuyas subcarpetas son repos de git
 * propios que la raíz no versiona (un workspace con clones adentro). Para la raíz son invisibles
 * —`git diff` no entra—, así que sin declararlos el modo changed y la caché darían por «sin
 * cambios» justo el código que más cambia. Default: ninguno; un repo común no los tiene.
 * Va acá arriba y no junto a quien lo usa: `changed` elige las señales antes de llegar allá.
 */
const ANIDADOS = (Array.isArray(config.gate?.nestedRepos) ? config.gate.nestedRepos : [])
  .filter((d) => typeof d === "string" && d.trim())
  .map((d) => d.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, ""));
/** Toda llamada a git que LISTA rutas las pide tal cual son: ver `archivosCambiados`. */
const SIN_COMILLAS = ["-c", "core.quotepath=false"];
/** ¿`f` vive dentro de uno de estos repos anidados? (`f` puede ser el repo entero, con `/` final). */
const dentroDeClon = (f, clones) => clones.some((c) => f === `${c}/` || f.startsWith(`${c}/`));
/** ¿`p` cae bajo una carpeta declarada en `gate.nestedRepos`? */
const bajoAnidados = (p) => ANIDADOS.some((d) => p.startsWith(`${d}/`));

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
  // …y con el nombre ANTES del número, como las imprime el runner: `duration_ms 108.15` (node:test),
  // `Time: 3.2`, `elapsed=0.4`. Sin esto, el runner por defecto de Node cambiaba la huella en cada
  // corrida y el ciclo acotado no mordía nunca (lo cazó el taller).
  "\\b\\w*(duration|elapsed|time|took)\\w*[\\s:=]+\\d+(\\.\\d+)?", // duraciones con el nombre delante
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
// Las que no llegaron a medir (ver `diagnosticar`): tiñen el veredicto, pero no son un rojo.
const abortadas = [];
let corridas = 0;
// Lo que corrió EN ESTA MÁQUINA, por señal: lo escribe `registrar` y lo lee el panel. Sin esto,
// el panel sólo podía repetir lo que dice STATUS.md, que es prosa con fecha.
const resultados = {};
const inicio = new Date();
/** El árbol sobre el que se va a medir, visto ANTES de la primera señal (lo usa `registrar`). */
const arranque = (() => {
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  return { head: git("rev-parse", "--short", "HEAD"), limpio: git("status", "--porcelain") === "" };
})();

// El cerrojo va antes de la primera señal y se suelta al salir, pase lo que pase.
const espera = CERROJO ? await tomarCerrojo() : null;
if (espera && CERROJO.adopta) {
  const adoptado = veredictoAdoptable(espera);
  if (adoptado) {
    console.log(
      `VEREDICTO ADOPTADO — el gate que esperé (PID ${espera.pid}) terminó a las ${adoptado.fecha} sobre este mismo HEAD (${adoptado.head}) con el árbol limpio: ${adoptado.veredicto === "verde" ? "VERDE — entregable." : "ROJO."}\nNo se vuelve a correr: medir dos veces el mismo árbol no cambia el veredicto.`,
    );
    soltarCerrojo();
    process.exit(adoptado.veredicto === "verde" ? 0 : 1);
  }
}

/**
 * Qué corre en esta corrida. En `retry`, sólo lo que el registro de la última corrida dejó en
 * rojo: el resto conserva su resultado, y el veredicto lo dice. Sin registro no hay desde dónde
 * reanudar; sin rojos, no hay qué reintentar.
 */
const previa = MODE === "retry" || MODE === "changed" ? leerRegistro() : null;
const reutilizadas = [];
const aCorrer = (() => {
  if (MODE === "changed") return seleccionarPorCambios();
  if (MODE !== "retry") return senales;
  if (!previa?.senales) {
    console.log(`GATE ROJO — no hay corrida previa que reintentar (falta ${config.gate?.registry ?? ".git/harness-gate.json"}): corré \`${config.gate?.command ?? "node scripts/gate.mjs"}\` completo.`);
    soltarCerrojo();
    process.exit(1);
  }
  // Una abortada tampoco midió nada: se reanuda igual que una roja.
  const rojas = senales.filter((s) => ["rojo", "abortada"].includes(previa.senales[s.name]?.estado));
  for (const s of senales) if (!rojas.includes(s)) reutilizadas.push({ name: s.name, estado: previa.senales[s.name]?.estado ?? "sin registro" });
  if (!rojas.length) {
    console.log(`GATE RETRY — nada que reintentar: la corrida de ${previa.fecha ?? "?"} (${previa.head ?? "?"}) no dejó señales rojas ni abortadas. Para entregar, \`${config.gate?.command ?? "node scripts/gate.mjs"}\` completo.`);
    soltarCerrojo();
    process.exit(0);
  }
  console.log(`Retry: ${rojas.length} señal(es) rojas o abortadas de la corrida de ${previa.fecha ?? "?"} (${previa.head ?? "?"}) — ${rojas.map((s) => s.name).join(" · ")}. Las otras ${reutilizadas.length} conservan su resultado.`);
  return rojas;
})();

/**
 * CHANGED: corre sólo las señales cuyo alcance toca lo que cambió desde el último gate COMPLETO.
 * Arreglar un hook costaba el gate entero, con las suites lentas del producto incluidas, que no
 * leen ni una línea del arnés (21 min en el repo donde se midió).
 *
 * El alcance de una señal es `paths` (prefijos relativos a la raíz) más los archivos de su propio
 * `command`. Una señal SIN `paths` es relevante siempre: lo que no declaró su alcance corre (fail
 * safe), y por eso las baratas no lo declaran. Lo que cambió es el diff de la raíz contra el HEAD
 * del último gate completo (más lo no versionado) y, en cada repo anidado (`gate.nestedRepos`), su
 * diff contra el HEAD que tenía en ese gate más lo no versionado: la raíz no los versiona.
 *
 * Señal de DESARROLLO, como retry: el resto conserva el resultado de la última corrida, y una roja
 * que el cambio no toca se reporta como tal (no se esconde) pero no tiñe este veredicto.
 */
function seleccionarPorCambios() {
  const completa = previa?.ultimaCompleta ?? (previa?.modo === "full" ? { head: previa.head } : null);
  const base = completa?.head ?? null;
  const candidatos = archivosCambiados(base, completa?.clones ?? {});
  // Lo que ya estaba sucio cuando corrió el gate completo, y sigue igual byte a byte, ya se midió:
  // sin las huellas, 28 archivos sin commitear de hace días volvían relevante casi todo el gate.
  const huellas = completa?.huellas ?? {};
  const cambiados = candidatos && candidatos.filter((f) => huellas[f] === undefined || huellas[f] !== huellaDe(f));
  if (cambiados === null) {
    console.log(`GATE ROJO — no pude leer qué cambió (git no responde en la raíz): corré \`${config.gate?.command ?? "node scripts/gate.mjs"}\` completo.`);
    soltarCerrojo();
    process.exit(1);
  }
  const desde = base ? `el último gate completo (${base})` : "HEAD (no hay registro de un gate completo)";
  if (!cambiados.length) {
    console.log(`GATE CHANGED — nada cambió desde ${desde}: no hay qué verificar. Para entregar, \`${config.gate?.command ?? "node scripts/gate.mjs"}\` completo.`);
    soltarCerrojo();
    process.exit(0);
  }
  const elegidas = senales.filter((s) => esRelevante(s, cambiados));
  for (const s of senales) if (!elegidas.includes(s)) reutilizadas.push({ name: s.name, estado: previa?.senales?.[s.name]?.estado ?? "sin registro" });
  const muestra = cambiados.slice(0, 8).join(" · ") + (cambiados.length > 8 ? ` · …(+${cambiados.length - 8})` : "");
  console.log(`Changed: ${cambiados.length} archivo(s) cambiados desde ${desde} — ${muestra}`);
  // Todas declaran `paths` y ninguno toca lo cambiado: no hay nada que correr, y decir «todas
  // quedaron omitidas, revisá el config» mandaba a buscar un defecto que no existe.
  if (!elegidas.length) {
    console.log(`GATE CHANGED — lo cambiado no toca el alcance (\`paths\`) de ninguna señal: no hay qué verificar. Para entregar, \`${config.gate?.command ?? "node scripts/gate.mjs"}\` completo.`);
    soltarCerrojo();
    process.exit(0);
  }
  console.log(`Corren ${elegidas.length} de ${senales.length} señales; las otras ${reutilizadas.length} no tocan lo cambiado y conservan su resultado.`);
  if (process.argv.includes("--plan")) {
    console.log(`\nCorrerían:\n${elegidas.map((s) => `  ▶ ${s.name}${s.paths ? "" : "  (sin paths: siempre)"}`).join("\n")}`);
    console.log(`No correrían:\n${reutilizadas.map((r) => `  · ${r.name} — conserva ${r.estado}`).join("\n")}`);
    soltarCerrojo();
    process.exit(0);
  }
  return elegidas;
}

/** Prefijos de una señal: los `paths` declarados + los archivos que su `command` ejecuta. */
function alcanceDe(senal) {
  if (!Array.isArray(senal.paths) || !senal.paths.length) return null; // sin alcance = siempre
  const propios = senal.command.filter((a) => /[\\/]/.test(a) && fs.existsSync(path.join(REPO_ROOT, a)));
  return [...senal.paths, ...propios].map((p) => p.replace(/\\/g, "/").replace(/^\.\//, ""));
}

function esRelevante(senal, cambiados) {
  const alcance = alcanceDe(senal);
  if (!alcance) return true;
  // Un árbol FUERA del repo (`../…`) no entra en el diff: la señal se considera relevante y la
  // caché por huella de entradas decide si de verdad hay que correrla.
  if (alcance.some((p) => p.startsWith("../"))) return true;
  // Un `f` que termina en `/` es un clon entero que no se pudo leer: toca todo lo que viva adentro.
  return cambiados.some((f) => alcance.some((p) => (f.endsWith("/") && p.startsWith(f)) || (p.endsWith("/") ? f.startsWith(p) : f === p || f.startsWith(`${p}/`))));
}

/**
 * CACHÉ POR SEÑAL, como un build incremental: la huella de las ENTRADAS de una señal es su
 * definición (command, paths, skipIfMissing), la versión de node y, por cada ruta de su alcance,
 * el objeto que git tiene en HEAD (raíz), el HEAD del clon o del árbol externo (`../…`), más la
 * huella de cada archivo sucio que cae adentro. Si es igual a la de su último VERDE, la señal no se
 * vuelve a correr: medir dos veces las mismas entradas no cambia el resultado.
 *
 * No se cachea nunca: una señal sin `paths` (no declaró de qué depende), una con `cache: false`
 * (lee estado de afuera: el gestor, un servicio vivo, el reloj) ni nada con `--no-cache`. El gate completo
 * medía 16 min y casi siempre repetía mediciones de entradas que nadie había tocado.
 */
const firmasDeRuta = new Map();
function firmaDeRuta(p, foto) {
  if (firmasDeRuta.has(p)) return firmasDeRuta.get(p);
  const limpio = p.replace(/\/+$/, "");
  let firma;
  if (limpio.startsWith("../")) {
    const dir = path.resolve(REPO_ROOT, limpio);
    const h = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8", windowsHide: true });
    const s = spawnSync("git", [...SIN_COMILLAS, "status", "--porcelain", "-uall"], { cwd: dir, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    // Sin git legible no hay firma: `null` = no se cachea (correr de más, nunca de menos).
    firma = h.status === 0 && s.status === 0 ? `${h.stdout.trim()}|${s.stdout.split("\n").filter(Boolean).sort().map((l) => `${l}#${huellaAbs(path.join(dir, l.slice(3).trim()))}`).join(",")}` : null;
  } else if (Object.keys(foto.clones).some((c) => limpio === c || limpio.startsWith(`${c}/`))) {
    // Dentro de un repo anidado: la firma es su HEAD (lo sucio de adentro se suma en `huellaDeEntradas`).
    firma = foto.clones[Object.keys(foto.clones).find((c) => limpio === c || limpio.startsWith(`${c}/`))];
  } else if (bajoAnidados(limpio)) {
    // Bajo una carpeta de repos anidados, pero el repo no está en este checkout.
    firma = "sin-clon";
  } else {
    // Por CONTENIDO, no por estado: el blob que git tiene de cada archivo bajo la ruta y, para lo
    // sucio, el blob de lo que hay en disco (`git hash-object`, con los mismos filtros). Así
    // commitear sin cambiar nada no cambia la firma — con «objeto en HEAD + huella de lo sucio», un
    // commit de lo ya medido volvía a correr todas las señales de esa ruta.
    const r = spawnSync("git", [...SIN_COMILLAS, "ls-files", "-s", "--", limpio], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) firma = null;
    else {
      const blobs = new Map(r.stdout.split("\n").filter(Boolean).map((l) => { const [meta, ruta] = l.split("\t"); return [ruta, meta.split(" ")[1]]; }));
      for (const [f, b] of Object.entries(foto.blobs ?? {})) if (f === limpio || f.startsWith(`${limpio}/`)) blobs.set(f, b);
      // …más el HEAD de cada repo anidado que viva ADENTRO de la ruta: la raíz no los versiona.
      const adentro = Object.entries(foto.clones).filter(([c]) => c.startsWith(`${limpio}/`)).sort().map(([c, h]) => `${c}@${h}`);
      firma = createHash("sha1").update([...[...blobs].sort(([a], [b]) => a.localeCompare(b)).map(([f, b]) => `${f} ${b}`), ...adentro].join("\n")).digest("hex").slice(0, 16);
    }
  }
  firmasDeRuta.set(p, firma);
  return firma;
}

function huellaDeEntradas(senal, foto) {
  if (SIN_CACHE || senal.cache === false || !foto) return null;
  const alcance = alcanceDe(senal);
  if (!alcance) return null;
  const partes = [JSON.stringify([senal.command, senal.paths, senal.skipIfMissing ?? null]), process.version];
  for (const p of [...alcance].sort()) {
    const firma = firmaDeRuta(p, foto);
    if (firma === null) return null;
    partes.push(`${p}=${firma}`);
  }
  // Lo sucio de la RAÍZ ya está en la firma de cada ruta (por contenido); acá sólo lo de los repos anidados.
  const clones = Object.keys(foto.clones);
  for (const [f, h] of Object.entries(foto.huellas).sort()) if (dentroDeClon(f, clones) && esRelevante({ ...senal, paths: senal.paths.filter((x) => !x.startsWith("../")) }, [f])) partes.push(`${f}#${h}`);
  return createHash("sha1").update(partes.join("\n")).digest("hex").slice(0, 16);
}

function huellaAbs(abs) {
  try {
    return createHash("sha1").update(fs.readFileSync(abs)).digest("hex").slice(0, 16);
  } catch {
    return "-";
  }
}

/** sha1 del contenido (16 hex), o `"-"` si el archivo no existe (borrado también es un estado). */
function huellaDe(rel) {
  try {
    return createHash("sha1").update(fs.readFileSync(path.join(REPO_ROOT, rel))).digest("hex").slice(0, 16);
  } catch {
    return "-";
  }
}

/**
 * Lo que un gate completo deja para que el próximo `changed` mida contra él: el HEAD de cada clon
 * y la huella de cada archivo que ya estaba sucio (raíz y clones). Si algo falla, `null`: el
 * changed medirá contra HEAD a secas, que corre de más y nunca de menos.
 */
function fotoDelArbol() {
  const clones = {};
  const headDe = (cwd) => {
    const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8", windowsHide: true });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  for (const d of clonesPresentes()) {
    const h = headDe(path.join(REPO_ROOT, d));
    if (h) clones[d] = h;
  }
  const head = headDe(REPO_ROOT);
  const sucios = archivosCambiados("HEAD", clones);
  if (!head || !sucios) return null;
  const huellas = {};
  for (const f of sucios) huellas[f] = huellaDe(f);
  // El blob de git de lo sucio de la raíz (para la caché por contenido): `-` si se borró. Si
  // `hash-object` falla, sin blobs: las rutas afectadas firman distinto y corren (de más, no de menos).
  const blobs = {};
  const raiz = sucios.filter((f) => !dentroDeClon(f, Object.keys(clones)) && !f.endsWith("/"));
  // `try`: un archivo que existe y no se puede leer (un `.env` bajo el sandbox de Claude Code da
  // EPERM) tumbaba el gate entero antes de correr una sola señal. Sin leerlo, cuenta como borrado:
  // las rutas afectadas firman distinto y corren (de más, no de menos).
  const esArchivo = (f) => {
    try {
      return fs.statSync(path.join(REPO_ROOT, f)).isFile();
    } catch {
      return false;
    }
  };
  const existen = raiz.filter(esArchivo);
  for (const f of raiz) blobs[f] = "-";
  if (existen.length) {
    const r = spawnSync("git", ["hash-object", "--stdin-paths"], { cwd: REPO_ROOT, input: existen.join("\n") + "\n", encoding: "utf8", windowsHide: true });
    const ids = r.status === 0 ? r.stdout.split("\n").filter(Boolean) : [];
    if (ids.length === existen.length) existen.forEach((f, i) => { blobs[f] = ids[i]; });
    else existen.forEach((f) => { blobs[f] = `sin-blob:${huellas[f]}`; });
  }
  return { head, clones, huellas, blobs };
}

/** La ruta relativa (`<carpeta>/<repo>`, con `/`) de cada repo anidado presente: ver `ANIDADOS`. */
function clonesPresentes() {
  const presentes = [];
  for (const carpeta of ANIDADOS) {
    try {
      for (const d of fs.readdirSync(path.join(REPO_ROOT, carpeta), { withFileTypes: true })) {
        if (d.isDirectory() && fs.existsSync(path.join(REPO_ROOT, carpeta, d.name, ".git"))) presentes.push(`${carpeta}/${d.name}`);
      }
    } catch {
      /* la carpeta declarada no existe en este checkout: no hay repos anidados que mirar */
    }
  }
  return presentes;
}


/**
 * Candidatos a cambiados, rutas relativas a la raíz con `/`: el diff de la raíz contra `base` +
 * lo no versionado, y por clon el diff contra el HEAD que tenía en el último gate completo (o
 * contra su HEAD de hoy si no hay registro) + lo no versionado. `null` si git no responde en la
 * raíz: ahí no se adivina.
 */
function archivosCambiados(base, headsDeClones) {
  // `core.quotepath=false`: por defecto git ENTRECOMILLA y escapa una ruta con un byte no ASCII
  // (`"app/a\303\261o.js"`). Así escrita no casa con ningún `paths` ni existe en disco, y su
  // edición quedaba fuera del modo changed y de la firma de la caché: el gate completo decía
  // «CACHÉ … VERDE» con el archivo roto (lo reprodujo el reviewer). Vale para toda lista de rutas.
  const git = (cwd, ...args) => {
    const r = spawnSync("git", [...SIN_COMILLAS, ...args], { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 ? r.stdout.split("\n").map((l) => l.trim()).filter(Boolean) : null;
  };
  const baseValida = base && git(REPO_ROOT, "rev-parse", "--verify", "--quiet", `${base}^{commit}`) ? base : "HEAD";
  const diff = git(REPO_ROOT, "diff", "--name-only", baseValida);
  const nuevos = git(REPO_ROOT, "ls-files", "--others", "--exclude-standard");
  if (diff === null || nuevos === null) return null;
  const todos = new Set([...diff, ...nuevos]);
  for (const d of clonesPresentes()) {
    const dir = path.join(REPO_ROOT, d);
    const previo = headsDeClones?.[d];
    const baseClon = previo && git(dir, "rev-parse", "--verify", "--quiet", `${previo}^{commit}`) ? previo : "HEAD";
    // Un repo anidado cuyo git no responde no puede declararse «sin cambios»: entra entero.
    const propios = git(dir, "diff", "--name-only", baseClon);
    const sueltos = git(dir, "ls-files", "--others", "--exclude-standard");
    if (propios === null || sueltos === null) {
      todos.add(`${d}/`);
      continue;
    }
    for (const f of [...propios, ...sueltos]) todos.add(`${d}/${f}`);
  }
  return [...todos].map((f) => f.replace(/\\/g, "/")).sort();
}

// La foto del árbol se saca ANTES de la primera señal: una edición hecha mientras el gate corre
// no la midió nadie, y con la foto del final el próximo `changed` la daría por verificada.
const fotoInicial = MODE === "full" || !SIN_CACHE ? fotoDelArbol() : null;
// Las huellas de entrada se toman también al arrancar, por la misma razón que la foto.
const entradasDe = new Map(aCorrer.map((s) => [s.name, huellaDeEntradas(s, fotoInicial)]));
const registroPrevio = previa ?? leerRegistro();
const cacheadas = [];

/**
 * Códigos de salida de Windows que NO son un veredicto de lo que la señal mide: el proceso no
 * llegó a arrancar, o lo cortaron desde afuera. Son NTSTATUS, y Node los entrega como enteros sin
 * signo (`3221225794`), que en un registro no le dicen nada a nadie.
 */
const SIN_CONSOLA = 0xc0000142; // STATUS_DLL_INIT_FAILED
const NTSTATUS = {
  [SIN_CONSOLA]: { nombre: "STATUS_DLL_INIT_FAILED", aborta: true, que: "el proceso no llegó a arrancar: la consola o la sesión de Windows desde la que se lanzó el gate ya no existe (terminal cerrada, conhost muerto, cierre de sesión) o el escritorio se quedó sin memoria" },
  0xc000013a: { nombre: "STATUS_CONTROL_C_EXIT", aborta: true, que: "la cortaron desde afuera (Ctrl+C o cierre de la consola)" },
  0xc0000005: { nombre: "STATUS_ACCESS_VIOLATION", que: "el proceso se cayó (violación de acceso)" },
  0xc0000135: { nombre: "STATUS_DLL_NOT_FOUND", que: "el proceso no arrancó: le falta una DLL" },
  0xc0000409: { nombre: "STATUS_STACK_BUFFER_OVERRUN", que: "el proceso abortó (fail-fast del runtime)" },
  0xc00000fd: { nombre: "STATUS_STACK_OVERFLOW", que: "el proceso se cayó (desbordó la pila)" },
};
/** Señales con las que a un proceso lo terminan DESDE AFUERA (las demás son una caída propia). */
const SENALES_DE_CORTE = new Set(["SIGINT", "SIGTERM", "SIGHUP", "SIGKILL", "SIGBREAK"]);

/**
 * Qué le pasó a una señal, con su porqué: `verde`, `rojo` (corrió y falló) o `abortada` (no llegó
 * a medir). Ningún camino devuelve un estado sin `motivo`: el 2026-11-10 siete señales quedaron
 * «rojo · 30 ms · salió con 3221225794» y sin una línea, y hubo que reconstruir a mano que la
 * consola del gate había muerto y que ninguna había arrancado.
 */
function diagnosticar(r, argv) {
  const sinSalida = r.cola !== undefined && !r.cola.trim() ? " · sin salida (no escribió nada en stdout ni stderr)" : "";
  // Colgada es ROJO, no abortada: corrió y no terminó, y un cuelgue que se repite tiene que gastar
  // el presupuesto del ciclo acotado como cualquier otro error.
  if (r.colgada) return { estado: "rojo", motivo: `COLGADA: no terminó en ${Math.round(r.colgada / 60000)} min (\`timeoutMinutes\` / \`gate.signalTimeoutMinutes\`); se cortó con su árbol de procesos${sinSalida}` };
  if (r.error?.code === "ENOENT") return { estado: "rojo", motivo: `no existe el ejecutable ${argv[0]}` };
  // Cualquier otro error de `spawn` (EAGAIN, EPERM, ENOMEM, EMFILE…) es del sistema, no de la señal.
  if (r.error) return { estado: "abortada", motivo: `no se pudo lanzar \`${argv[0]}\`: ${r.error.code ?? "error"} — ${r.error.message}` };
  if (r.status === 0) return { estado: "verde" };
  if (r.status === null) {
    const corte = SENALES_DE_CORTE.has(r.signal);
    return { estado: corte ? "abortada" : "rojo", motivo: `${corte ? "la terminaron desde afuera" : "el proceso se cayó"} con la señal ${r.signal ?? "(desconocida)"}${sinSalida}` };
  }
  const nt = NTSTATUS[r.status];
  if (nt) return { estado: nt.aborta ? "abortada" : "rojo", motivo: `salió con 0x${r.status.toString(16).toUpperCase()} (${nt.nombre}): ${nt.que}${sinSalida}` };
  // Un código enorme en Windows es un NTSTATUS que no está en la tabla: en hexadecimal se puede buscar.
  const codigo = r.status > 0x7fffffff ? `0x${r.status.toString(16).toUpperCase()} (${r.status}; NTSTATUS de Windows)` : String(r.status);
  return { estado: "rojo", motivo: `salió con ${codigo}${sinSalida}` };
}

/**
 * Cuánto puede tardar una señal antes de darla por colgada: su `timeoutMinutes`, o el de todas
 * (`gate.signalTimeoutMinutes`). 0 o ausente = sin límite. Sin esto, una señal colgada trababa el
 * gate entero sin decir cuál ni por qué (pasó: dos horas esperando una suite de navegador).
 */
function limiteDe(senal) {
  const min = Number(senal.timeoutMinutes ?? config.gate?.signalTimeoutMinutes);
  return Number.isFinite(min) && min > 0 ? Math.round(min * 60000) : 0;
}

/**
 * ¿La consola heredada del gate murió? Se descubre con la primera señal que no arranca y vale
 * para el resto de la corrida: desde ahí cada señal se lanza con su propia consola.
 */
let consolaMuerta = false;
const CONSOLA_PROPIA_DE_ENTRADA = process.platform === "win32" && !process.stdin.isTTY;

/**
 * Corre UNA señal y anota su resultado. En paralelo, su salida se captura y se imprime entera
 * al terminar (encabezado, salida, veredicto) para que dos señales no se mezclen línea a línea.
 */
async function ejecutar(senal) {
  const argv = senal.command;
  const nombre = senal.name;

  if (MODE === "fast" && senal.fastSkip) {
    console.log(`\n──▶ ${nombre}\n    – omitida en modo fast`);
    omitidas.push(nombre);
    resultados[nombre] = { estado: "omitida", motivo: "modo fast" };
    return;
  }

  // `rutaDeEstado`: una ruta `.git/…` en un worktree vive en el gitdir real (`.git` es un archivo).
  if (senal.skipIfMissing && !fs.existsSync(rutaDeEstado(senal.skipIfMissing))) {
    console.log(`\n──▶ ${nombre}\n    – OMITIDA: no existe \`${senal.skipIfMissing}\` (omitido ≠ pasó)`);
    omitidas.push(nombre);
    resultados[nombre] = { estado: "omitida", motivo: `no existe ${senal.skipIfMissing}` };
    return;
  }

  const entradas = entradasDe.get(nombre);
  const verdeAnterior = registroPrevio?.senales?.[nombre]?.ultimoVerde;
  if (entradas && verdeAnterior?.entradas === entradas) {
    console.log(`\n──▶ ${nombre}\n    ✓ ${nombre} — CACHÉ: mismas entradas que su verde de ${verdeAnterior.fecha} (${verdeAnterior.head ?? "?"}); no se vuelve a correr`);
    corridas += 1;
    cacheadas.push(nombre);
    resultados[nombre] = { estado: "verde", ms: 0, cache: verdeAnterior.fecha };
    return;
  }

  if (PARALELO) console.log(`  ▶ ${nombre} arranca (carril ${senal.exclusive ? "exclusivo" : senal.lane ?? "principal"})`);
  else console.log(`\n──▶ ${nombre}`);
  // `shell: false` es deliberado: ningún dato del config se interpola en una línea de comandos.
  // Los lotes de Windows (`npm.cmd`) pasan por cmd.exe con argumentos citados: `prepararLanzamiento`.
  const t0 = process.hrtime.bigint();
  const r = await correr(...prepararLanzamiento(argv), PARALELO, limiteDe(senal));
  // Cuánto tardó cada señal. Sin el número, «el gate tarda» es una sensación, y la discusión
  // termina sacando la señal que a alguien le molesta en vez de la que cuesta. Con el número
  // se discute la cara, y `fastSkip` se decide con datos.
  const ms = Math.round(Number(process.hrtime.bigint() - t0) / 1e6);
  duraciones.push({ name: nombre, ms });

  let linea;
  const d = diagnosticar(r, argv);
  if (r.error?.code === "ENOENT") {
    corridas += 1;
    linea = `    ✗ ${nombre} — no encontré el ejecutable \`${argv[0]}\``;
    fallidas.push(nombre);
    resultados[nombre] = { estado: "rojo", ms, motivo: d.motivo };
  } else if (senal.skipExitCode !== undefined && r.status === senal.skipExitCode && !r.colgada) {
    // No cuenta como corrida (acá `corridas` sólo suma por estado medido): omitida no es verde.
    linea = `    – OMITIDA: la señal declaró que en este checkout no hay nada que verificar (salió con ${r.status}; omitido ≠ pasó)`;
    omitidas.push(nombre);
    resultados[nombre] = { estado: "omitida", ms, motivo: `salió con ${r.status} (skipExitCode)` };
  } else if (d.estado === "verde") {
    corridas += 1;
    linea = `    ✓ ${nombre} (${ms} ms)`;
    resultados[nombre] = { estado: "verde", ms };
  } else if (d.estado === "abortada") {
    // No cuenta como corrida: si TODAS abortan, el gate no verificó nada y lo dice así.
    linea = `    ⊘ ${nombre} — ABORTADA, no llegó a medir (${ms} ms): ${d.motivo}`;
    abortadas.push(nombre);
    resultados[nombre] = { estado: "abortada", ms, motivo: d.motivo };
  } else {
    corridas += 1;
    linea = `    ✗ ${nombre} (${ms} ms)${/^salió con \d+$/.test(d.motivo) ? "" : ` — ${d.motivo}`}`;
    fallidas.push(nombre);
    resultados[nombre] = { estado: "rojo", ms, motivo: d.motivo };
  }
  if (r.relanzada) {
    resultados[nombre].aviso = r.relanzada;
    linea += `\n    ! ${r.relanzada}`;
  }
  if (r.cola !== undefined) resultados[nombre].cola = r.cola;
  if (PARALELO) process.stdout.write(`\n──▶ ${nombre}\n${r.salida ?? ""}${r.salida && !r.salida.endsWith("\n") ? "\n" : ""}${linea}\n`);
  else console.log(linea);
}

if (!PARALELO) {
  for (const senal of aCorrer) await ejecutar(senal);
} else {
  // Un carril es una cola en serie; los carriles corren a la vez, hasta `lanes.max`. Las
  // exclusivas van al final, solas: lo que miden depende de que la máquina esté quieta.
  const exclusivas = aCorrer.filter((s) => s.exclusive);
  const porCarril = new Map();
  for (const s of aCorrer.filter((s) => !s.exclusive)) {
    const carril = s.lane ?? "principal";
    if (!porCarril.has(carril)) porCarril.set(carril, []);
    porCarril.get(carril).push(s);
  }
  // El carril más largo arranca primero (lo medido en la última corrida): con `max` carriles a la
  // vez, el que más tarda no puede quedar esperando turno detrás de uno corto, o el reloj del gate
  // es su duración MÁS la espera. Sin medición previa, el orden declarado.
  const msPrevio = (s) => registroPrevio?.senales?.[s.name]?.ms ?? registroPrevio?.senales?.[s.name]?.ultimoVerde?.ms ?? 0;
  const colas = [...porCarril.entries()].sort(([, a], [, b]) => b.reduce((t, s) => t + msPrevio(s), 0) - a.reduce((t, s) => t + msPrevio(s), 0));
  console.log(
    `Carriles: ${colas.map(([c, l]) => `${c} (${l.length})`).join(" · ")} — hasta ${Math.min(CARRILES, colas.length)} a la vez` +
      (exclusivas.length ? `; al final, solas: ${exclusivas.map((s) => s.name).join(", ")}` : ""),
  );
  let siguiente = 0;
  const obrero = async () => {
    while (siguiente < colas.length) {
      const [, lista] = colas[siguiente++];
      for (const s of lista) await ejecutar(s);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CARRILES, colas.length) }, obrero));
  for (const s of exclusivas) await ejecutar(s);
}

console.log("");
if (omitidas.length) console.log(`Señales omitidas (NO son verde): ${omitidas.join(" ")}`);
if (abortadas.length) console.log(`Señales ABORTADAS (no llegaron a medir: NO son verde ni un rojo de lo que miden): ${abortadas.map((n) => `«${n}» — ${resultados[n].motivo}`).join(" · ")}`);
if (duraciones.length) {
  const total = duraciones.reduce((a, d) => a + d.ms, 0);
  const caras = [...duraciones].sort((a, b) => b.ms - a.ms).slice(0, 3);
  const fmt = (d) => `${d.name} ${(d.ms / 1000).toFixed(1)}s`;
  // Con carriles, la suma de las señales ya no es lo que esperó el humano: el reloj sí.
  const reloj = (Date.now() - inicio.getTime()) / 1000;
  console.log(`Tiempo: ${reloj.toFixed(1)}s de reloj (${(total / 1000).toFixed(1)}s sumando las ${duraciones.length} señal(es)) — las más caras: ${caras.map(fmt).join(' · ')}`);
}

if (cacheadas.length) console.log(`Caché: ${cacheadas.length} señal(es) con las mismas entradas que su último verde, sin volver a correr: ${cacheadas.join(" · ")}. Para medir en frío: \`${config.gate?.command ?? "node scripts/gate.mjs"} -- --no-cache\`.`);
if (reutilizadas.length) {
  const porEstado = {};
  for (const r of reutilizadas) porEstado[r.estado] = (porEstado[r.estado] ?? 0) + 1;
  console.log(`Reutilizadas de la corrida de ${previa?.fecha ?? "?"} (${previa?.head ?? "?"}), sin volver a correr: ${Object.entries(porEstado).map(([e, n]) => `${n} ${e}`).join(" · ")}.`);
}

// Un gate donde NO corrió ninguna señal no es verde: es un gate que no existe. Pasó una vez
// (un separador de campos mal elegido omitía todo) y reportó "entregable".
const veredicto = corridas === 0 || fallidas.length || abortadas.length ? "rojo" : MODE === "full" ? "verde" : `${MODE}-verde`;
if (veredicto === "verde") {
  const marcador = config.gate?.marker;
  if (marcador) fs.rmSync(rutaDeEstado(marcador), { force: true });
}
const agotadas = loop ? contarIntentos() : [];
registrar(veredicto);
regenerarPanel();

if (corridas === 0 && abortadas.length) {
  console.log(`GATE ROJO — ninguna señal llegó a medir: ${abortadas.length} abortada(s). No es un rojo de lo que miden: el motivo de cada una está arriba.`);
  process.exit(1);
}
if (corridas === 0) {
  console.log("GATE ROJO — ninguna señal llegó a correr: todas quedaron omitidas.");
  console.log("Revisá `gate.signals` en el config (rutas de `skipIfMissing`, `fastSkip` de más).");
  process.exit(1);
}

if (abortadas.length && !fallidas.length) {
  console.log(`GATE ROJO — ${abortadas.length} señal(es) ABORTADA(S), ninguna fallida: ${abortadas.join(" · ")}.`);
  console.log("No midieron nada, así que no hay error del producto que leer: el motivo de cada una está arriba. Un gate con señales sin medir no es entregable.");
  if (config.gate?.retryCommand) console.log(`Para correr SÓLO lo que quedó sin medir: \`${config.gate.retryCommand}\` (señal de desarrollo; el entregable sigue siendo \`${config.gate?.command ?? "node scripts/gate.mjs"}\`).`);
  process.exitCode = 1;
} else if (fallidas.length) {
  console.log(`GATE ROJO — señales fallidas: ${fallidas.join(" ")}`);
  if (abortadas.length) console.log(`…y ${abortadas.length} ABORTADA(S), que no llegaron a medir (no son un rojo de lo que miden): ${abortadas.join(" · ")}.`);
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
  if (config.gate?.retryCommand) console.log(`Para volver a correr SÓLO lo rojo, como un pipeline que se reanuda: \`${config.gate.retryCommand}\` (señal de desarrollo; el entregable sigue siendo \`${config.gate?.command ?? "node scripts/gate.mjs"}\`).`);
  if (config.gate?.changedCommand && MODE !== "changed") console.log(`Mientras arreglás, \`${config.gate.changedCommand}\` corre sólo las señales que tocan lo que cambiaste (también de desarrollo).`);
  // `exitCode` y no `process.exit(1)`: con la salida de las señales reenviada por pipe, salir en
  // seco puede cortar lo último que se escribió (stdout a un pipe es asíncrono en macOS), y lo
  // último es justo el error que el agente tiene que leer.
  process.exitCode = 1;
} else if (MODE === "fast") {
  console.log("GATE FAST VERDE — señal de desarrollo. NO es entregable: faltan las señales lentas.");
} else if (MODE === "changed") {
  const rojasAjenas = reutilizadas.filter((r) => r.estado === "rojo").map((r) => r.name);
  console.log(
    `GATE CHANGED VERDE — las ${corridas} señal(es) que tocan lo cambiado pasan. NO es entregable: las otras ${reutilizadas.length} conservan el resultado de ${previa?.fecha ?? "la última corrida"}.` +
      (rojasAjenas.length ? `\nSiguen ROJAS, sin relación con este cambio: ${rojasAjenas.join(" · ")}.` : "") +
      `\nPara entregar, \`${config.gate?.command ?? "node scripts/gate.mjs"}\` completo.`,
  );
} else if (MODE === "retry") {
  console.log(
    `GATE RETRY VERDE — las ${corridas} señal(es) que estaban rojas ya pasan. NO es entregable: las otras ${reutilizadas.length} conservan el resultado de la corrida de ${previa?.fecha ?? "?"}, medido sobre el árbol de ANTES del arreglo. Cerrá con \`${config.gate?.command ?? "node scripts/gate.mjs"}\`.`,
  );
} else {
  console.log("GATE VERDE — entregable.");
}

/**
 * El registro de la corrida (`gate.registry`, default `.git/harness-gate.json`): por señal, su
 * último resultado y su último verde. Va en `.git/` porque es de ESTA máquina y no se versiona.
 * Escribirlo nunca cambia el veredicto: un registro que no se pudo escribir es un panel con menos
 * datos, no un gate rojo.
 */
/** El registro de la última corrida, o `null` si no hay (o no se puede leer). */
function leerRegistro() {
  try {
    return JSON.parse(fs.readFileSync(rutaDeEstado(config.gate?.registry ?? ".git/harness-gate.json"), "utf8"));
  } catch {
    return null;
  }
}

function registrar(veredicto) {
  const rel = config.gate?.registry ?? ".git/harness-gate.json";
  // `rutaDeEstado`: en un worktree `.git` es un archivo y `.git/harness-gate.json` no se puede crear.
  const abs = rutaDeEstado(rel);
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const previo = leerRegistro() ?? {};
  const fecha = new Date().toISOString();
  // El HEAD y «árbol limpio» son los de CUANDO ARRANCÓ: eso es lo que las señales midieron. Leídos
  // acá, al final, un commit hecho durante la corrida dejaba adoptable (y como base de `changed`)
  // un veredicto medido sobre otro árbol.
  const head = arranque.head ?? git("rev-parse", "--short", "HEAD");
  const senalesReg = { ...(previo.senales ?? {}) };
  for (const [nombre, res] of Object.entries(resultados)) {
    const antes = senalesReg[nombre]?.ultimoVerde ?? null;
    const { cola, ...sinCola } = res;
    // De una señal roja se guarda QUÉ falló (las líneas de error de su salida), no sólo «salió
    // con 1»: el panel lo muestra como evidencia, y sin eso había que volver a correr el gate para
    // saber qué arreglar. La cola completa no se guarda: es ruido y puede ser grande.
    // …y de una abortada, lo poco que haya alcanzado a decir antes de que la cortaran.
    const error = res.estado !== "verde" && cola ? lineasDeError(cola) : null;
    // Un verde de caché no es una medición nueva: conserva el verde que lo respalda.
    const verdeNuevo = { fecha, head, ms: res.ms, ...(entradasDe.get(nombre) ? { entradas: entradasDe.get(nombre) } : {}) };
    senalesReg[nombre] = { ...sinCola, ...(error?.length ? { error } : {}), fecha, ultimoVerde: res.estado === "verde" ? (res.cache ? antes : verdeNuevo) : antes };
  }
  // `limpio`: si el árbol estaba sin cambios, otro gate que espere sobre el mismo HEAD puede
  // adoptar este veredicto en vez de repetir la medición (ver `veredictoAdoptable`).
  // `ultimaCompleta`: la base del modo changed. Sólo la mueve un gate completo; los de desarrollo
  // la heredan, o cada `gate:changed` mediría contra el anterior y perdería lo cambiado antes.
  const ultimaCompleta = MODE === "full" ? { head: fotoInicial?.head ?? head, fecha, veredicto, ...(fotoInicial ? { clones: fotoInicial.clones, huellas: fotoInicial.huellas } : {}) } : previo.ultimaCompleta ?? (previo.modo === "full" ? { head: previo.head, fecha: previo.fecha, veredicto: previo.veredicto } : null);
  const registro = { fecha, modo: MODE, veredicto, ms: Date.now() - inicio.getTime(), head, rama: git("rev-parse", "--abbrev-ref", "HEAD"), limpio: arranque.limpio && git("status", "--porcelain") === "", ultimaCompleta, senales: senalesReg };
  registro.bitacora = anotarVeredicto(previo.bitacora ?? null, registro, git);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(registro, null, 2) + "\n");
  } catch (e) {
    console.log(`  (no pude escribir el registro ${rel}: ${e.message})`);
  }
}

/**
 * The status ledger (`status.events`, scripts/status.mjs): a full gate appends a `gate.verdict`
 * event to the journal when the verdict CHANGES, or when the last one recorded is older than
 * `heartbeatDays` — without that, months of steady green would leave the date of STATUS.md behind
 * and `drift` would call it stale. The journal lives in `.git/` (P7): writing STATUS.md from here
 * would leave a tracked file changed by every verdict, and the task-scope signal red on the next
 * run. `status.mjs sync` moves it into the log. Fast mode is a development signal: never recorded.
 * Returns what the registry keeps to compare against next time.
 */
function anotarVeredicto(ultimo, registro, git) {
  const spec = config.status?.events;
  if (!spec || MODE !== "full") return ultimo; // fast y retry son señales de desarrollo: no se anotan
  const dias = Number.isFinite(spec.heartbeatDays) ? spec.heartbeatDays : 7;
  const viejo = ultimo ? Date.now() - Date.parse(ultimo.fecha) > dias * 86400000 : true;
  if (ultimo && ultimo.veredicto === registro.veredicto && ultimo.rama === registro.rama && !viejo) return ultimo;
  const evento = {
    ts: isoLocal(),
    author: git("config", "user.name") || os.userInfo().username,
    event: "gate.verdict",
    key: registro.rama ?? "HEAD",
    what: registro.veredicto === "verde" ? "VERDE" : `ROJO — ${corridas === 0 ? "ninguna señal corrió" : [fallidas.length ? `señales fallidas: ${fallidas.join(", ")}` : "", abortadas.length ? `señales abortadas (sin medir): ${abortadas.join(", ")}` : ""].filter(Boolean).join(" · ")}`,
    evidence: `\`${config.gate?.command ?? "gate"}\` @ ${registro.head ?? "?"}`,
  };
  try {
    const abs = rutaDeEstado(spec.journal ?? DEFAULT_STATUS_JOURNAL);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.appendFileSync(abs, JSON.stringify(evento) + "\n");
    console.log(`Bitácora: veredicto ${evento.what.split(" ")[0]} anotado — \`node scripts/status.mjs sync\` lo pasa a ${config.status.file ?? "STATUS.md"}.`);
  } catch (e) {
    console.log(`  (no pude anotar el veredicto en la bitácora: ${e.message})`);
    return ultimo;
  }
  return { veredicto: registro.veredicto, rama: registro.rama, fecha: registro.fecha };
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
 * `extra` trae lo que `prepararLanzamiento` necesita para un lote de Windows.
 *
 * Consola muerta (Windows): si la consola desde la que se lanzó el gate desaparece a mitad de la
 * corrida (se cerró la terminal o la sesión del agente que lo lanzó, y el gate siguió vivo), todo
 * hijo que la HEREDE muere al inicializarse con 0xC0000142, en decenas de milisegundos y sin
 * escribir nada; el gate no recibe ni SIGHUP. Así quedaron «rojas» siete señales el 2026-11-10.
 * Un hijo con consola PROPIA sí arranca, y Windows sólo se la da si no hereda ningún descriptor
 * (`windowsHide` + stdin `ignore` + salida por pipe). Por eso: la señal que muere así se relanza
 * UNA vez con consola propia, y las siguientes van directo. No es el modo por defecto porque con
 * consola propia el Ctrl+C de la terminal ya no le llega al hijo.
 */
async function correr(cmd, args, extra = {}, capturar = false, limiteMs = 0) {
  // Sin terminal delante (lo lanzó un agente o un script: stdin no es TTY) no hay Ctrl+C que
  // perder, así que cada señal nace con consola propia: la que YA está corriendo cuando muere la
  // consola del lanzador tampoco pierde a sus propios hijos (el relanzamiento no la alcanza).
  if (CONSOLA_PROPIA_DE_ENTRADA) return lanzar(cmd, args, extra, capturar, true, limiteMs);
  if (!consolaMuerta) {
    const r = await lanzar(cmd, args, extra, capturar, false, limiteMs);
    const noArranco = process.platform === "win32" && r.status === SIN_CONSOLA && !(r.cola ?? r.salida ?? "").trim();
    if (!noArranco) return r;
    consolaMuerta = true;
  }
  const r = await lanzar(cmd, args, extra, capturar, true, limiteMs);
  return { ...r, relanzada: "la consola desde la que se lanzó el gate ya no existe (0xC0000142 al heredarla): esta señal corrió con consola propia" };
}

/**
 * Corta una señal colgada CON su árbol: matar sólo al hijo directo dejaba vivo al proceso que
 * éste había lanzado (una suite de navegador colgó el gate dos horas, y su nieto seguía corriendo).
 */
function cortarArbol(hijo) {
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(hijo.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else {
    try {
      process.kill(-hijo.pid, "SIGKILL"); // grupo propio: ver `detached` en `lanzar`
    } catch {
      hijo.kill("SIGKILL");
    }
  }
}

function lanzar(cmd, args, extra, capturar, consolaPropia, limiteMs = 0) {
  return new Promise((resolve) => {
    // Sin terminal delante (lo lanzó un agente, CI o un script) la salida ya va a un pipe: pasarla
    // por el nuestro no le cambia nada a nadie y deja la cola, que es la evidencia del registro
    // («falló sin escribir nada» sólo se puede afirmar si se miró). Con terminal y sin `loop`, la
    // señal hereda la consola como siempre: no pierde colores ni interactividad.
    const conPipe = loop || capturar || consolaPropia || !process.stdout.isTTY;
    const hijo = spawn(cmd, args, {
      ...extra,
      cwd: REPO_ROOT,
      shell: false,
      stdio: consolaPropia ? ["ignore", "pipe", "pipe"] : conPipe ? ["inherit", "pipe", "pipe"] : "inherit",
      ...(consolaPropia ? { windowsHide: true } : {}),
      // En POSIX, un grupo de procesos propio es lo que deja cortar al árbol entero de una vez.
      ...(limiteMs > 0 && process.platform !== "win32" ? { detached: true } : {}),
    });
    let colgada = false;
    const reloj = limiteMs > 0 ? setTimeout(() => { colgada = true; cortarArbol(hijo); }, limiteMs) : null;
    const fin = (r) => {
      if (reloj) clearTimeout(reloj);
      resolve(colgada ? { ...r, colgada: limiteMs } : r);
    };
    let cola = "";
    let salida = "";
    const max = 64 * 1024; // la cola alcanza para la huella; el resto ya se imprimió
    const maxSalida = 8 * 1024 * 1024; // con carriles, la salida entera espera a que la señal termine
    const tee = (destino) => (trozo) => {
      if (capturar) salida = (salida + trozo.toString("utf8")).slice(-maxSalida);
      else destino.write(trozo);
      cola = (cola + trozo.toString("utf8")).slice(-max);
    };
    hijo.stdout?.on("data", tee(process.stdout));
    hijo.stderr?.on("data", tee(process.stderr));
    hijo.on("error", (error) => fin({ status: null, error, ...(capturar ? { salida } : {}) }));
    // La cola se guarda siempre que hubo pipe: es la evidencia del registro, con o sin `loop`.
    hijo.on("close", (status, signal) => fin({ status, signal, ...(conPipe ? { cola } : {}), ...(capturar ? { salida } : {}) }));
  });
}

/**
 * El cerrojo del gate (`gate.lock`). Si otro gate está corriendo (su PID sigue vivo), éste
 * espera, sondeando, hasta `waitMinutes`; un cerrojo cuyo dueño ya murió se descarta. Devuelve
 * `null` si no hubo que esperar, o `{pid, desde}` del gate que terminó antes de que éste tomara
 * el cerrojo. El cerrojo se suelta al salir por cualquier camino (`exit`, señal, excepción).
 */
async function tomarCerrojo() {
  const abs = rutaDeEstado(CERROJO.file);
  const leer = () => {
    try {
      return JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch {
      return null;
    }
  };
  const vivo = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return e.code === "EPERM"; // existe, pero es de otro usuario
    }
  };
  let ajeno = null;
  const t0 = Date.now();
  for (;;) {
    const actual = leer();
    if (!actual || !vivo(actual.pid)) {
      // Tomarlo es CREAR el archivo (`wx`): si dos gates arrancan a la vez, sólo uno lo crea y el
      // otro vuelve a mirar y espera. Escribiéndolo a secas lo tomaban los dos (lo vio el reviewer).
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        if (fs.existsSync(abs)) fs.rmSync(abs, { force: true }); // huérfano: su dueño ya murió
        fs.writeFileSync(abs, JSON.stringify({ pid: process.pid, inicio: isoLocal(), modo: MODE }) + "\n", { flag: "wx" });
        break;
      } catch (e) {
        // Sin cerrojo el gate corre igual: uno que no se pudo escribir no es un rojo.
        if (e.code !== "EEXIST") break;
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
    }
    if (!ajeno) {
      ajeno = { pid: actual.pid, desde: Date.now() };
      console.log(
        `GATE EN CURSO — otro gate (PID ${actual.pid}, desde ${actual.inicio ?? "?"}) está corriendo sobre este árbol. Espero a que termine (hasta ${Math.round(CERROJO.esperaMs / 60000)} min): dos gates a la vez se pisan los artefactos y los marcadores, y los dos salen rojos sin que nada esté roto.`,
      );
    }
    if (Date.now() - t0 >= CERROJO.esperaMs) {
      console.log(`GATE ROJO — el gate PID ${actual.pid} no terminó en ${Math.round(CERROJO.esperaMs / 60000)} min. Si ya no existe, borrá \`${CERROJO.file}\`; si sigue, esperá a que termine.`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, CERROJO.sondeoMs));
  }
  process.on("exit", soltarCerrojo);
  for (const senal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(senal, () => {
      soltarCerrojo();
      process.exit(130);
    });
  }
  return ajeno;
}

function soltarCerrojo() {
  if (!CERROJO) return;
  const abs = rutaDeEstado(CERROJO.file);
  try {
    const actual = JSON.parse(fs.readFileSync(abs, "utf8"));
    if (actual.pid === process.pid) fs.rmSync(abs, { force: true });
  } catch {
    /* ya no está, o es de otro: no se toca */
  }
}

/**
 * Si el gate que esperamos corrió COMPLETO sobre este mismo HEAD, con el árbol limpio antes y
 * ahora, su veredicto vale para esta corrida: medir dos veces el mismo árbol no cambia nada y
 * cuesta otros quince minutos. Cualquier duda (modo fast, otro HEAD, árbol sucio, registro
 * más viejo que la espera) → `null`, y el gate corre entero.
 */
function veredictoAdoptable(espera) {
  let registro;
  try {
    registro = JSON.parse(fs.readFileSync(rutaDeEstado(config.gate?.registry ?? ".git/harness-gate.json"), "utf8"));
  } catch {
    return null;
  }
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const head = git("rev-parse", "--short", "HEAD");
  if (!head || registro.modo !== "full" || MODE !== "full") return null;
  if (registro.head !== head || registro.limpio !== true || git("status", "--porcelain") !== "") return null;
  if (!registro.fecha || Date.parse(registro.fecha) < espera.desde) return null;
  if (registro.veredicto !== "verde" && registro.veredicto !== "rojo") return null;
  return { veredicto: registro.veredicto, head, fecha: registro.fecha };
}


/**
 * Las líneas de una salida que nombran un fallo (formatos de vitest, jest, tsc, eslint, karma,
 * dotnet y de los propios scripts del arnés), sin colores ni repetidas. Si ninguna casa, las
 * últimas líneas: algo dijo la señal antes de salir con error.
 */
function lineasDeError(salida, max = 12) {
  const lineas = String(salida ?? "")
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const fallo = /(^|\s)(FAIL|✗|✘|×|ERROR|Error:|error [A-Z]+\d+|AssertionError|Expected|Received|BLOQUEA|ROJO)\b|^\s*(✗|✘|×)\s/;
  const elegidas = [...new Set(lineas.filter((l) => fallo.test(l)))];
  return (elegidas.length ? elegidas : lineas.slice(-5)).slice(0, max).map((l) => l.slice(0, 300));
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
    return JSON.parse(fs.readFileSync(rutaDeEstado(loop.ledger), "utf8"));
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
    // Una señal que declara `countsAttempts: false` no entra al presupuesto: su rojo estable no es
    // «estoy trabado» sino «todavía no terminé» (la de la tarea declarada, con criterios sin
    // evidencia, repite la misma salida en cada corrida y congelaba las ediciones a la tercera).
    if (senales.find((x) => x.name === nombre)?.countsAttempts === false) continue;
    const h = huella(nombre, res.cola ?? res.motivo);
    const antes = libro[nombre];
    const intentos = antes?.huella === h.huella ? antes.intentos + 1 : 1;
    libro[nombre] = { huella: h.huella, intentos, desde: antes?.huella === h.huella ? antes.desde : new Date().toISOString(), muestra: h.muestra };
    if (intentos > loop.maxAttempts) agotadas.push({ senal: nombre, intentos, muestra: h.muestra });
  }
  libroActual = libro;
  try {
    const abs = rutaDeEstado(loop.ledger);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(libro, null, 2) + "\n");
    if (agotadas.length && loop.marker) {
      const marcador = rutaDeEstado(loop.marker);
      fs.mkdirSync(path.dirname(marcador), { recursive: true });
      fs.writeFileSync(marcador, `${new Date().toISOString()}\n${agotadas.map((a) => `${a.senal} (${a.intentos} intentos): ${a.muestra}`).join("\n")}\n`);
    }
  } catch (e) {
    console.log(`  (no pude escribir el libro de intentos ${loop.ledger}: ${e.message})`);
  }
  return agotadas;
}
