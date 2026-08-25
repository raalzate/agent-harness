#!/usr/bin/env node
/**
 * Lint de convenciones del repo — sin dependencias, agnóstico de lenguaje.
 *
 * No reemplaza al linter de tu stack (ESLint, ruff, golangci-lint): verifica las reglas
 * del PROYECTO que ninguna config estándar cubre, y las verifica con UN COMANDO QUE FALLA.
 * Una regla en markdown sin esto es una sugerencia.
 *
 *   node scripts/repo-lint.mjs                          # todo el repo (señal del gate)
 *   node scripts/repo-lint.mjs --file <ruta>            # sólo ese archivo (hook PostToolUse)
 *   node scripts/repo-lint.mjs --file <ruta> --stdin    # contenido por stdin; la ruta sólo elige reglas
 *   node scripts/repo-lint.mjs --rules                  # qué reglas están activas y de dónde salen
 *
 * TODAS las reglas salen de `.claude/harness.config.json`. Agregar una regla al proyecto
 * es editar JSON; agregar una CLASE de regla nueva es tocar este archivo (y su caso en el
 * self-test, o el freno es decorativo).
 *
 * Clases de regla:
 *   PUREZA       una capa no importa lo que no le corresponde       config → purity[]
 *   DEPS         dependencias que el proyecto decidió no tener      config → forbiddenDeps
 *   ONLY         un `.only(` olvidado apaga la suite en silencio    config → tests
 *   FUENTEUNICA  un registro es la única fuente de esos literales   config → singleSource[]
 *   INVARIANTE   un archivo conserva/prohíbe líneas concretas       config → invariants[]
 *   PATRON       texto prohibido en un ámbito, con su motivo        config → patterns[]
 *   INCIDENTE    todo gotcha declara su MECANISMO                   config → incidents
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CONFIG_PATH = path.join(REPO_ROOT, ".claude", "harness.config.json");

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
} catch (e) {
  console.error(`repo-lint: no pude leer ${path.relative(REPO_ROOT, CONFIG_PATH)} — ${e.message}`);
  process.exit(1);
}

const problems = [];
const fail = (file, line, rule, message) => problems.push({ file, line, rule, message });

const rel = (abs) => path.relative(REPO_ROOT, abs).split(path.sep).join("/");
const read = (relPath) => fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
const lineOf = (content, index) => content.slice(0, index).split("\n").length;

/** Extensiones que se consideran «fuente» al barrer el repo. Agnóstico: no asume un stack. */
const SOURCE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|kts|rb|php|cs|swift|scala|sh|bash|sql|vue|svelte|html)$/;

/** Compila un regex del config sin reventar el turno del agente si está mal escrito. */
function re(pattern, flags = "") {
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    fail(".claude/harness.config.json", 0, "CONFIG", `regex inválido \`${pattern}\`: ${e.message}`);
    return null;
  }
}

/** Archivos fuente versionables del repo (sin derivados ni dependencias). */
function sourceFiles() {
  const skip = new Set([...(config.docs?.ignore ?? []), "node_modules", ".git"]);
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (SOURCE_EXT.test(entry.name)) out.push(rel(abs));
    }
  };
  walk(REPO_ROOT);
  return out;
}

const underDir = (relPath, dir) => relPath === dir || relPath.startsWith(dir.endsWith("/") ? dir : `${dir}/`);

// ── Reglas por archivo ───────────────────────────────────────────────────────

/**
 * PUREZA — una capa no importa lo que no le corresponde.
 *
 * Es la regla de mayor retorno del arnés: mantiene una capa de lógica pura,
 * testeable y estable mientras el resto del proyecto cambia de framework.
 */
