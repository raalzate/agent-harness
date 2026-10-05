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

/**
 * Qué herramientas de un servidor MCP ESCRIBEN EN EL REPO, y dónde traen la ruta y el contenido.
 *
 * Los frenos de escritura nacieron mirando sólo las herramientas propias de Claude Code
 * (`Write`, `Edit`…), y un servidor MCP que edita código —un índice de símbolos con
 * `replace_symbol_body`, un servidor de filesystem con `write_file`— pasaba de largo:
 * `protected-paths` no lo veía, así que P8 tenía una puerta lateral abierta.
 *
 * Se decide por el VERBO del nombre, no por servidor: una lista de servidores conocidos es la
 * lista de un repo, y el siguiente servidor instalado nace sin freno. Una herramienta de
 * lectura (`find_symbol`, `read_file`) no casa y sale en la primera línea del hook (el proceso
 * se lanza igual: el matcher de settings no sabe leer verbos). Cada repo lo angosta o lo amplía
 * con `writeTools` en el config.
 *
 * `pathFields` son TODOS los campos que nombran un archivo del árbol, y se evalúan todos: un
 * `move_file` trae `source` y `destination`, y mirar sólo el primero dejaba mover algo ENCIMA
 * de `.env`. `broadPattern` nombra las que escriben sin ruta (sobre todo el proyecto).
 */
export const DEFAULT_WRITE_TOOLS = {
  pattern: "^mcp__.+__(write|edit|create|replace|insert|rename|delete|safe_delete|move|update|apply|patch)",
  broadPattern: "_in_files$",
  pathFields: ["file_path", "notebook_path", "relative_path", "path", "source", "destination"],
  contentFields: ["content", "new_string", "body", "repl", "new_source"],
};

/** El prefijo con que Claude Code nombra toda herramienta de un servidor MCP. */
const PREFIJO_MCP = "mcp__";

/** `writeTools` del config, campo por campo sobre el default agnóstico. */
export const writeTools = (config) => {
  const d = config?.writeTools ?? {};
  const lista = (v, def) => (Array.isArray(v) && v.length ? v : def);
  const texto = (v, def) => (typeof v === "string" && v.trim() ? v : def);
  return {
    pattern: texto(d.pattern, DEFAULT_WRITE_TOOLS.pattern),
    broadPattern: texto(d.broadPattern, DEFAULT_WRITE_TOOLS.broadPattern),
    pathFields: lista(d.pathFields, DEFAULT_WRITE_TOOLS.pathFields),
    contentFields: lista(d.contentFields, DEFAULT_WRITE_TOOLS.contentFields),
  };
};

/** ¿La herramienta viene de un servidor MCP? Las propias las filtra el matcher de settings. */
export const esHerramientaMcp = (input) => String(input?.tool_name ?? "").startsWith(PREFIJO_MCP);

/** Un regex del config; uno roto casa siempre (un freno se decide hacia el lado seguro). */
const casa = (patron, texto) => {
  try {
    return new RegExp(patron).test(texto);
  } catch {
    return true;
  }
};

/** Los campos de ruta que la llamada trae de verdad (un string, aunque sea vacío). */
const camposDeRuta = (input, config) => {
  const ti = input?.tool_input ?? {};
  const campos = esHerramientaMcp(input) ? writeTools(config).pathFields : ["file_path", "notebook_path"];
  return campos.filter((c) => typeof ti[c] === "string");
};

/**
 * ¿Esta llamada escribe en el repo? Las herramientas propias llegan ya filtradas por el matcher
 * de `settings.json`; las de MCP llegan TODAS, y acá se separa la escritura de la lectura.
 *
 * El verbo solo no alcanza: `create-project` de un servidor de despliegue o `update_page` de un
 * gestor de documentos escriben FUERA del árbol —aunque traigan `content`—, y tratarlos como
 * edición marcaba el gate pendiente sin un archivo tocado. Escribe en el repo la que trae una
 * RUTA, o la que `broadPattern` declara como escritura sobre todo el proyecto.
 */
export function escribe(input, config) {
  if (!esHerramientaMcp(input)) return true;
  const wt = writeTools(config);
  if (!casa(wt.pattern, input.tool_name)) return false;
  return camposDeRuta(input, config).length > 0 || casa(wt.broadPattern, input.tool_name);
}

/**
 * ¿Es una escritura MCP SIN archivo concreto? (`replace_in_files` sobre todo el proyecto, un
 * directorio entero). Ningún freno por ruta puede evaluarla entera de antemano: `action-guard`
 * la trata como «dentro del repo», `post-edit-check` marca el gate, y `protected-paths` mira el
 * directorio con su `/` final; lo de adentro lo sostiene el pre-commit.
 */
