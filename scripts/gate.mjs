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
const omitidas = [];
let corridas = 0;

for (const senal of senales) {
  const argv = senal.command;
  if (!Array.isArray(argv) || !argv.length) {
    console.log(`\nGATE ROJO — señal sin command: ${senal.name}`);
    process.exit(1);
  }

  if (MODE === "fast" && senal.fastSkip) {
    console.log(`\n──▶ ${senal.name}\n    – omitida en modo fast`);
    omitidas.push(senal.name);
    continue;
  }

  if (senal.skipIfMissing && !fs.existsSync(path.join(REPO_ROOT, senal.skipIfMissing))) {
    console.log(`\n──▶ ${senal.name}\n    – OMITIDA: no existe \`${senal.skipIfMissing}\` (omitido ≠ pasó)`);
    omitidas.push(senal.name);
    continue;
  }

  console.log(`\n──▶ ${senal.name}`);
  // `shell: false` es deliberado: ningún dato del config se interpola en una línea de
  // comandos. En Windows, los lanzadores `.cmd`/`.bat` (npm, npx, gradlew) sólo se pueden
  // ejecutar a través del shell, así que ESOS —y sólo ésos— se resuelven a su archivo real.
  const r = spawnSync(resolverEjecutable(argv[0]), argv.slice(1), {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: false,
  });
  corridas += 1;

  if (r.error?.code === "ENOENT") {
    console.log(`    ✗ ${senal.name} — no encontré el ejecutable \`${argv[0]}\``);
    fallidas.push(senal.name);
  } else if (r.status === 0) {
    console.log(`    ✓ ${senal.name}`);
  } else {
    console.log(`    ✗ ${senal.name}`);
    fallidas.push(senal.name);
  }
}

console.log("");
if (omitidas.length) console.log(`Señales omitidas (NO son verde): ${omitidas.join(" ")}`);

// Un gate donde NO corrió ninguna señal no es verde: es un gate que no existe. Pasó una vez
// (un separador de campos mal elegido omitía todo) y reportó "entregable".
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

const marcador = config.gate?.marker;
if (marcador) fs.rmSync(path.join(REPO_ROOT, marcador), { force: true });
console.log("GATE VERDE — entregable.");

/**
 * Windows no ejecuta `npm`, `npx` ni `gradlew` directamente: son `.cmd`/`.bat`, y Node los
 * rechaza con EINVAL salvo que se los busque con su extensión real. Fuera de Windows esto
 * devuelve el nombre tal cual y no cambia nada.
 */
function resolverEjecutable(cmd) {
  if (process.platform !== "win32" || path.extname(cmd)) return cmd;
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const dirs = [REPO_ROOT, ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean)];
  for (const dir of dirs) {
    for (const ext of exts) {
      const cand = path.join(dir, cmd + ext);
      if (fs.existsSync(cand)) return cand;
    }
  }
  return cmd; // que falle con su propio mensaje: adivinar acá sería peor
}