function checkPurity(relPath, content) {
  for (const layer of config.purity ?? []) {
    if (!layer.dir || !underDir(relPath, layer.dir)) continue;
    if ((layer.except ?? []).includes(relPath)) continue;
    for (const mod of layer.forbiddenImports ?? []) {
      // import ... from "mod"  ·  require("mod")  ·  import "mod"  ·  from mod import (python)
      const pattern = new RegExp(
        `(from\\s+['"]${escape(mod)}|require\\(\\s*['"]${escape(mod)}|import\\s+['"]${escape(mod)}|^\\s*(import|from)\\s+${escape(mod)}\\b)`,
        "m",
      );
      const hit = pattern.exec(content);
      if (hit) {
        fail(
          relPath,
          lineOf(content, hit.index),
          "PUREZA",
          `\`${layer.dir}\` no importa \`${mod}\`. ${layer.reason ?? ""}`.trim(),
        );
      }
    }
  }
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ONLY — un `.only(` olvidado apaga la suite entera y el gate sale verde. */
function checkOnly(relPath, content) {
  const t = config.tests;
  if (!t?.onlyPattern || !t?.filePattern) return;
  const isTest = re(t.filePattern);
  if (!isTest || !isTest.test(relPath)) return;
  const only = re(t.onlyPattern, "g");
  if (!only) return;
  for (const hit of content.matchAll(only)) {
    fail(
      relPath,
      lineOf(content, hit.index),
      "ONLY",
      "`.only(` apaga el resto de la suite en silencio y el gate sale verde igual. Borralo antes de commitear.",
    );
  }
}

/** FUENTEUNICA — un registro es la única fuente de verdad de esos literales. */
function checkSingleSource(relPath, content) {
  for (const rule of config.singleSource ?? []) {
    const scope = re(rule.appliesTo ?? "");
    if (!scope || !scope.test(relPath)) continue;
    if (relPath === rule.source) continue;
    if ((rule.allow ?? []).includes(relPath)) continue;

    const literals = rule.literals ?? literalsFromSource(rule);
    for (const literal of literals) {
      const hit = new RegExp(`['"\`]${escape(literal)}['"\`]`).exec(content);
      if (hit) {
        fail(
          relPath,
          lineOf(content, hit.index),
          rule.id ?? "FUENTEUNICA",
          `el literal \`${literal}\` sale de \`${rule.source}\`, no se cablea acá. ${rule.reason ?? ""}`.trim(),
        );
        break; // un hallazgo por archivo y por regla: el mensaje ya dice qué hacer
      }
    }
  }
}

/** Literales extraídos del archivo fuente con `extract` (grupo 1 del regex). */
function literalsFromSource(rule) {
  if (!rule.extract || !rule.source) return [];
  try {
    const src = read(rule.source);
    const pattern = re(rule.extract, "g");
    if (!pattern) return [];
    return [...new Set([...src.matchAll(pattern)].map((m) => m[1] ?? m[0]))];
  } catch {
    fail(".claude/harness.config.json", 0, "CONFIG", `singleSource.source no existe: \`${rule.source}\``);
    return [];
  }
}

/** PATRON — texto prohibido en un ámbito, con su motivo. La clase más usada al portar. */
function checkPatterns(relPath, content) {
  for (const rule of config.patterns ?? []) {
    const scope = re(rule.appliesTo ?? "");
    if (!scope || !scope.test(relPath)) continue;
    if ((rule.allow ?? []).includes(relPath)) continue;
    const pattern = re(rule.pattern, "g");
    if (!pattern) continue;
    for (const hit of content.matchAll(pattern)) {
      fail(relPath, lineOf(content, hit.index), rule.id ?? "PATRON", rule.message ?? `patrón prohibido: ${rule.pattern}`);
    }
  }
}

function checkFile(relPath, contenidoDado = null) {
  let content = contenidoDado;
  if (content === null) {
    try {
      content = read(relPath);
    } catch {
      return; // el archivo desapareció entre el listado y la lectura: no es un hallazgo
    }
  }
  checkPurity(relPath, content);
  checkOnly(relPath, content);
  checkSingleSource(relPath, content);
  checkPatterns(relPath, content);
}

// ── Reglas globales ──────────────────────────────────────────────────────────

/** DEPS — dependencias que el proyecto decidió no tener (con su motivo). */
function checkDeps() {
  const spec = config.forbiddenDeps;
  if (!spec?.manifest || !(spec.packages ?? []).length) return;
  let manifest;
  try {
    manifest = read(spec.manifest);
  } catch {
    return; // sin manifiesto (proyecto de otro stack): la regla no aplica
  }
  for (const pkg of spec.packages) {
    const hit = new RegExp(`^\\s*["']?${escape(pkg)}["']?\\s*[:=]`, "m").exec(manifest);
    if (hit) {
      fail(
        spec.manifest,
        lineOf(manifest, hit.index),
        "DEPS",
        `\`${pkg}\` está prohibida en este proyecto. ${spec.reason ?? ""}`.trim(),
      );
    }
  }
}

/** INVARIANTE — un archivo conserva las líneas que lo hacen funcionar y no las que lo rompen. */
function checkInvariants() {
  for (const inv of config.invariants ?? []) {
    let content;
    try {
      content = read(inv.file);
    } catch {
      fail(inv.file, 0, "INVARIANTE", `el archivo del invariante no existe. ${inv.reason ?? ""}`.trim());
      continue;
    }
    for (const needle of inv.required ?? []) {
      if (!content.includes(needle)) {
        fail(inv.file, 0, "INVARIANTE", `falta \`${needle}\`. ${inv.reason ?? ""}`.trim());
      }
    }
    for (const needle of inv.forbidden ?? []) {
      const i = content.indexOf(needle);
      if (i !== -1) {
        fail(inv.file, lineOf(content, i), "INVARIANTE", `\`${needle}\` no puede estar acá. ${inv.reason ?? ""}`.trim());
      }
    }
  }
}

/**
 * INCIDENTE — todo gotcha declara su MECANISMO.
 *
 * Lo que una máquina puede verificar del principio «cada incidente deja infraestructura»
 * es que el registro no se degrade a anécdota: qué se vio, por qué pasó, qué regla queda
 * y —lo que importa— qué comando falla si alguien lo repite. Un gotcha sin `Mecanismo:`
 * es prosa que se va a volver a pagar.
 */
function checkIncidents(contenidoDado = null) {
  const spec = config.incidents;
  if (!spec?.file) return;
  let content = contenidoDado;
  if (content === null) {
    try {
      content = read(spec.file);
    } catch {
      fail(spec.file, 0, "INCIDENTE", "falta el registro de incidentes que declara el config.");
      return;
    }
  }
  const heading = spec.heading ?? "### GOTCHA";
  const lines = content.split("\n");
  const starts = [];
  lines.forEach((l, i) => l.startsWith(heading) && starts.push(i));
  if (!starts.length) return;

  starts.forEach((start, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1] : lines.length;
    const block = lines.slice(start, end).join("\n");
    const title = lines[start].slice(heading.length).replace(/^[:\s]+/, "").trim() || "(sin título)";
    for (const required of spec.requiredLines ?? []) {
      if (!block.includes(required)) {
        fail(
          spec.file,
          start + 1,
          "INCIDENTE",
          `el gotcha «${title}» no declara \`${required}\`. Formato fijo: ${(spec.requiredLines ?? []).join(" · ")}.`,
        );
      }
    }
  });
}

