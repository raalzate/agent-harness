/**
 * Plomería compartida de los hooks del arnés.
 *
 * Los hooks son genéricos a propósito: TODO lo específico del repo vive en
 * `.claude/harness.config.json`. Cambiar una regla debe ser editar JSON, no código.
 *
 * Contrato con Claude Code:
 *  - la entrada llega como JSON por stdin;
 *  - exit 0 = seguir (stdout de UserPromptSubmit/SessionStart entra al contexto);
 *  - exit 2 = bloquear, y stderr es lo que lee el agente.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Raíz del repo: dos niveles arriba de .claude/hooks/ (fileURLToPath: rutas con espacios). */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const CONFIG_PATH = path.join(REPO_ROOT, ".claude", "harness.config.json");

/** Lee el JSON de stdin. Si no hay entrada válida, devuelve {} (nunca revienta el turno). */
export async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Carga la config del arnés. Un config ausente o inválido NO debe bloquear al humano. */
export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return null;
  }
}

/** Bloquea la herramienta/el cierre. El mensaje es lo único que el agente ve. */
export function deny(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

/** Deja pasar. */
export function allow(message) {
  if (message) process.stdout.write(`${message}\n`);
  process.exit(0);
}

/** Ruta del archivo que la herramienta va a tocar, relativa al repo y con `/`. */
export function targetPath(input) {
  const raw = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path ?? "";
  if (!raw) return "";
  const abs = path.isAbsolute(raw) ? raw : path.join(input?.cwd ?? REPO_ROOT, raw);
  return path.relative(REPO_ROOT, abs).split(path.sep).join("/");
}

/** Contenido que la herramienta quiere escribir (Write, Edit o MultiEdit). */
export function proposedContent(input) {
  const ti = input?.tool_input ?? {};
  if (typeof ti.content === "string") return ti.content;
  if (typeof ti.new_string === "string") return ti.new_string;
  if (Array.isArray(ti.edits)) return ti.edits.map((e) => e?.new_string ?? "").join("\n");
  return "";
}

/** Primer patrón de `rules` que casa con `text` (cada regla es {pattern, ...}). */
export function firstMatch(rules, text, flags = "i") {
  for (const rule of rules ?? []) {
    let re;
    try {
      re = new RegExp(rule.pattern, flags);
    } catch {
      continue; // patrón inválido: lo caza el self-test, no el turno del usuario
    }
    if (re.test(text)) return rule;
  }
  return null;
}

/** true si la ruta cae bajo alguno de los prefijos dados. */
export function underAny(relPath, prefixes) {
  return (prefixes ?? []).some((p) => relPath === p || relPath.startsWith(p.endsWith("/") ? p : `${p}/`));
}

/** Marca que hay código editado sin gate verde (lo lee el hook Stop). */
export function markGateDirty(config) {
  const marker = config?.gate?.marker;
  if (!marker) return;
  const abs = path.join(REPO_ROOT, marker);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, new Date().toISOString());
  } catch {
    /* si no se puede marcar, el gate sigue siendo responsabilidad del agente */
  }
}
