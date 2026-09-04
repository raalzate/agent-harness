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

/**
 * Qué extensiones cuentan como CÓDIGO cuando el config no lo dice.
 *
 * Vive acá y NO en cada consumidor porque tener dos listas es tener dos verdades: la primera
 * versión de esto cableó las extensiones en `post-edit-check.mjs` y otra lista distinta en
 * `repo-lint.mjs`, y divergieron en un release (`.pyi` marcaba el gate pero el barrido del gate
 * nunca leía el archivo: PATRON y PUREZA ciegas justo en la señal que manda).
 *
 * Es el superconjunto agnóstico, no la lista de un stack: cada repo la angosta por config
 * (`gate.codeExtensions` para qué ensucia el gate, `lint.sourceExtensions` para qué barre el lint).
 */
export const DEFAULT_CODE_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".html",
  ".cs", ".fs", ".fsx", ".vb", ".java", ".kt", ".kts", ".scala", ".groovy", ".gradle",
  ".py", ".pyi", ".go", ".rs", ".rb", ".php", ".swift", ".dart", ".ex", ".exs", ".clj",
  ".c", ".h", ".cc", ".cpp", ".hpp", ".m", ".mm", ".sh", ".bash", ".sql",
];

/**
 * Cómo se escribe «importar X» en cada familia de lenguajes. Plantillas con `{mod}`.
 *
 * Default agnóstico de la regla PUREZA. Vive acá junto con el otro default compartido por el
 * mismo motivo: el self-test tenía su propia versión cableada en JS y por eso daba FALSO ROJO
 * sobre una regla que funcionaba, en cualquier repo que no fuera JS. Un falso rojo enseña a
 * ignorar la sección entera, que es peor que no tener la sección.
 */
export const DEFAULT_IMPORT_SYNTAX = [
  "from\\s+['\"]{mod}['\"]", //           JS/TS: import x from "mod"
  "require\\(\\s*['\"]{mod}['\"]", //     CommonJS
  "import\\s+['\"]{mod}['\"]", //         import "mod" (JS, Go)
  "^\\s*(?:import|from)\\s+{mod}\\b", //  Python, Java, Kotlin, Scala
  "^\\s*using\\s+(?:static\\s+)?{mod}\\b", // C#, F#
  "^\\s*use\\s+{mod}\\b", //              Rust, PHP
  "^\\s*#include\\s*[<\"]{mod}", //       C, C++, Objective-C
];

/**
 * Cómo se escribe «el manifiesto declara el paquete X». Plantilla con `{pkg}`.
 *
 * Default agnóstico de la regla DEPS: sólo entiende manifiestos clave-valor (`package.json`,
 * `requirements.txt`, `go.mod`, un `.toml`). Un `.csproj`, un `pom.xml` o la notación corta de
 * Gradle declaran su propio `forbiddenDeps.matcher` — sin él, DEPS sale VERDE con la dependencia
 * prohibida presente.
 *
 * Vive acá con los otros dos defaults por el mismo motivo: estaba cableado en `repo-lint.mjs` y
 * el self-test no podía fabricar la muestra de un manifiesto sin copiarlo, o sea sin crear la
 * segunda verdad que este archivo existe para evitar.
 */
export const DEFAULT_DEPS_MATCHER = "^\\s*[\"']?{pkg}[\"']?\\s*[:=]";

/** El matcher declarado, o el agnóstico de clave-valor. */
export const depsMatcher = (declarado) =>
  typeof declarado === "string" && declarado.trim() ? declarado : DEFAULT_DEPS_MATCHER;

/** La sintaxis declarada, o el superconjunto agnóstico. */
export const importSyntax = (declaradas) =>
  Array.isArray(declaradas) && declaradas.length ? declaradas : DEFAULT_IMPORT_SYNTAX;