// ── Ejecución ────────────────────────────────────────────────────────────────

if (process.argv.includes("--rules")) {
  const filas = [
    ["PUREZA", `${(config.purity ?? []).length} capa(s)`, (config.purity ?? []).map((p) => p.dir).join(", ")],
    ["DEPS", `${(config.forbiddenDeps?.packages ?? []).length} paquete(s)`, config.forbiddenDeps?.manifest ?? "—"],
    ["ONLY", config.tests?.onlyPattern ? "activa" : "inactiva", config.tests?.filePattern ?? "—"],
    ["FUENTEUNICA", `${(config.singleSource ?? []).length} registro(s)`, (config.singleSource ?? []).map((r) => r.source).join(", ")],
    ["INVARIANTE", `${(config.invariants ?? []).length} archivo(s)`, (config.invariants ?? []).map((r) => r.file).join(", ")],
    ["PATRON", `${(config.patterns ?? []).length} patrón(es)`, (config.patterns ?? []).map((r) => r.id).join(", ")],
    ["INCIDENTE", config.incidents?.file ? "activa" : "inactiva", config.incidents?.file ?? "—"],
  ];
  console.log("Reglas activas (todas salen de .claude/harness.config.json):\n");
  for (const [regla, estado, detalle] of filas) console.log(`  ${regla.padEnd(12)} ${estado.padEnd(16)} ${detalle}`);
  process.exit(0);
}

const fileFlagIndex = process.argv.indexOf("--file");
const single = fileFlagIndex !== -1 ? process.argv[fileFlagIndex + 1] : null;

// `--stdin`: el contenido llega por la entrada estándar y la ruta sólo elige las reglas.
// Así el self-test prueba los frenos SIN escribir archivos temporales dentro del árbol
// de fuentes (un watcher vivo los ve aparecer y desaparecer, y el build muere con ENOENT).
const desdeStdin = process.argv.includes("--stdin");
const contenidoStdin = desdeStdin ? fs.readFileSync(0, "utf8") : null;

if (single) {
  const relPath = single.split(path.sep).join("/");
  if (relPath === config.incidents?.file) checkIncidents(contenidoStdin);
  else if (relPath === config.forbiddenDeps?.manifest && !desdeStdin) checkDeps();
  else checkFile(relPath, contenidoStdin);
} else {
  for (const f of sourceFiles()) checkFile(f);
  checkDeps();
  checkInvariants();
  checkIncidents();
}

if (problems.length) {
  console.error(`\nrepo-lint: ${problems.length} problema(s)\n`);
  for (const p of problems) console.error(`  ${p.file}:${p.line}  [${p.rule}]  ${p.message}`);
  console.error("\nCada regla vive en `.claude/harness.config.json`. Si la regla está mal, se discute y se cambia ahí — no se ignora.");
  process.exit(1);
}

console.log(single ? `repo-lint: ${single} OK` : "repo-lint: OK");