export function escrituraAmplia(input, config) {
  if (!esHerramientaMcp(input) || !escribe(input, config)) return false;
  const rutas = rutasAbsolutas(input, config);
  if (!rutas.length) return true;
  return rutas.some((abs) => {
    try {
      return fs.statSync(abs).isDirectory();
    } catch {
      return false; // todavía no existe: es un archivo nuevo, y eso sí tiene ruta
    }
  });
}

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

/**
 * Ni seguir ni bloquear: que DECIDA EL HUMANO. Claude Code muestra `motivo` en el pedido de
 * permiso; si dice que sí, la herramienta corre. Es exit 0 con JSON en stdout, no exit 2: un
 * bloqueo no se puede confirmar, así que «pedí confirmación» en un `deny` no tenía salida.
 */
export function ask(motivo, input) {
  // Sin evento, Claude Code no reconoce la decisión y el comando correría sin preguntar: el
  // freno desaparecería en silencio. Hacia el lado seguro, bloquea con el mismo motivo.
  if (!input?.hook_event_name) deny(`${motivo}\n(no llegó el evento del hook: sin él no se puede preguntar, así que se bloquea)`);
  process.stdout.write(
    `${JSON.stringify({
      // El evento sale del payload, no se cablea: un hook no decide en qué evento corre (P4).
      hookSpecificOutput: { hookEventName: input?.hook_event_name, permissionDecision: "ask", permissionDecisionReason: motivo },
    })}\n`,
  );
  process.exit(0);
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
/**
 * Los segmentos de una ruta absoluta.
 *
 * En Windows conviven los dos separadores: el agente puede mandar `C:\repo\src\x.ts` o
 * `C:/repo/src/x.ts`, y a veces mezclados. Partir sólo por `path.sep` dejaba la ruta entera
 * como UN segmento, y con eso ninguna regla por ruta cazaba nada: el freno no fallaba,
 * simplemente no existía en esa plataforma. Toma la plataforma como parámetro para que el
 * caso de Windows se pueda probar desde cualquier máquina.
 */
export const segmentosDeRuta = (abs, plataforma = process.platform) =>
  plataforma === "win32" ? abs.split(/[\\/]/) : abs.split(path.sep);

/**
 * ¿Es la unidad pelada de Windows (`C:`, `d:`)?
 *
 * Importa porque `C:` NO significa «la raíz de C:»: significa «el directorio actual de la
 * unidad C:». Al subir prefijos, ese trozo resolvía al `cwd` del proceso —el propio repo— y
 * entonces CUALQUIER ruta de esa unidad se veía como interna: escribir en el temporal quedaba
 * bloqueado. La raíz de verdad es `C:\\`, con barra.
 */
export const esUnidadPelada = (p) => /^[A-Za-z]:$/.test(p);

function relativaAlRepo(abs) {
  const partes = segmentosDeRuta(abs);
  for (let i = partes.length; i > 0; i -= 1) {
    const prefijo = partes.slice(0, i).join(path.sep) || path.sep;
    if (esUnidadPelada(prefijo)) continue;
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

/**
 * TODAS las rutas absolutas que la herramienta va a tocar. Las propias la traen en `file_path`
 * o `notebook_path`; las de MCP, en los campos de `writeTools.pathFields` (un `move` trae dos).
 * En MCP una ruta VACÍA es «todo el proyecto» (el default de un reemplazo masivo), no «nada».
 */
function rutasAbsolutas(input, config) {
  const ti = input?.tool_input ?? {};
  const mcp = esHerramientaMcp(input);
  const base = input?.cwd ?? REPO_ROOT;
  return camposDeRuta(input, config)
    .map((c) => ti[c].trim())
    .filter((raw) => raw || mcp)
    .map((raw) => (path.isAbsolute(raw) ? raw : path.join(base, raw)));
}

/** La primera: alcanza para «¿esto es código?» y para el mensaje. */
const rutaAbsoluta = (input, config) => rutasAbsolutas(input, config)[0] ?? "";

/**
 * La ruta relativa a la raíz, con `/`, y con `../` adelante si cae FUERA.
 *
 * El `../` no es cosmético: es la única señal que los hooks miran para decidir «esto no es
 * asunto de este repo». Y en Windows había un agujero — entre unidades distintas
 * (`D:\a\repo` y el temporal en `C:\`), `path.relative` no puede escribir un camino relativo
 * y devuelve la ruta ABSOLUTA, que no empieza con `..`. Resultado: todo lo de afuera pasaba
 * por dentro, y `action-guard` bloqueaba escribir un borrador en el temporal. Lo encontró la
 * matriz de CI en Windows, no una lectura del código.
 *
 * Toma raíz y plataforma como parámetros para que ese caso se pueda probar desde cualquier
 * máquina.
 */
export function relativaDesdeRaiz(abs, root = REPO_ROOT, plataforma = process.platform) {
  const p = plataforma === "win32" ? path.win32 : path.posix;
  const rel = p.relative(root, abs);
  if (!p.isAbsolute(rel)) return rel.split(/[\\/]/).join("/");
  return `../${rel.split(/[\\/]/).filter(Boolean).join("/")}`;
}

/** Ruta del archivo que la herramienta va a tocar, relativa al repo y con `/`. */
export function targetPath(input, config) {
  const abs = rutaAbsoluta(input, config);
  if (!abs) return "";
  // Dentro del repo → la ruta relativa. Fuera → una relativa con `..`, que es lo que los
  // hooks ya interpretan como «no es asunto de este repo».
  return relativaAlRepo(abs) ?? relativaDesdeRaiz(abs);
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
export function targetPaths(input, config) {
  const nombres = [];
  for (const abs of rutasAbsolutas(input, config)) {
    // Un directorio se nombra con su `/` final: así lo escriben las reglas (`^node_modules/`),
    // y sin la barra una escritura sobre el directorio entero no casaba ninguna.
    let dir = false;
    try {
      dir = fs.statSync(abs).isDirectory();
    } catch {
      dir = false;
    }
    for (const candidata of [abs, conSymlinksResueltos(abs)]) {
      const rel = relativaAlRepo(candidata);
      const nombre = rel && dir ? `${rel}/` : rel;
      if (nombre && !nombres.includes(nombre)) nombres.push(nombre);
    }
  }
  return nombres.length ? nombres : [targetPath(input, config)].filter(Boolean);
}

/** Contenido que la herramienta quiere escribir (Write, Edit, MultiEdit o una de MCP). */
export function proposedContent(input, config) {
  const ti = input?.tool_input ?? {};
  if (Array.isArray(ti.edits)) return ti.edits.map((e) => e?.new_string ?? "").join("\n");
  const campos = esHerramientaMcp(input) ? writeTools(config).contentFields : ["content", "new_string"];
  return campos.map((c) => ti[c]).find((v) => typeof v === "string") ?? "";
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

/**
 * Qué ejecuta un hook declarado en `settings.json`: `{file, tipo, etiqueta}`, o `null`.
 *
 * NO todo hook es `node <archivo>`: un repo real declara binarios externos y usa
 * `$CLAUDE_PROJECT_DIR` con comillas, como recomienda la documentación de Claude Code.
 * Asumir `node <archivo>` daba falso rojo sobre hooks que existían y funcionaban.
 *
 * Vive acá y no en el script que lo usaba porque ya son dos los que necesitan leer esa
 * declaración —el self-test y la medición de latencia—, y dos parsers del mismo formato
 * son dos verdades: el día que un repo escriba su comando distinto, uno de los dos miente.
 */
export function parseHookCommand(comando) {
  const limpio = String(comando ?? "")
    .replace(/["']/g, "")
    .replace(/\$\{?CLAUDE_PROJECT_DIR\}?\/?/g, "")
    .trim();
  if (!limpio) return null;

  const conNode = /(?:^|\s)node\s+(?:--\S+\s+)*(\S+)/.exec(limpio);
  // Con `node` el archivo es del repo y se le puede exigir que parsee.
  if (conNode) return { file: conNode[1], tipo: "script", etiqueta: conNode[1] };

  // Sin `node`: un ejecutable. De un binario externo sólo se puede afirmar que EXISTE.
  return { file: limpio.split(/\s+/)[0], tipo: "ejecutable", etiqueta: limpio.split(/\s+/)[0] };
}

/**
 * Windows no ejecuta `npm`, `npx` ni `gradlew` directamente: son `.cmd`/`.bat`, y Node los
 * rechaza con EINVAL salvo que se los busque con su extensión real. Fuera de Windows esto
 * devuelve el nombre tal cual y no cambia nada. Vive acá y no en el gate porque ya son dos los
 * que lanzan comandos del config —el gate y el panel—, y la alternativa (`shell: true`) es
 * interpolar datos del config en una línea de comandos.
 */
export function resolverEjecutable(cmd) {
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

/**
 * ¿El ejecutable existe en esta máquina? Se pregunta ANTES de lanzarlo, en vez de deducirlo del
 * error: en Windows los comandos del config corren a través de `cmd.exe` (Node no lanza un
 * `.cmd` como `npm` sin shell), y ahí un binario ausente no es `ENOENT` sino un exit 1 con
 * «no se reconoce como comando». Lo destapó la matriz de CI: `--verify-red` tomaba ese exit 1 por
 * «las pruebas fallan» (un falso verde) y el eval del revisor por un eval roto en vez de OMITIDO.
 */
export function existeEjecutable(cmd, plataforma = process.platform) {
  if (!cmd) return false;
  if (cmd.includes("/") || cmd.includes("\\")) return fs.existsSync(path.resolve(REPO_ROOT, cmd));
  const exts = plataforma === "win32" ? ["", ...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)] : [""];
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => exts.some((ext) => fs.existsSync(path.join(dir, cmd + ext))));
}
