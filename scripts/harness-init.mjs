#!/usr/bin/env node
/**
 * Instalador del arnés en OTRO repositorio.
 *
 *   node scripts/harness-init.mjs <ruta-del-repo>            # dry-run: muestra qué haría
 *   node scripts/harness-init.mjs <ruta-del-repo> --apply    # copia de verdad
 *
 * Copia lo genérico (hooks, scripts, subagentes, comandos, hooks de git, plantillas) y deja
 * un `harness.config.json` DE ARRANQUE, con las señales del gate vacías a propósito: nadie
 * más que el equipo del repo destino sabe cuáles son sus señales reales, y un gate que
 * verifica lo que no corresponde es peor que no tener gate.
 *
 * Nunca sobreescribe: lo que ya existe se reporta como conservado. Dry-run por defecto —
 * la regla del arnés es mostrar la lista antes de escribir en lote.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORIGEN = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const destinoArg = process.argv[2];
const APLICAR = process.argv.includes("--apply");

if (!destinoArg) {
  console.error("uso: node scripts/harness-init.mjs <ruta-del-repo> [--apply]");
  process.exit(1);
}

const DESTINO = path.resolve(destinoArg);
if (!fs.existsSync(DESTINO)) {
  console.error(`el destino no existe: ${DESTINO}`);
  process.exit(1);
}
if (path.resolve(DESTINO) === ORIGEN) {
  console.error("el destino es este mismo repo: nada que instalar.");
  process.exit(1);
}
if (!fs.existsSync(path.join(DESTINO, ".git"))) {
  console.error(`aviso: ${DESTINO} no parece un repo git (falta .git/). El pre-commit no va a servir.`);
}

/** Archivos genéricos: se copian tal cual. */
const COPIAR = [
  ".claude/hooks/harness.mjs",
  ".claude/hooks/protected-paths.mjs",
  ".claude/hooks/bash-guard.mjs",
  ".claude/hooks/reuse-guard.mjs",
  ".claude/hooks/post-edit-check.mjs",
  ".claude/hooks/gate-stop.mjs",
  ".claude/hooks/session-start.mjs",
  ".claude/hooks/sdd-router.mjs",
  ".claude/hooks/graph-first.mjs",
  ".claude/settings.json",
  ".claude/agents/explorer.md",
  ".claude/agents/reviewer.md",
  ".claude/agents/gate-runner.md",
  ".claude/commands/gate.md",
  ".claude/commands/lesson.md",
  ".claude/commands/harness-audit.md",
  ".claude/skills/nuevo-freno/SKILL.md",
  "scripts/gate.sh",
  "scripts/repo-lint.mjs",
  "scripts/harness-selftest.mjs",
  "scripts/docs-linkcheck.mjs",
  "scripts/artifacts-check.mjs",
  ".githooks/pre-commit",
  ".githooks/commit-msg",
  ".githooks/post-commit",
];

/** Plantillas: van a la raíz del destino con nombre final, para que el equipo las llene. */
const PLANTILLAS = [
  ["plantillas/CONSTITUTION.md", "CONSTITUTION.md"],
  ["plantillas/STATUS.md", "STATUS.md"],
  ["plantillas/gotchas.md", "docs/gotchas.md"],
  ["plantillas/harness.config.json", ".claude/harness.config.json"],
];

const EJECUTABLES = new Set(["scripts/gate.sh", ".githooks/pre-commit", ".githooks/commit-msg", ".githooks/post-commit"]);

const acciones = [];
for (const rel of COPIAR) acciones.push({ tipo: "copia", desde: rel, hacia: rel });
for (const [desde, hacia] of PLANTILLAS) acciones.push({ tipo: "plantilla", desde, hacia });

let copiados = 0;
let conservados = 0;

for (const a of acciones) {
  const src = path.join(ORIGEN, a.desde);
  const dst = path.join(DESTINO, a.hacia);
  if (!fs.existsSync(src)) {
    console.log(`  ! falta en el origen: ${a.desde}`);
    continue;
  }
  if (fs.existsSync(dst)) {
    console.log(`  = conservado (ya existe): ${a.hacia}`);
    conservados += 1;
    continue;
  }
  console.log(`  ${APLICAR ? "+" : "→"} ${a.hacia}${a.tipo === "plantilla" ? "   (plantilla: hay que llenarla)" : ""}`);
  copiados += 1;
  if (!APLICAR) continue;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  if (EJECUTABLES.has(a.hacia)) fs.chmodSync(dst, 0o755);
}

console.log("");
if (!APLICAR) {
  console.log(`DRY-RUN: ${copiados} archivo(s) a copiar, ${conservados} conservado(s).`);
  console.log(`Para escribir de verdad: node scripts/harness-init.mjs ${destinoArg} --apply`);
  process.exit(0);
}

console.log(`Instalado: ${copiados} archivo(s) copiado(s), ${conservados} conservado(s).`);
console.log(`
IMPORTANTE: el self-test va a estar ROJO hasta que llenes las plantillas, y eso es lo
esperado — el config de arranque trae placeholders a propósito. Ese rojo ES el mapa de lo
que falta: cada línea nombra la clave que todavía apunta a la nada.

Falta lo que ninguna herramienta puede adivinar — y es donde está el valor:

  1. .claude/harness.config.json → gate.signals
     Las señales REALES de este repo (tests, tipos, build, lint), cada una con su \`why\`.
     Leé el manifiesto y el CI del repo antes de escribirlas. Un gate vacío no verifica nada.

  2. .claude/harness.config.json → protectedPaths, bash.deny, purity, patterns
     Traducí las convenciones de este repo a reglas. Empezá por lo que ya se rompió una vez.

  3. Scripts del manifiesto (package.json, Makefile, justfile…):
       gate       → bash scripts/gate.sh
       gate:fast  → bash scripts/gate.sh fast

  4. git config core.hooksPath .githooks      (pre-commit y commit-msg reales, no .sample)

  4b. .claude/harness.config.json → tracker
     El patrón de referencia de TU forja (#123, AB#123, PROJ-123…). Copiar el de otro
     equipo hace que el freno nunca encuentre la referencia y todos escriban
     `sin-issue:` como ritual. Ver docs/trazabilidad.md.

  5. CONSTITUTION.md y STATUS.md: principios que este repo puede hacer cumplir HOY.
     Un principio BLOCKING sin comando que falle es un principio REVIEW mal etiquetado.

  6. CI: que corra EL MISMO gate. Si CI verifica algo distinto, una de las dos señales miente.

Después: node scripts/harness-selftest.mjs && bash scripts/gate.sh
`);