/** Extensiones declaradas, o el superconjunto agnóstico. Vacío = sin llenar, no «ninguna». */
export const codeExtensions = (declaradas) =>
  Array.isArray(declaradas) && declaradas.length ? declaradas : DEFAULT_CODE_EXTENSIONS;

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

/**
 * La ruta dentro del repo, o `null` si la ruta no está dentro.
 *
 * Se normaliza la RAÍZ, no el archivo: se busca el prefijo más largo de la ruta cuyo
 * `realpath` sea `REPO_ROOT`, y lo que sobra es la ruta relativa. Es la única forma que
 * funciona en las dos direcciones, y las dos se apagaban en silencio:
 *
 *  - el repo entero bajo un symlink: `REPO_ROOT` viene resuelto de `import.meta.url`
 *    (`/private/var/…` en macOS) y el `cwd` del payload llega literal (`/var/…`), así que
 *    comparar sin normalizar daba `../../..` para CUALQUIER archivo del repo;
 *  - un symlink INTERNO (`node_modules/<dep>` con pnpm o un workspace): si en cambio se
 *    resuelve el archivo entero, la ruta real apunta afuera y el freno se apaga hacia
 *    abajo — se puede escribir en dependencias sin que nada se ponga rojo.
 */
function relativaAlRepo(abs) {
  const partes = abs.split(path.sep);
  for (let i = partes.length; i > 0; i -= 1) {
    const prefijo = partes.slice(0, i).join(path.sep) || path.sep;
    let real;
    try {
      real = fs.realpathSync(prefijo);
    } catch {
      continue; // ese prefijo todavía no existe (es una escritura nueva): se sigue subiendo
    }
    if (real === REPO_ROOT) return partes.slice(i).join("/");
  }
  return null;
}

/** La ruta con los symlinks del ancestro existente resueltos (el archivo puede no existir). */
function conSymlinksResueltos(abs) {
  let dir = abs;
  const resto = [];
  while (!fs.existsSync(dir)) {
    const padre = path.dirname(dir);
    if (padre === dir) return abs;
    resto.unshift(path.basename(dir));
    dir = padre;
  }
  try {
    return path.join(fs.realpathSync(dir), ...resto);
  } catch {
    return abs;
  }
}

/** La ruta absoluta que la herramienta va a tocar. */
function rutaAbsoluta(input) {
  const raw = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path ?? "";
  if (!raw) return "";
  return path.isAbsolute(raw) ? raw : path.join(input?.cwd ?? REPO_ROOT, raw);
}

/** Ruta del archivo que la herramienta va a tocar, relativa al repo y con `/`. */
export function targetPath(input) {
  const abs = rutaAbsoluta(input);
  if (!abs) return "";
  // Dentro del repo → la ruta relativa. Fuera → una relativa con `..`, que es lo que los
  // hooks ya interpretan como «no es asunto de este repo».
  return relativaAlRepo(abs) ?? path.relative(REPO_ROOT, abs).split(path.sep).join("/");
}

/**
 * TODOS los nombres que ese archivo tiene dentro del repo.
 *
 * Un symlink interno no crea una ruta nueva: es otro nombre de una ruta que ya tiene dueño.
 * `alias/ → src/secreto/` alcanzaba `alias/x.js` y las reglas de NEGACIÓN no lo veían, así que
 * lo que estaba prohibido por un nombre se podía escribir por el otro.
 *
 * Para «¿esto es código?» da igual cuál se use (por eso `targetPath` devuelve una sola);
 * para prohibir, se evalúan todas y basta que UNA case: un freno se decide hacia el lado seguro.
 */
export function targetPaths(input) {
  const abs = rutaAbsoluta(input);
  if (!abs) return [];
  const nombres = [];
  for (const candidata of [abs, conSymlinksResueltos(abs)]) {
    const rel = relativaAlRepo(candidata);
    if (rel && !nombres.includes(rel)) nombres.push(rel);
  }
  return nombres.length ? nombres : [targetPath(input)];
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
