#!/usr/bin/env node
/**
 * reviewer-eval — la prueba de vida del subagente `reviewer`.
 *
 * Todo freno de este repo prueba que muerde (P2), menos uno: el `reviewer`, el único sensor
 * INFERENCIAL. Nadie había demostrado que encuentra lo que dice encontrar. Este script le da
 * diffs con una violación conocida (y diffs inocentes) y mide cuántos clasifica bien.
 *
 * Por qué NO es una señal del gate: un control inferencial es caro y no determinista. Meterlo
 * en cada commit haría el gate lento e inestable, y un gate inestable se aprende a ignorar.
 * Corre en el barrido programado (`reviewerEval.runner`), con un umbral en vez de un «todo o
 * nada», porque de un juez probabilístico lo honesto es medir una tasa.
 *
 * Agnóstico: los casos, el comando que invoca al revisor, la forma de su veredicto y el
 * umbral salen de `reviewerEval` en el config. El script no conoce ni la constitución ni el
 * agente: compara lo que el revisor contestó contra lo que el caso esperaba.
 *
 *   node scripts/reviewer-eval.mjs                  # todos los casos
 *   node scripts/reviewer-eval.mjs --only=<nombre>  # uno solo
 *   [--config <ruta>]                               # cebos del self-test (P7)
 *
 * Exit: 0 = tasa sobre el umbral, o OMITIDA (el revisor no está instalado: omitido no es
 * verde, y la salida lo dice) · 1 = tasa bajo el umbral, o un caso mal declarado.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const flag = (nombre) => {
  const i = args.indexOf(nombre);
  return i === -1 ? null : (args[i + 1] ?? null);
};
const rutaConfig = flag("--config") ? path.resolve(flag("--config")) : path.join(REPO_ROOT, ".claude", "harness.config.json");
const solo = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);

let config;
try {
  config = JSON.parse(fs.readFileSync(rutaConfig, "utf8"));
} catch {
  console.log("reviewer-eval: OMITIDA — no hay config legible.");
  process.exit(0);
}

const spec = config.reviewerEval;
if (!spec?.command?.length || !(spec.cases ?? []).length) {
  console.log("reviewer-eval: OMITIDA — el repo no declara `reviewerEval.command` ni `reviewerEval.cases`.");
  process.exit(0);
}

// Los casos se resuelven contra el directorio del config cuando es un cebo, y contra la raíz
// del repo en el caso real: así el self-test prueba el mecanismo sin escribir en el árbol (P7).
const base = flag("--config") ? path.dirname(rutaConfig) : REPO_ROOT;
const reVeredicto = new RegExp(spec.verdictPattern ?? "VEREDICTO:\\s*(\\w+)", "i");
const umbral = Number(spec.minScore ?? 1);
const plantilla =
  spec.prompt ??
  "Revisá el siguiente diff. No corras git: el diff es éste.\n\n```diff\n{diff}\n```\n\nTerminá con tu línea de veredicto.";

const casos = (spec.cases ?? []).filter((c) => !solo || c.name === solo);
if (solo && !casos.length) {
  console.error(`reviewer-eval: no hay ningún caso llamado \`${solo}\`.`);
  process.exit(1);
}

/**
 * El revisor NO corre en este repo: corre en un directorio temporal con copia sólo de
 * `reviewerEval.context` (la constitución, el agente, lo que cita). La primera corrida local lo
 * hizo en el repo, y el revisor —con Bash en su frontmatter— corrió el gate por su cuenta: los
 * marcadores que deja la medición de latencia bloquearon la sesión del humano de al lado. Tomar
 * una foto de esos marcadores y restaurarla no sirve: no distingue lo que escribió el revisor de
 * lo que escribió el humano en el mismo minuto, y restaurar le borra al humano un gate pendiente.
 * Aislar por construcción sí: lo que el revisor toque, lo toca en un árbol que se tira (P7).
 */
function armarContexto() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-revisor-"));
  for (const rel of spec.context ?? []) {
    const origen = path.join(base, rel);
    if (!fs.existsSync(origen)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.error(`reviewer-eval: \`reviewerEval.context\` nombra \`${rel}\`, que no existe: el revisor leería un contexto incompleto.`);
      process.exit(1);
    }
    fs.cpSync(origen, path.join(dir, rel), { recursive: true });
  }
  return dir;
}

const [cmd, ...cmdArgs] = spec.command;
let aciertos = 0;
const filas = [];
for (const caso of casos) {
  let diff;
  try {
    diff = fs.readFileSync(path.join(base, caso.diff), "utf8");
  } catch {
    console.error(`reviewer-eval: el caso \`${caso.name}\` apunta a \`${caso.diff}\`, que no existe.`);
    process.exit(1);
  }
  const aislado = armarContexto();
  const r = spawnSync(cmd, cmdArgs, {
    cwd: aislado,
    input: plantilla.split("{diff}").join(diff),
    encoding: "utf8",
    timeout: spec.timeoutMs ?? 300000,
    shell: process.platform === "win32",
  });
  fs.rmSync(aislado, { recursive: true, force: true });
  if (r.error?.code === "ENOENT") {
    console.log(`reviewer-eval: OMITIDA — \`${cmd}\` no está instalado en esta máquina. Omitido no es verde.`);
    process.exit(0);
  }
  const salida = `${r.stdout ?? ""}`;
  const veredicto = (reVeredicto.exec(salida)?.[1] ?? "").toLowerCase();
  // Sin veredicto y con la CLI fallando (sin clave, sin cuota, timeout): no se equivocó el
  // revisor, no llegó a revisar. Contarlo en la tasa culpa al juez por la infraestructura.
  if (!veredicto && (r.status !== 0 || r.error)) {
    const detalle = `${r.stderr ?? ""}`.trim().split("\n").pop()?.slice(0, 200) || r.error?.code || `exit ${r.status}`;
    console.error(
      `reviewer-eval: EVAL ROTO — en el caso «${caso.name}» \`${cmd}\` falló sin contestar (${detalle}). ` +
        "Es la infraestructura (clave, cuota, red), no el revisor: arreglala y volvé a correr. Roto no es verde ni omitido.",
    );
    process.exit(1);
  }
  const esperado = String(caso.expect ?? "").toLowerCase();
  const cita = !caso.mustCite || salida.includes(caso.mustCite);
  const acerto = Boolean(veredicto) && veredicto === esperado && cita;
  if (acerto) aciertos += 1;
  const motivo = !veredicto
    ? `sin veredicto (exit ${r.status})`
    : veredicto !== esperado
      ? `dijo «${veredicto}», se esperaba «${esperado}»`
      : !cita
        ? `no cita ${caso.mustCite}`
        : "";
  filas.push(`  ${acerto ? "✓" : "✗"} ${caso.name}${motivo ? ` — ${motivo}` : ""}`);
}

const tasa = aciertos / casos.length;
console.log(`Prueba de vida del revisor (${casos.length} caso(s))\n`);
for (const f of filas) console.log(f);
console.log(`\nTasa: ${aciertos}/${casos.length} (${Math.round(tasa * 100)} %) · umbral ${Math.round(umbral * 100)} %`);
if (tasa + 1e-9 < umbral) {
  console.error(
    "\nREVISOR EN ROJO — no encuentra lo que dice encontrar. Mirá los casos fallidos: o el prompt del " +
      "agente no cubre ese principio, o el caso está mal escrito. Lo que no se hace es bajar el umbral para que pase.",
  );
  process.exit(1);
}
console.log("\nREVISOR VERDE — sobre el umbral.");
