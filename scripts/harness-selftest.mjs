#!/usr/bin/env node
/**
 * Self-test del arnés — prueba de vida.
 *
 * Un hook roto, un regex mal escrito o un config que apunta a la nada fallan EN SILENCIO:
 * ninguna otra señal los ve. Este script responde, para cada regla, la única pregunta que
 * importa: «¿qué comando falla si alguien la viola?». La respuesta es este comando.
 *
 * Es el antídoto del anti-patrón «instalado y muerto»: archivos presentes cuyo eslabón
 * activador nunca corre.
 *
 * Cubre:
 *   1. cada hook declarado en .claude/settings.json existe y node lo parsea;
 *   2. cada ruta y cada regex de .claude/harness.config.json resuelve/compila;
 *   3. los hooks BLOQUEAN de verdad (se ejecutan con payloads derivados del config);
 *   4. las reglas del lint MUERDEN (se le pasa el contenido por stdin: no escribe archivos);
 *   5. el clasificador de pedidos no se degrada (una muestra por ruta);
 *   6. las señales del gate son ejecutables y los subagentes/comandos citados existen;
 *   7. el kit SDD declarado está instalado (en CI se reporta OMITIDO, nunca «pasó»);
 *   8. los perfiles de stack son instalables y NO llevan reglas de otro repo, y las configs
 *      de ejemplo que se publican para copiar parsean y compilan;
 *   9. el COSTO del arnés está medido: cada hook entra en su presupuesto de latencia;
 *  10. los controles FUERA del gate (deriva, prueba del reviewer, mapa) están vivos y el
 *      pipeline declarado en su `runner` los corre (ADR 0007).
 *  11. el PANEL se genera: determinista sin la capa en vivo, sus alarmas muerden sobre un cebo
 *      y callan sobre el repo real, y el gate lo regenera (con su registro) aunque salga rojo.
 *
 * Agnóstico: no conoce ningún stack. Todo lo que prueba lo deduce del config.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
// El mismo helper que usan el hook y el lint: comparar contra la lista DECLARADA dejaba pasar
// justo el caso del incidente (el gate declara una extensión que el default agnóstico no tiene).
import { codeExtensions, depsMatcher, importSyntax, segmentosDeRuta, relativaDesdeRaiz, esUnidadPelada, parseHookCommand, firstMatch, existeEjecutable } from "../.claude/hooks/harness.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const abs = (p) => path.join(REPO_ROOT, p);
const config = JSON.parse(fs.readFileSync(abs(".claude/harness.config.json"), "utf8"));
const settings = JSON.parse(fs.readFileSync(abs(".claude/settings.json"), "utf8"));
const EN_CI = Boolean(process.env.CI);

let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.error(`  ✗ ${name}\n      ${detail}`);
};
const skip = (name, detail) => console.log(`  – ${name} (omitido: ${detail})`);
const section = (title) => console.log(`\n${title}`);

/**
 * ¿Hay bash en esta máquina? Los hooks de git SON scripts de shell y está bien que lo sean:
 * git los ejecuta con el bash que trae Git for Windows. Pero el self-test tiene que poder
 * correr igual donde ese bash no está — reportando OMITIDO, nunca "pasó".
 */
const HAY_BASH = spawnSync("bash", ["-c", "exit 0"], { stdio: "ignore" }).status === 0;

const hookFiles = new Set();

/**
 * Un control que NO va en el gate (caro, o no determinista) vive sólo en el pipeline que lo
 * corre. Si el config lo enciende y ese pipeline no lo invoca, está instalado y muerto: la
 * clave `runner` nombra el archivo, y esto verifica que exista y que lo invoque.
 */
function corredorDeclarado(nombre, runner, invocacion) {
  if (!runner) return bad(`${nombre} tiene quien la corra`, "está encendida y no declara `runner`: nadie la invoca");
  if (!fs.existsSync(abs(runner))) return bad(`${nombre} tiene quien la corra`, `\`runner\` apunta a \`${runner}\`, que no existe`);
  // El pipeline puede invocar el script directo o por su nombre de npm: las dos formas cuentan.
  let scripts = {};
  try {
    scripts = JSON.parse(fs.readFileSync(abs("package.json"), "utf8")).scripts ?? {};
  } catch {
    scripts = {};
  }
  const formas = [invocacion, ...Object.entries(scripts).filter(([, c]) => c.includes(invocacion)).map(([n]) => `npm run ${n}`)];
  const texto = fs.readFileSync(abs(runner), "utf8");
  if (!formas.some((f) => texto.includes(f)))
    return bad(`${nombre} tiene quien la corra`, `\`${runner}\` no invoca \`${invocacion}\`: encendida y muerta`);
  ok(`${nombre} la corre \`${runner}\``);
}

/** Ejecuta un hook con un payload por stdin. Devuelve {status, stdout, stderr}. */
function runHook(hookFile, payload) {
  const res = spawnSync("node", [abs(`.claude/hooks/${hookFile}`)], {
    input: JSON.stringify({ cwd: REPO_ROOT, ...payload }),
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const writeInput = (file, content = "x") => ({
  hook_event_name: "PreToolUse",
  tool_name: "Write",
  tool_input: { file_path: abs(file), content },
});

/** Un literal (un nombre de paquete, un módulo) puesto DENTRO de un regex, sin que actúe. */
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Muestra concreta que un regex del config debería cazar.
 *
 * Existe para que el self-test sea AGNÓSTICO: no lleva una lista de comandos peligrosos
 * cableada, la deduce de las reglas que el proyecto realmente escribió. Si un patrón es
 * tan retorcido que esto no lo puede reducir, el caso se reporta como omitido —nunca
 * como pasado— y se prueba a mano.
 */
function sampleFromPattern(pattern) {
  if (/\(\?<|\\k</.test(pattern)) return null; // lookbehind / backreferences: fuera de alcance

  // Los metacaracteres ESCAPADOS son literales del ejemplo. Se los saca de circulación con
  // placeholders antes de tocar nada, o las reglas de abajo los confunden con sintaxis.
  const PH = { "|": "\u0001", "(": "\u0002", ")": "\u0003", "[": "\u0004", "]": "\u0005", "{": "\u0006", "}": "\u0007" };
  let s = pattern.replace(/\\([.\/\-*+?^$|(){}[\]])/g, (_m, c) => PH[c] ?? c);

  s = s.replace(/\(\?[!=][^)]*\)/g, ""); // lookahead: el ejemplo NO debe casarlo → se ignora
  s = s.replace(/\(\?:/g, "(");

  // Dos pasadas: los grupos anidados se resuelven de adentro hacia afuera.
  for (let i = 0; i < 2; i += 1) {
    s = s.replace(/\(([^()]*)\)[*?]/g, ""); // (x)* y (x)? → nada (son opcionales)
    s = s.replace(/\(([^()]*)\)\+?/g, (_m, inner) => inner.split("|")[0]); // (a|b) → a
  }

  s = s.replace(/\[\^[^\]]*\][*?]/g, ""); // [^|;&]* → nada
  s = s.replace(/\[\^[^\]]*\]\+?/g, "x");
  s = s.replace(/\[[^\]]*\][*?]/g, ""); // [a-z]* → nada
  s = s.replace(/\[([^\]]*)\]\+?/g, (_m, inner) => inner.replace(/^(.)-.*/, "$1").charAt(0) || "a"); // [ée] → é

  s = s.replace(/\\s\+/g, " ").replace(/\\s\*/g, "").replace(/\\s/g, " ");
  s = s.replace(/\\d\+?/g, "1").replace(/\\w\+?/g, "x");
  s = s.replace(/\\b|\\B/g, "");
  // ` x ` y no `x`: el comodín suele estar entre dos `\b`, y pegar el relleno al literal
  // siguiente borra justo el límite de palabra que el patrón exige.
  s = s.replace(/\.[*+]/g, " x ");
  s = s.replace(/[?*+]/g, "");
  s = s.replace(/[\^$]/g, "");

  // La validación va ANTES de restaurar: lo que sobra acá es sintaxis que no se pudo
  // reducir. Los metacaracteres que estaban ESCAPADOS son literales del ejemplo y siguen
  // guardados como placeholders — validarlos como si fueran sintaxis reportaba «omitido»
  // cualquier patrón con `\{` o `\[`, que es medio CSS.
  if (/[\\[\]{}]/.test(s) || !s.trim()) return null;
  for (const [c, ph] of Object.entries(PH)) s = s.split(ph).join(c);

  // Y lo último: la muestra tiene que casar el patrón del que salió. Sin esta línea, una
  // reducción imperfecta devolvía un ejemplo que NO casa (`\brm\b[^|;&]*tareas\.json` daba
  // «rmtareas.json») y el caso reportaba ROJO un freno que funcionaba. Un falso rojo enseña a
  // ignorar la sección entera; «omitido» dice la verdad: no pude fabricar el ejemplo.
  try {
    if (!new RegExp(pattern).test(s)) return null;
  } catch {
    return null;
  }
  return s;
}

/**
 * Qué ejecuta un hook declarado en settings.json.
 *
 * La implementación vive en `harness.mjs`, junto con los otros defaults compartidos: la
 * medición de latencia (`scripts/hooks-timing.mjs`) lee la MISMA declaración, y dos parsers
 * del mismo formato son dos verdades — el día que un repo escriba su comando de otra forma,
 * uno de los dos miente. Acá queda el alias para no tocar los casos de abajo.
 */
const analizarComando = parseHookCommand;

// ¿El ejecutable existe? La pregunta vive en `.claude/hooks/harness.mjs` (`existeEjecutable`):
// acá había una copia sin la búsqueda de Windows (PATHEXT), la misma falla que tenían
// `--verify-red` y el eval del revisor. Dos versiones de la misma pregunta son dos verdades.

// ── 1. Hooks declarados vs. hooks que existen ────────────────────────────────
section("1. settings.json → hooks declarados");
const declared = [];
for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
  for (const group of groups ?? []) {
    for (const hook of group.hooks ?? []) {
      const info = analizarComando(hook.command);
      declared.push({ event, command: hook.command, ...(info ?? {}) });
      if (info?.tipo === "script") hookFiles.add(path.basename(info.file));
    }
  }
}
if (!declared.length) {
  bad("hay hooks declarados", "settings.json no declara ninguno: el arnés está instalado y muerto");
}
for (const d of declared) {
  if (!d.file) {
    bad(`${d.event} → ${d.command}`, "el hook no declara ningún comando");
    continue;
  }

  if (d.tipo === "ejecutable") {
    // Un binario de fuera del repo no se puede parsear: se afirma sólo lo verificable.
    if (existeEjecutable(d.file)) ok(`${d.event} → ${d.etiqueta} (ejecutable externo: sólo se verifica que exista)`);
    else bad(`${d.event} → ${d.command}`, `no encontré el ejecutable \`${d.file}\` (ni por ruta ni en PATH)`);
    continue;
  }

  if (!fs.existsSync(abs(d.file))) {
    bad(`${d.event} → ${d.command}`, `el archivo del hook no existe: \`${d.file}\``);
    continue;
  }
  const syntax = spawnSync("node", ["--check", abs(d.file)], { encoding: "utf8" });
  if (syntax.status !== 0) bad(`${d.event} → ${d.file}`, syntax.stderr.trim());
  else ok(`${d.event} → ${d.file}`);
}

// 1b. Los SCRIPTS del arnés también tienen que parsear. Los hooks se verificaban desde el
//     principio; los scripts no, y `harness-init.mjs` viajó roto en dos releases: un
//     backtick sin escapar dentro de un template literal. Nadie lo notó porque el
//     instalador no corre en el gate — sólo lo corre quien porta el arnés, una vez.
section("1b. scripts del arnés");
{
  const dir = abs("scripts");
  const scripts = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".mjs")) : [];
  if (!scripts.length) bad("scripts/", "no hay scripts: el arnés no tiene con qué verificar nada");
  let rotos = 0;
  for (const f of scripts) {
    const res = spawnSync("node", ["--check", path.join(dir, f)], { encoding: "utf8" });
    if (res.status !== 0) {
      rotos += 1;
      bad(`scripts/${f}`, res.stderr.trim().split("\n").slice(0, 3).join(" · "));
    }
  }
  if (!rotos) ok(`${scripts.length} script(s) del arnés parsean`);
}

// 1c. El analizador de comandos, contra formas reales de otros repos. Asumir «node <archivo>»
//     daba FALSO ROJO sobre hooks que existían: un binario externo y `$CLAUDE_PROJECT_DIR`
//     entre comillas (la forma que recomienda la documentación de Claude Code).
{
  const casos = [
    ["node .claude/hooks/x.mjs", "script", ".claude/hooks/x.mjs"], // linkcheck:ignore (ficticio)
    ['node "$CLAUDE_PROJECT_DIR/scripts/ado.mjs" hook edit', "script", "scripts/ado.mjs"], // linkcheck:ignore
    ["node --experimental-strip-types scripts/x.ts", "script", "scripts/x.ts"], // linkcheck:ignore
    ["/usr/local/bin/graphify hook-guard search", "ejecutable", "/usr/local/bin/graphify"],
    ["graphify hook-guard search", "ejecutable", "graphify"],
  ];
  let malos = 0;
  for (const [comando, tipo, file] of casos) {
    const r = analizarComando(comando);
    if (r?.tipo === tipo && r?.file === file) continue;
    malos += 1;
    bad(`analizarComando(${comando})`, `esperaba {${tipo}, ${file}} y dio {${r?.tipo}, ${r?.file}}`);
  }
  if (!malos) ok(`${casos.length} formas de declarar un hook se analizan bien (binario externo, \`$CLAUDE_PROJECT_DIR\`, flags de node)`);
}

// 1d. Si un binario existe se pregunta antes de lanzarlo. En Windows los comandos del config van
//     por `cmd.exe`, y ahí un binario ausente es un exit 1 como cualquier otro: `--verify-red` lo
//     leía como «las pruebas fallan» y el eval del revisor como roto. Lo destapó la matriz de CI.
{
  const ausente = "comando-que-no-existe-en-ninguna-maquina";
  if (existeEjecutable("node") && !existeEjecutable(ausente) && !existeEjecutable(ausente, "win32") && existeEjecutable("scripts/gate.mjs") && !existeEjecutable("scripts/nada.mjs")) // linkcheck:ignore — ruta ficticia
    ok("un binario ausente se detecta ANTES de lanzarlo, también con la búsqueda de Windows (PATHEXT)");
  else bad("existeEjecutable", "no distingue un binario presente de uno ausente");
}

// ── 2. El config no apunta a la nada ─────────────────────────────────────────
section("2. harness.config.json → rutas y regex");

const patronesDelConfig = [
  ...(config.protectedPaths ?? []).map((r) => ["protectedPaths", r.pattern]),
  ...(config.bash?.deny ?? []).map((r) => ["bash.deny", r.pattern]),
  ...(config.reuse ?? []).flatMap((r) => [
    ["reuse.pattern", r.pattern],
    ["reuse.appliesTo", r.appliesTo],
  ]),
  ...(config.patterns ?? []).flatMap((r) => [
    [`patterns.${r.id}`, r.pattern],
    [`patterns.${r.id}.appliesTo`, r.appliesTo],
  ]),
  ...(config.singleSource ?? []).map((r) => [`singleSource.${r.id}.appliesTo`, r.appliesTo]),
  ...(config.sdd?.routes ?? []).flatMap((r) => (r.patterns ?? []).map((p) => [`sdd.${r.route}`, p])),
  // Un patrón roto acá no rompe nada visible: el hook los compila en un try/catch para no
  // arruinar el turno del usuario, así que el único lugar donde puede fallar es este.
  ...(config.graph?.questionPatterns ?? []).map((p) => ["graph.questionPatterns", p]),
  ...(config.askFirst?.questionPatterns ?? []).map((p) => ["askFirst.questionPatterns", p]),
  ...(config.askFirst?.actionPatterns ?? []).map((p) => ["askFirst.actionPatterns", p]),
  ...(config.askFirst?.pastPatterns ?? []).map((p) => ["askFirst.pastPatterns", p]),
  ...(config.askFirst?.strongQuestionPatterns ?? []).map((p) => ["askFirst.strongQuestionPatterns", p]),
  ...(config.askFirst?.directRequestPatterns ?? []).map((p) => ["askFirst.directRequestPatterns", p]),
  ["tests.filePattern", config.tests?.filePattern],
  ["tests.onlyPattern", config.tests?.onlyPattern],
  // Plantillas con marcador: se compilan con el marcador ya sustituido, que es como las
  // usa el lint. Un `{mod}` mal cerrado compila igual y después no caza nada.
  ...(config.purityImportSyntax ?? []).map((t) => ["purityImportSyntax", t.split("{mod}").join("x")]),
  ...(config.purity ?? []).flatMap((p) =>
    (p.importSyntax ?? []).map((t) => ["purity.importSyntax", t.split("{mod}").join("x")]),
  ),
  ["forbiddenDeps.matcher", config.forbiddenDeps?.matcher?.split("{pkg}").join("x")],
];
let regexMalos = 0;
for (const [donde, pattern] of patronesDelConfig) {
  if (!pattern) continue;
  try {
    new RegExp(pattern);
  } catch (e) {
    regexMalos += 1;
    bad(`regex de ${donde}`, `\`${pattern}\` no compila: ${e.message}`);
  }
}
if (!regexMalos) ok(`${patronesDelConfig.filter(([, p]) => p).length} regex del config compilan`);

// Invariante del generador: la muestra que fabrica DEBE casar el patrón del que salió, o ser
// null. Sin él, una reducción imperfecta produce un falso rojo sobre un freno que funciona —
// pasó con `\brm\b[^|;&]*tareas\.json`, que se reducía a «rmtareas.json».
{
  const noReducible = "\\brm\\b[^|;&]*tareas\\.json";
  if (sampleFromPattern(noReducible) === null) ok("una muestra que no casa su patrón se reporta omitida, no roja");
  else bad("la muestra derivada casa su patrón", `\`${noReducible}\` produjo \`${sampleFromPattern(noReducible)}\`, que NO casa: eso es un falso rojo`);

  const mentirosas = patronesDelConfig
    .filter(([, p]) => p)
    .map(([donde, p]) => [donde, p, sampleFromPattern(p)])
    .filter(([, p, muestra]) => {
      if (muestra === null) return false;
      try {
        return !new RegExp(p).test(muestra);
      } catch {
        return false;
      }
    });
  if (!mentirosas.length) ok("todas las muestras derivadas del config casan su patrón");
  else bad("las muestras derivadas casan su patrón", mentirosas.map(([d, p, m]) => `${d}: \`${p}\` → \`${m}\``).join("\n      "));
}

const rutasDelConfig = [
  ["incidents.file", config.incidents?.file],
  ["status.file", config.status?.file],
  ["forbiddenDeps.manifest", config.forbiddenDeps?.manifest],
  ...(config.purity ?? []).map((p) => ["purity.dir", p.dir]),
  ...(config.purity ?? []).flatMap((p) => (p.except ?? []).map((f) => ["purity.except", f])),
  ...(config.singleSource ?? []).map((r) => [`singleSource.${r.id}.source`, r.source]),
  ...(config.singleSource ?? []).flatMap((r) => (r.allow ?? []).map((f) => [`singleSource.${r.id}.allow`, f])),
  ...(config.invariants ?? []).map((r) => ["invariants.file", r.file]),
  ...(config.reuse ?? []).map((r) => ["reuse.see", r.see]),
  ...(config.docs?.ignoreFiles ?? []).map((f) => ["docs.ignoreFiles", f]),
];
let rutasMalas = 0;
for (const [donde, ruta] of rutasDelConfig) {
  if (!ruta) continue;
  if (!fs.existsSync(abs(ruta))) {
    rutasMalas += 1;
    bad(`ruta de ${donde}`, `\`${ruta}\` no existe: la regla apunta a la nada`);
  }
}
if (!rutasMalas) ok(`${rutasDelConfig.filter(([, r]) => r).length} rutas del config resuelven`);

// ── 3. Los hooks bloquean de verdad ──────────────────────────────────────────
section("3. los frenos muerden");

// 3a. Rutas protegidas: una muestra por regla.
for (const regla of config.protectedPaths ?? []) {
  let muestra = sampleFromPattern(regla.pattern);
  if (!muestra) {
    skip(`protectedPaths \`${regla.pattern}\``, "el patrón no se puede reducir a un ejemplo; probalo a mano");
    continue;
  }
  if (muestra.endsWith("/")) muestra += "archivo.txt";
  const r = runHook("protected-paths.mjs", writeInput(muestra));
  if (r.status === 2) ok(`protected-paths bloquea \`${muestra}\``);
  else bad(`protected-paths bloquea \`${muestra}\``, `exit ${r.status} — la ruta protegida NO frenó nada`);
}

// 3b. Un archivo cualquiera NO protegido tiene que pasar: un freno que bloquea todo se desactiva.
{
  const r = runHook("protected-paths.mjs", writeInput("archivo-normal-selftest.md"));
  if (r.status === 0) ok("protected-paths deja pasar un archivo normal");
  else bad("protected-paths deja pasar un archivo normal", `exit ${r.status}: el freno bloquea de más`);
}

// 3c. Comandos denegados: una muestra por regla.
if (hookFiles.has("bash-guard.mjs")) {
  for (const regla of config.bash?.deny ?? []) {
    const muestra = sampleFromPattern(regla.pattern);
    if (!muestra) {
      skip(`bash.deny \`${regla.pattern}\``, "el patrón no se puede reducir a un ejemplo; probalo a mano");
      continue;
    }
    const r = runHook("bash-guard.mjs", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: muestra },
    });
    if (r.status === 2) ok(`bash-guard bloquea \`${muestra.trim()}\``);
    else bad(`bash-guard bloquea \`${muestra.trim()}\``, `exit ${r.status} — el comando pasó`);
  }
  const inocente = runHook("bash-guard.mjs", {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "git status --porcelain" },
  });
  if (inocente.status === 0) ok("bash-guard deja pasar `git status`");
  else bad("bash-guard deja pasar `git status`", `exit ${inocente.status}: el freno bloquea de más`);
}

// 3d. Catálogo de reuso: el boilerplate que ya tiene abstracción se frena.
if (hookFiles.has("reuse-guard.mjs")) {
  for (const regla of config.reuse ?? []) {
    const muestraRuta = sampleFromPattern(regla.appliesTo);
    const muestraTexto = sampleFromPattern(regla.pattern);
    if (!muestraRuta || !muestraTexto) {
      skip(`reuse \`${regla.pattern}\``, "patrón no reducible a ejemplo; probalo a mano");
      continue;
    }
    const archivo = muestraRuta.endsWith("/") ? `${muestraRuta}ejemplo.mjs` : muestraRuta;
    const r = runHook("reuse-guard.mjs", writeInput(archivo, muestraTexto));
    if (r.status === 2) ok(`reuse-guard bloquea reimplementar \`${regla.see ?? regla.pattern}\``);
    else bad(`reuse-guard bloquea \`${regla.pattern}\``, `exit ${r.status} en \`${archivo}\` — el boilerplate pasó`);
  }
}

// 3e. El hook Stop no deja cerrar con el gate pendiente.
if (hookFiles.has("gate-stop.mjs") && config.gate?.marker) {
  const marker = abs(config.gate.marker);
  const existia = fs.existsSync(marker);
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, "selftest");
    const r = runHook("gate-stop.mjs", { hook_event_name: "Stop", stop_hook_active: false });
    if (r.status === 2) ok("gate-stop bloquea cerrar con el gate pendiente");
    else bad("gate-stop bloquea cerrar con el gate pendiente", `exit ${r.status}: se puede entregar sin gate verde`);

    const loop = runHook("gate-stop.mjs", { hook_event_name: "Stop", stop_hook_active: true });
    if (loop.status === 0) ok("gate-stop no entra en loop (stop_hook_active)");
    else bad("gate-stop no entra en loop", `exit ${loop.status} con stop_hook_active: true`);
  } finally {
    if (!existia) fs.rmSync(marker, { force: true });
  }
}

// 3e-bis. «Una pregunta se contesta; una acción se pide». El clasificador de intención es
//     lo único que separa a este freno de un estorbo, así que se prueba en las dos
//     direcciones con pedidos REALES, no con muestras derivadas de sus propios patrones.
if (config.askFirst?.marker && hookFiles.has("ask-first.mjs") && hookFiles.has("action-guard.mjs")) {
  const marker = abs(config.askFirst.marker);
  const existia = fs.existsSync(marker);
  const respaldo = existia ? fs.readFileSync(marker, "utf8") : null;

  const edicionEnRepo = writeInput("archivo-normal-selftest.md", "x");
  const tras = (prompt) => {
    runHook("ask-first.mjs", { hook_event_name: "UserPromptSubmit", prompt });
    return runHook("action-guard.mjs", edicionEnRepo).status === 2;
  };

  const casos = [
    ["¿por qué el gate salió verde?", true],
    ["qué hace el hook de registro", true],
    ["cómo se instala en otro repo", true],
    ["pero aplicaste eso a la documentación?", true],
    ["hay problemas reportados, no hay frenos", true],
    ["arreglá el diseño de la página", false],
    ["dale, hacelo", false],
    ["¿podés arreglar el diseño?", false],
  ];
  for (const [prompt, debeFrenar] of casos) {
    const frena = tras(prompt);
    if (frena === debeFrenar) ok(`ask-first: «${prompt.slice(0, 38)}» ${debeFrenar ? "frena" : "deja actuar"}`);
    else bad(`ask-first: «${prompt.slice(0, 38)}»`, `esperaba ${debeFrenar ? "bloqueo" : "paso libre"} y no fue así`);
  }

  // Escribir FUERA del repo es parte de contestar (un borrador en el scratchpad).
  runHook("ask-first.mjs", { hook_event_name: "UserPromptSubmit", prompt: "¿qué hace esto?" });
  const fuera = runHook("action-guard.mjs", {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: path.join(os.tmpdir(), "borrador.md"), content: "x" },
  });
  if (fuera.status === 0) ok("ask-first: escribir fuera del repo sigue permitido");
  else bad("ask-first: escribir fuera del repo", `exit ${fuera.status}: el freno bloquea de más`);

  if (respaldo !== null) fs.writeFileSync(marker, respaldo);
  else fs.rmSync(marker, { force: true });
}

// 3e-ter. El trabajo entra a las ramas protegidas por PR. Se prueba con la entrada que git
//     le pasa de verdad al hook: «<ref local> <sha> <ref remoto> <sha>».
if ((config.branches?.protected ?? []).length && fs.existsSync(abs(".githooks/pre-push")) && !HAY_BASH) {
  skip("pre-push frena el empujón directo", "no hay bash en esta máquina (en Windows lo trae Git for Windows)");
} else if ((config.branches?.protected ?? []).length && fs.existsSync(abs(".githooks/pre-push"))) {
  const empujar = (rama) =>
    spawnSync("bash", [abs(".githooks/pre-push")], {
      cwd: REPO_ROOT,
      input: `refs/heads/${rama} aaa refs/heads/${rama} bbb\n`,
      encoding: "utf8",
    });
  for (const rama of config.branches.protected) {
    const r = empujar(rama);
    if (r.status === 1) ok(`pre-push frena el empujón directo a \`${rama}\``);
    else bad(`pre-push frena \`${rama}\``, `exit ${r.status}: el push directo pasa`);
  }
  const libre = empujar("feat/rama-de-prueba");
  if (libre.status === 0) ok("pre-push deja pasar una rama de feature");
  else bad("pre-push deja pasar una rama de feature", `exit ${libre.status}: el freno bloquea de más`);
}

// 3e-quater. Qué cuenta como CÓDIGO sale del config, no del hook. Las extensiones estaban
//     cableadas en `post-edit-check.mjs` y por eso el freno de mayor retorno estaba MUERTO
//     en todo repo que no fuera JS/TS: un `.cs` editado no marcaba el gate ni corría el lint.
if (hookFiles.has("post-edit-check.mjs") && config.gate?.marker && (config.gate?.codeGlobs ?? []).length) {
  const marker = abs(config.gate.marker);
  const existia = fs.existsSync(marker);
  const respaldo = existia ? fs.readFileSync(marker, "utf8") : null;
  const glob = config.gate.codeGlobs[0].replace(/\/$/, "");

  const marca = (archivo) => {
    fs.rmSync(marker, { force: true });
    runHook("post-edit-check.mjs", {
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: abs(archivo), content: "" },
    });
    return fs.existsSync(marker);
  };

  try {
    // Una señal OMITIDA se imprime siempre: sin esto, en un repo portado sin perfil (donde
    // `codeExtensions` está vacío) el bucle no corría y el caso desaparecía sin dejar rastro.
    if (!(config.gate.codeExtensions ?? []).length) {
      skip("post-edit-check por extensión declarada", "el repo usa el default agnóstico (lo cubre 3e-quinquies)");
    }
    for (const ext of config.gate.codeExtensions ?? []) {
      const archivo = `${glob}/ejemplo-selftest${ext}`;
      if (marca(archivo)) ok(`post-edit-check marca el gate al tocar \`${ext}\``);
      else bad(`post-edit-check marca el gate al tocar \`${ext}\``, `editar \`${archivo}\` no dejó \`${config.gate.marker}\``);
    }
    // Y NO de más: una extensión que el repo no declara como código no ensucia el gate.
    const ajena = ".txt-no-declarada";
    if (!marca(`${glob}/ejemplo-selftest${ajena}`)) ok("post-edit-check ignora una extensión no declarada");
    else bad("post-edit-check ignora una extensión no declarada", `\`${ajena}\` marcó el gate: el freno muerde de más`);
  } finally {
    if (respaldo !== null) fs.writeFileSync(marker, respaldo);
    else fs.rmSync(marker, { force: true });
  }
}

// 3e-quinquies. La rama por DEFAULT, que es la que usa todo repo portado sin perfil.
//     `codeExtensions: []` es lo que trae la plantilla, así que el default agnóstico del hook
//     es el código que más se ejecuta en el mundo real — y era la rama donde vivía el bug.
//     Se prueba en un repo TEMPORAL: el hook resuelve su raíz desde su propia ruta, así que
//     copiarlo a /tmp con otro config es la única forma de ejercitar otra configuración sin
//     escribir en el árbol de fuentes (P7).
if (hookFiles.has("post-edit-check.mjs")) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-default-ext-"));
  try {
    fs.mkdirSync(path.join(tmp, ".claude/hooks"), { recursive: true });
    for (const f of ["harness.mjs", "post-edit-check.mjs"]) {
      fs.copyFileSync(abs(`.claude/hooks/${f}`), path.join(tmp, `.claude/hooks/${f}`));
    }
    fs.writeFileSync(
      path.join(tmp, ".claude/harness.config.json"),
      JSON.stringify({
        gate: { marker: "gate-dirty", codeGlobs: ["src/"], codeExtensions: [] },
        // Un comando que no hace nada: acá se mide el MARCADOR, no el lint.
        lint: { command: ["node", "-e", ""], fileFlag: "--file" },
      }),
    );

    const marcaEnTmp = (archivo) => {
      fs.rmSync(path.join(tmp, "gate-dirty"), { force: true });
      spawnSync("node", [path.join(tmp, ".claude/hooks/post-edit-check.mjs")], {
        input: JSON.stringify({
          cwd: tmp,
          hook_event_name: "PostToolUse",
          tool_name: "Write",
          tool_input: { file_path: path.join(tmp, archivo), content: "" },
        }),
        encoding: "utf8",
      });
      return fs.existsSync(path.join(tmp, "gate-dirty"));
    };

    // Un lenguaje que este repo no usa: si el default se angosta a JS, esto se apaga.
    for (const archivo of ["src/Servicio.cs", "src/Servicio.java", "src/servicio.py"]) {
      if (marcaEnTmp(archivo)) ok(`post-edit-check (sin codeExtensions) marca el gate en \`${archivo}\``);
      else bad(`post-edit-check (sin codeExtensions) marca \`${archivo}\``, "el default agnóstico no reconoció el archivo como código");
    }
    // Y NO de más: la documentación no ensucia el gate, ni el código fuera de `codeGlobs`.
    if (!marcaEnTmp("src/README.md")) ok("post-edit-check (sin codeExtensions) ignora un .md");
    else bad("post-edit-check (sin codeExtensions) ignora un .md", "editar documentación marcó el gate");
    if (!marcaEnTmp("otro/Servicio.cs")) ok("post-edit-check (sin codeExtensions) respeta codeGlobs");
    else bad("post-edit-check (sin codeExtensions) respeta codeGlobs", "un archivo fuera de `codeGlobs` marcó el gate");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 3e-septies. La dirección INVERSA del symlink: una ruta que pasa por un symlink INTERNO
//     (`node_modules/<dep>` con pnpm, o un paquete de workspace) apunta afuera del repo. Si el
//     hook resuelve siempre, esa ruta cae fuera de la raíz y los frenos se apagan **hacia
//     abajo**: se puede escribir en dependencias y derivados en silencio. Es la dirección que
//     nadie nota, así que es la que necesita el caso.
if (hookFiles.has("protected-paths.mjs")) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-symlink-"));
  try {
    const repo = path.join(tmp, "repo");
    const afuera = path.join(tmp, "almacen", "dep");
    fs.mkdirSync(path.join(repo, ".claude/hooks"), { recursive: true });
    fs.mkdirSync(path.join(repo, "node_modules"), { recursive: true });
    fs.mkdirSync(afuera, { recursive: true });
    for (const f of ["harness.mjs", "protected-paths.mjs"]) {
      fs.copyFileSync(abs(`.claude/hooks/${f}`), path.join(repo, `.claude/hooks/${f}`));
    }
    fs.writeFileSync(
      path.join(repo, ".claude/harness.config.json"),
      JSON.stringify({
        protectedPaths: [{ pattern: "^node_modules/", reason: "dependencias: no las edita el agente." }],
      }),
    );
    fs.symlinkSync(afuera, path.join(repo, "node_modules/dep"), "dir");

    const escribir = (archivo) =>
      spawnSync("node", [path.join(repo, ".claude/hooks/protected-paths.mjs")], {
        input: JSON.stringify({
          cwd: repo,
          hook_event_name: "PreToolUse",
          tool_name: "Write",
          tool_input: { file_path: path.join(repo, archivo), content: "x" },
        }),
        encoding: "utf8",
      }).status;

    if (escribir("node_modules/dep/index.js") === 2) ok("protected-paths bloquea a través de un symlink interno");
    else bad("protected-paths bloquea a través de un symlink interno", "exit 0: la ruta real cae fuera del repo y el freno se apagó hacia abajo");
    if (escribir("node_modules/otro.js") === 2) ok("protected-paths bloquea la ruta directa equivalente");
    else bad("protected-paths bloquea la ruta directa", "exit 0 sobre `node_modules/otro.js`");
    if (escribir("src/normal.js") === 0) ok("protected-paths deja pasar un archivo normal del repo temporal");
    else bad("protected-paths deja pasar un archivo normal", "el freno bloquea de más");

    // Tercera variante del mismo incidente: un alias DENTRO del repo. No es una ruta nueva,
    // es otro nombre de una que ya tiene dueño — y por el nombre nuevo pasaba.
    fs.mkdirSync(path.join(repo, "src/secreto"), { recursive: true });
    fs.symlinkSync(path.join(repo, "src/secreto"), path.join(repo, "alias"), "dir");
    fs.writeFileSync(
      path.join(repo, ".claude/harness.config.json"),
      JSON.stringify({
        protectedPaths: [
          { pattern: "^node_modules/", reason: "dependencias: no las edita el agente." },
          { pattern: "^src/secreto/", reason: "eso lo toca el humano." },
        ],
      }),
    );
    if (escribir("src/secreto/x.js") === 2) ok("protected-paths bloquea la ruta protegida directa");
    else bad("protected-paths bloquea la ruta protegida directa", "exit 0 sobre `src/secreto/x.js`");
    if (escribir("alias/x.js") === 2) ok("protected-paths bloquea el alias interno de una ruta protegida");
    else bad("protected-paths bloquea el alias interno", "exit 0: lo prohibido por un nombre se escribe por el otro");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 3e-sexies. Las dos listas de extensiones no pueden divergir. Son dos preguntas distintas
//     —qué ensucia el gate vs. qué archivos barre el lint— pero si una extensión ensucia el
//     gate y el barrido no la lee, las reglas quedan CIEGAS justo en la señal que manda.
//     Pasó con `.pyi`: el perfil de Python lo declaraba y la lista del lint no lo tenía.
const huerfanasDe = (cfg) => {
  const delGate = cfg.gate?.codeExtensions ?? [];
  // La lista EFECTIVA, no la declarada: si `lint.sourceExtensions` está ausente, el lint usa
  // el default agnóstico — y una extensión declarada en el gate que NO esté en ese default
  // es exactamente la divergencia del incidente `.pyi`.
  const efectivaDelLint = codeExtensions(cfg.lint?.sourceExtensions).map((e) => e.toLowerCase());
  return delGate.filter((e) => !efectivaDelLint.includes(e.toLowerCase()));
};
{
  const huerfanas = huerfanasDe(config);
  const declaradas = (config.gate?.codeExtensions ?? []).length;
  if (!declaradas) {
    // Sin lista declarada no puede haber divergencia (las dos usan el mismo default), pero eso
    // es una omisión, no una medición: «barre las 0 extensiones» se lee como verde y no lo es.
    skip("el lint barre lo que ensucia el gate", "el repo no angosta `gate.codeExtensions`");
  } else if (!huerfanas.length) ok(`el lint barre las ${declaradas} extensiones que ensucian el gate`);
  else bad("el lint barre lo que ensucia el gate", `\`${huerfanas.join(", ")}\` ensucian el gate y el barrido del lint no las lee: PATRON/PUREZA/ONLY ciegas ahí`);
}

// 3e-quater. Las rutas de Windows se parten bien, desde cualquier máquina. En Windows conviven
//     los dos separadores y el agente los manda mezclados; si la ruta queda como un solo
//     segmento, ninguna regla por ruta caza nada y el freno no falla: no existe. El caso
//     ejercita la plataforma como parámetro, así que corre igual en macOS y en Linux.
{
  const casos = [
    ["C:\\repo\\.claude\\harness.config.json", "win32", [".claude", "harness.config.json"]],
    ["C:/repo/.claude/harness.config.json", "win32", [".claude", "harness.config.json"]],
    ["C:\\repo/.claude\\harness.config.json", "win32", [".claude", "harness.config.json"]],
  ];
  const malos = casos.filter(([ruta, plataforma, esperado]) => {
    const partes = segmentosDeRuta(ruta, plataforma);
    return esperado.some((seg) => !partes.includes(seg));
  });
  if (!malos.length) ok("las rutas de Windows se parten por los DOS separadores (`\\` y `/`)");
  else bad("las rutas de Windows se parten bien", malos.map(([r]) => r).join(" · "));

  // Y lo que está FUERA del repo tiene que verse como fuera. En Windows, entre unidades
  // distintas `path.relative` devuelve la ruta ABSOLUTA —no empieza con `..`— y con eso todo
  // lo de afuera pasaba por dentro: `action-guard` bloqueaba escribir un borrador en el
  // temporal. Lo destapó la matriz de CI, no una lectura del código.
  const afuera = [
    ["D:\\a\\repo", "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\borrador.md", "win32"],
    ["D:\\a\\repo", "D:\\otro\\borrador.md", "win32"],
    ["/repo", "/tmp/borrador.md", "posix"],
  ];
  const adentro = [
    ["D:\\a\\repo", "D:\\a\\repo\\src\\x.ts", "win32"],
    ["/repo", "/repo/src/x.ts", "posix"],
  ];
  // `C:` pelado no es la raíz de la unidad: es el DIRECTORIO ACTUAL de esa unidad. Al subir
  // prefijos resolvía al cwd —el propio repo— y con eso cualquier ruta de esa unidad se veía
  // como interna. La raíz de verdad lleva barra.
  const unidades = [["C:", true], ["d:", true], ["C:\\", false], ["/", false], ["C:\\repo", false]];
  const malasUnidades = unidades.filter(([p, esperado]) => esUnidadPelada(p) !== esperado);
  if (!malasUnidades.length) ok("`C:` pelado no se confunde con la raíz de la unidad");
  else bad("`C:` pelado no se confunde con la raíz", malasUnidades.map(([p]) => p).join(" · "));

  const malosAfuera = afuera.filter(([root, ruta, so]) => !relativaDesdeRaiz(ruta, root, so).startsWith(".."));
  const malosAdentro = adentro.filter(([root, ruta, so]) => relativaDesdeRaiz(ruta, root, so).startsWith(".."));
  if (!malosAfuera.length && !malosAdentro.length)
    ok("lo de afuera del repo se ve como afuera, también entre unidades de Windows");
  else
    bad(
      "lo de afuera del repo se ve como afuera",
      [...malosAfuera.map(([, r]) => `${r} se vio DENTRO`), ...malosAdentro.map(([, r]) => `${r} se vio FUERA`)].join(" · "),
    );
}

// 3f. El trabajo queda registrado: `.githooks/commit-msg` en un repo git DE VERDAD.
//     El hook lee `git diff --cached`, así que probarlo con payloads falsos no probaría
//     nada. Los casos se derivan del config: la ruta de código sale de `commitMsg.codePattern`
//     y la referencia de ejemplo, de `tracker.issuePattern`.
{
  const hook = abs(".githooks/commit-msg");
  const cm = config.commitMsg;
  const tr = config.tracker;

  if (!fs.existsSync(hook) || !cm?.codePattern || !tr?.issuePattern) {
    skip("commit-msg exige registro", "el repo no configura `commitMsg` + `tracker`");
  } else if (!HAY_BASH) {
    skip("commit-msg exige registro", "no hay bash en esta máquina (en Windows lo trae Git for Windows)");
  } else {
    const rutaCodigo = sampleFromPattern(cm.codePattern);
    const refIssue = sampleFromPattern(tr.issuePattern);
    const fuga = cm.escapeLine ?? "no-issue:";
    const extIgnorada = (cm.ignoreExtensions ?? [".md"])[0];

    if (!rutaCodigo || !refIssue) {
      skip("commit-msg exige registro", "codePattern o issuePattern no se reducen a un ejemplo");
    } else {
      const archivoCodigo = `${rutaCodigo.endsWith("/") ? rutaCodigo : `${rutaCodigo}/`}ejemplo.mjs`;
      const archivoDoc = `${rutaCodigo.endsWith("/") ? rutaCodigo : `${rutaCodigo}/`}ejemplo${extIgnorada}`;

      // Repo git NUEVO por caso: los archivos staged de un caso anterior seguirían ahí
      // (nada se commitea) y el caso "sólo documentación" vería código staged.
      const correr = (archivos, mensaje) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-commitmsg-"));
        try {
          const git = (...args) => spawnSync("git", args, { cwd: tmp, encoding: "utf8" });
          git("init", "-q");
          git("config", "user.email", "selftest@example.com");
          git("config", "user.name", "selftest");
          // El hook lee el config del CWD: se copia el de este repo al repo temporal.
          fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
          fs.copyFileSync(abs(".claude/harness.config.json"), path.join(tmp, ".claude/harness.config.json"));
          for (const [rel, contenido] of Object.entries(archivos)) {
            const dest = path.join(tmp, rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, contenido);
          }
          // Sólo los archivos del caso: un `git add -A` staged también el config copiado
          // acá arriba, que cae bajo `codePattern` y ensuciaba el caso de documentación.
          for (const rel of Object.keys(archivos)) git("add", rel);
          const msgFile = path.join(tmp, "MSG");
          fs.writeFileSync(msgFile, mensaje);
          const res = spawnSync("bash", [hook, msgFile], { cwd: tmp, encoding: "utf8" });
          return { status: res.status, stderr: res.stderr ?? "" };
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      };

      const casos = [
        ["código sin referencia ni declaración", { [archivoCodigo]: "// x\n" }, "fix: algo", 1],
        ["código con el ítem referenciado", { [archivoCodigo]: "// y\n" }, `fix: algo\n\nRefs ${refIssue.trim()}`, 0],
        ["código con la fuga declarada y su motivo", { [archivoCodigo]: "// z\n" }, `chore: renombrar\n\n${fuga} renombre interno, sin cambio de comportamiento`, 0],
        ["la fuga SIN motivo no alcanza", { [archivoCodigo]: "// w\n" }, `chore: algo\n\n${fuga}`, 1],
        ["extensión ignorada no pide registro", { [archivoDoc]: "nota\n" }, "docs: notas", 0],
        ["merge lo escribe git, no pide registro", { [archivoCodigo]: "// m\n" }, "Merge branch 'main'", 0],
      ];
      for (const [nombre, archivos, mensaje, esperado] of casos) {
        const res = correr(archivos, mensaje);
        if (res.status === esperado) ok(`commit-msg: ${nombre}`);
        else bad(`commit-msg: ${nombre}`, `esperaba exit ${esperado}, salió ${res.status}. stderr: ${res.stderr.trim().slice(0, 160)}`);
      }
    }
  }
}

// 3f-bis. El ciclo de desarrollo: modelo de ramas (`workflow`) y prácticas de XP (`xp`).
//     El freno entra por `node scripts/cycle-check.mjs`, así que estos casos NO necesitan
//     bash: corren igual en Windows, que es donde un freno de sólo-shell no falla sino que
//     desaparece. Las muestras salen del config: el self-test no sabe qué modelo usa el repo.
{
  const script = abs("scripts/cycle-check.mjs");
  const wf = config.workflow ?? {};
  const reglasXp = config.xp ?? {};

  if (!fs.existsSync(script)) {
    skip("ciclo de desarrollo", "el repo no trae scripts/cycle-check.mjs");
  } else {
    // --- modelo de ramas -------------------------------------------------------------
    const rama = (nombre, cfg) =>
      spawnSync("node", [script, "--branch", nombre, ...(cfg ? ["--config", cfg] : [])], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });

    if (!wf.branchPattern) {
      skip("ciclo: el nombre de la rama sigue el modelo", "el repo no declara `workflow.branchPattern`");
    } else {
      const valida = (wf.branchExamples ?? [])[0] ?? sampleFromPattern(wf.branchPattern);
      // La muestra inválida se fabrica del patrón, no de un literal: un espacio adelante
      // rompe cualquier patrón de rama razonable. Si ESE patrón la aceptara, el caso se
      // reporta omitido antes que mentir.
      const invalida = `ZZ ${valida ?? "rama"}`;
      const patronAcepta = (() => {
        try {
          return new RegExp(wf.branchPattern).test(invalida);
        } catch {
          return true;
        }
      })();

      if (!valida || patronAcepta) {
        skip("ciclo: el nombre de la rama sigue el modelo", "`workflow.branchPattern` no se reduce a un ejemplo");
      } else {
        const mala = rama(invalida);
        if (mala.status === 1) ok("ciclo: una rama que no sigue el modelo no se empuja");
        else bad("ciclo: una rama fuera del modelo", `exit ${mala.status}: el nombre inválido pasa`);

        const buena = rama(valida);
        if (buena.status === 0) ok(`ciclo: \`${valida}\` (rama del modelo) pasa`);
        else bad("ciclo: una rama del modelo pasa", `exit ${buena.status}: el freno bloquea de más — ${buena.stderr.trim().slice(0, 160)}`);

        for (const larga of (wf.longLived ?? config.branches?.protected ?? []).slice(0, 2)) {
          const r = rama(larga);
          if (r.status === 0) ok(`ciclo: \`${larga}\` (rama larga del modelo) no sigue el patrón de trabajo, y está bien`);
          else bad(`ciclo: \`${larga}\` exenta del patrón`, `exit ${r.status}: el freno bloquea la rama del propio modelo`);
        }
      }
    }

    // --- prácticas de XP -------------------------------------------------------------
    // Repo git NUEVO por caso, igual que en commit-msg: lo staged de un caso anterior
    // contaminaría el siguiente. `--config` permite el CEBO de una práctica apagada acá
    // sin escribir nada en el árbol de fuentes (P7).
    const correr = (archivos, mensaje, configOverride) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-ciclo-"));
      try {
        const git = (...a) => spawnSync("git", a, { cwd: tmp, encoding: "utf8" });
        git("init", "-q");
        git("config", "user.email", "selftest@example.com");
        git("config", "user.name", "selftest");
        const rutaCfg = path.join(tmp, "cfg.json");
        fs.writeFileSync(rutaCfg, JSON.stringify(configOverride ?? config));
        for (const [rel, contenido] of Object.entries(archivos)) {
          const dest = path.join(tmp, rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, contenido);
        }
        for (const rel of Object.keys(archivos)) git("add", rel);
        const msgFile = path.join(tmp, "MSG");
        fs.writeFileSync(msgFile, mensaje);
        const res = spawnSync("node", [script, "--commit", msgFile, "--config", rutaCfg], { cwd: tmp, encoding: "utf8" });
        return { status: res.status, stderr: res.stderr ?? "" };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    };

    // Una práctica POR CEBO, y sola: con las demás encendidas, el caso de «lote chico
    // declarado» salía rojo por el mensaje de «test primero» y el veredicto no decía
    // nada sobre la práctica que se estaba probando.
    const conXp = (practica, cambios) => ({
      ...config,
      xp: { [practica]: { ...(reglasXp[practica] ?? {}), enabled: true, ...cambios } },
    });

    const rutaCodigo = sampleFromPattern(config.commitMsg?.codePattern ?? "");
    const prefijo = rutaCodigo ? (rutaCodigo.endsWith("/") ? rutaCodigo : `${rutaCodigo}/`) : null;
    // Un patrón de tests es casi siempre una ALTERNATIVA de layouts (`tests/` o `*.spec.ts` o …),
    // y la muestra sale con los `|` adentro: en macOS y Linux eso es un nombre de archivo legal y
    // el caso pasaba; en Windows `mkdir` explota con ENOENT y el error no menciona el `|`. Se toma
    // la PRIMERA alternativa y se revalida contra el patrón — y si no queda una ruta escribible en
    // las tres plataformas, el caso se reporta omitido antes que mentir.
    const patronTest = reglasXp.testFirst?.testPattern ?? config.tests?.filePattern;
    const muestraTest = (() => {
      const cruda = patronTest ? sampleFromPattern(patronTest) : null;
      if (!cruda) return null;
      for (const candidata of [cruda, ...cruda.split("|")]) {
        const limpia = candidata.trim();
        if (!limpia || /[|<>:"?*\\]/.test(limpia)) continue;
        try {
          if (new RegExp(patronTest).test(limpia)) return limpia;
        } catch {
          return null;
        }
      }
      return null;
    })();
    const archivoTest = muestraTest ? (muestraTest.endsWith("/") ? `${muestraTest}caso.mjs` : muestraTest) : null;

    if (!prefijo || !archivoTest) {
      skip("ciclo (XP): prácticas del equipo", "`commitMsg.codePattern` o el patrón de tests no se reducen a un ejemplo");
    } else {
      const archivoCodigo = `${prefijo}ejemplo.mjs`;
      const casos = [
        // test primero: la prueba y el cambio entran juntos, o se declara por qué no
        ["XP test primero: código sin prueba no entra", { [archivoCodigo]: "// x\n" }, "fix: algo", conXp("testFirst", {}), 1],
        ["XP test primero: código CON su prueba entra", { [archivoCodigo]: "// x\n", [archivoTest]: "// caso\n" }, "fix: algo", conXp("testFirst", {}), 0],
        ["XP test primero: la fuga con motivo entra", { [archivoCodigo]: "// x\n" }, `fix: algo\n\n${reglasXp.testFirst?.escapeLine ?? "no-test:"} typo en un comentario`, conXp("testFirst", {}), 0],
        ["XP test primero: la fuga SIN motivo no alcanza", { [archivoCodigo]: "// x\n" }, `fix: algo\n\n${reglasXp.testFirst?.escapeLine ?? "no-test:"}`, conXp("testFirst", {}), 1],
        // lote chico: el límite sale del config, el cebo lo baja a 1 archivo
        ["XP lote chico: un lote sobre el límite no entra", { [archivoCodigo]: "// x\n", [`${prefijo}otro.mjs`]: "// y\n" }, "feat: dos cosas", conXp("smallBatch", { maxFiles: 1, maxLines: 0 }), 1],
        ["XP lote chico: declarado con motivo, entra", { [archivoCodigo]: "// x\n", [`${prefijo}otro.mjs`]: "// y\n" }, `feat: dos cosas\n\n${reglasXp.smallBatch?.escapeLine ?? "big-batch:"} movimiento mecánico de un renombre`, conXp("smallBatch", { maxFiles: 1, maxLines: 0 }), 0],
        ["XP lote chico: un lote bajo el límite entra", { [archivoCodigo]: "// x\n" }, "feat: una cosa", conXp("smallBatch", { maxFiles: 5, maxLines: 500 }), 0],
        // refactor separado: un refactor que toca pruebas no es un refactor
        ["XP refactor separado: `refactor:` que cambia pruebas no entra", { [archivoCodigo]: "// x\n", [archivoTest]: "// caso\n" }, "refactor: mover el helper", conXp("refactorSeparate", {}), 1],
        ["XP refactor separado: `refactor:` sin tocar pruebas entra", { [archivoCodigo]: "// x\n" }, "refactor: mover el helper", conXp("refactorSeparate", {}), 0],
        // de a dos: apagada en este repo — el mecanismo se prueba igual con un cebo
        ["XP de a dos: sin rastro de con quién, no entra", { [archivoCodigo]: "// x\n" }, "feat: algo", conXp("pairing", {}), 1],
        ["XP de a dos: con el trailer de co-autoría, entra", { [archivoCodigo]: "// x\n" }, `feat: algo\n\n${reglasXp.pairing?.trailer ?? "Co-authored-by:"} Par <par@ejemplo.com>`, conXp("pairing", {}), 0],
      ];

      for (const [nombre, archivos, mensaje, cfg, esperado] of casos) {
        const res = correr(archivos, mensaje, cfg);
        if (res.status === esperado) ok(`ciclo: ${nombre}`);
        else bad(`ciclo: ${nombre}`, `esperaba exit ${esperado}, salió ${res.status}. stderr: ${res.stderr.trim().slice(0, 200)}`);
      }

      // Y el caso que se olvida: con las prácticas APAGADAS, el freno no dice nada.
      const apagado = correr({ [archivoCodigo]: "// x\n" }, "fix: algo", { ...config, xp: {} });
      if (apagado.status === 0) ok("ciclo: sin `xp` configurado, el freno no corre");
      else bad("ciclo: sin `xp` configurado", `exit ${apagado.status}: el freno bloquea sin estar encendido`);
    }
  }
}

// 3f-ter. La prueba nueva FALLA sin el cambio de producción (`xp.testFirst.verifyRed`). Se prueba
//     en un repo git temporal con un cebo propio: una rama donde la prueba describe el cambio
//     (roja sobre la base → pasa), una donde la prueba es un espejo (verde sobre la base →
//     bloquea), la fuga declarada y la rama sin cambio de producción. El mecanismo es el mismo
//     en cualquier stack; lo que cambia por repo es `command`, y eso es config.
{
  const script = abs("scripts/cycle-check.mjs");
  if (!fs.existsSync(script)) {
    skip("ciclo: rojo sin el cambio", "el repo no trae scripts/cycle-check.mjs");
  } else {
    const cebo = {
      commitMsg: { codePattern: "^src/", ignoreExtensions: [".md"] },
      workflow: { baseBranch: "main" },
      xp: {
        testFirst: {
          enabled: true,
          testPattern: "^tests/",
          verifyRed: { enabled: true, command: ["node", "tests/t.mjs"], escapeLine: "no-red:" },
        },
      },
    };
    const correr = (prueba, { produccion = true, mensaje = "feat: cambio", command = null, setup = null } = {}) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rojo-cebo-"));
      const ceboDelCaso = structuredClone(cebo);
      if (command) ceboDelCaso.xp.testFirst.verifyRed.command = command;
      if (setup) ceboDelCaso.xp.testFirst.verifyRed.setupCommand = setup;
      try {
        const git = (...args) => spawnSync("git", args, { cwd: tmp, encoding: "utf8" });
        const escribir = (rel, contenido) => {
          fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
          fs.writeFileSync(path.join(tmp, rel), contenido);
        };
        git("init", "-q", "-b", "main");
        git("config", "user.email", "selftest@example.com");
        git("config", "user.name", "selftest");
        escribir(".claude/harness.config.json", JSON.stringify(ceboDelCaso));
        escribir("src/f.mjs", "export const v = 1;\n");
        git("add", ".claude/harness.config.json", "src/f.mjs");
        git("commit", "-q", "-m", "base");
        git("switch", "-q", "-c", "feat/cebo");
        if (produccion) escribir("src/f.mjs", "export const v = 2;\n");
        escribir("tests/t.mjs", prueba);
        git("add", "src/f.mjs", "tests/t.mjs");
        git("commit", "-q", "-m", mensaje);
        const r = spawnSync("node", [script, "--verify-red", "main"], { cwd: tmp, encoding: "utf8" });
        const quedoWorktree = git("worktree", "list").stdout.trim().split("\n").length > 1;
        return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, quedoWorktree };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    };
    const describe = 'import { v } from "../src/f.mjs";\nprocess.exit(v === 2 ? 0 : 1);\n';
    const espejo = "process.exit(0);\n";
    const casos = [
      ["la prueba que describe el cambio falla sobre la base: pasa", describe, {}, 0],
      ["la prueba espejo pasa sobre la base: bloquea", espejo, {}, 1],
      ["la prueba espejo con `no-red: <motivo>` declarado: pasa", espejo, { mensaje: "feat: cambio\n\nno-red: prueba de humo, el cambio es de rendimiento" }, 0],
      ["sin cambio de producción no hay nada que medir: pasa", espejo, { produccion: false }, 0],
      // Lo cazó el reviewer: un comando que ni arranca devolvía `status: null`, y `null !== 0`
      // se leía como «la prueba falla sin el cambio». Un binario ausente certificaba la prueba.
      ["un comando que no arranca no es «rojo»: bloquea", describe, { command: ["comando-que-no-existe-xyz"] }, 1],
      // En un repo con dependencias el árbol de la base no las tiene (nada ignorado viaja en un
      // worktree): `setupCommand` las prepara, y si falla, la medición no vale.
      ["con `setupCommand` que falla, la medición no vale: bloquea", describe, { setup: ["node", "-e", "process.exit(3)"] }, 1],
      ["con `setupCommand` que prepara el árbol, mide igual: pasa", describe, { setup: ["node", "-e", "0"] }, 0],
    ];
    for (const [nombre, prueba, opciones, esperado] of casos) {
      const r = correr(prueba, opciones);
      if (r.status === esperado && !r.quedoWorktree) ok(`ciclo (rojo sin el cambio): ${nombre}`);
      else if (r.quedoWorktree) bad(`ciclo (rojo sin el cambio): ${nombre}`, "quedó un worktree registrado: la medición ensucia el repo");
      else bad(`ciclo (rojo sin el cambio): ${nombre}`, `esperaba exit ${esperado}, salió ${r.status}: ${r.out.trim().slice(0, 240)}`);
    }
    // Encendido y sin nadie que lo corra es «instalado y muerto»: no va en el gate (es caro),
    // así que el único lugar donde vive es el pipeline que el config declara en `runner`.
    const rojo = config.xp?.testFirst?.verifyRed;
    if (rojo?.enabled) corredorDeclarado("la verificación de rojo sin el cambio", rojo.runner, "--verify-red");
  }
}

// 3g. Los artefactos de trabajo, donde el equipo decidió. Se prueba con un CEBO en un
//     directorio temporal: `--dir` existe justamente para no escribir en el repo.
if (config.tracker?.artifactsIn === "tracker" && fs.existsSync(abs("scripts/artifacts-check.mjs"))) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-artifacts-"));
  try {
    const dir = path.join(tmp, config.tracker.specsDir ?? "specs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plan-suelto.md"), "# plan que debería vivir en el gestor\n");
    const res = spawnSync("node", [abs("scripts/artifacts-check.mjs"), "--dir", tmp], { encoding: "utf8" });
    if (res.status !== 0) ok("artifacts-check caza un artefacto suelto en el repo");
    else bad("artifacts-check caza un artefacto suelto", `exit 0 con el cebo puesto: ${res.stdout.trim()}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 3g-bis. Un índice de documentación al que le falta un documento es rojo. El cebo es un
//     CONFIG temporal cuyo índice apunta a un archivo que no enlaza nada: no se escribe
//     en el árbol.
if ((config.docs?.mustLinkAll ?? []).length) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-indice-"));
  try {
    const cebo = JSON.parse(JSON.stringify(config));
    // `incidents.file` existe y con seguridad no enlaza la documentación entera.
    cebo.docs.mustLinkAll = [{ file: config.incidents?.file ?? "docs/gotchas.md", from: ["docs"], except: [] }];
    cebo.docs.mentionSignals = [];
    const cfg = path.join(tmp, "cebo.json");
    fs.writeFileSync(cfg, JSON.stringify(cebo));
    const res = spawnSync("node", [abs("scripts/docs-linkcheck.mjs"), "--config", cfg], { encoding: "utf8" });
    if (res.status !== 0 && `${res.stdout}${res.stderr}`.includes("sin enlazar en el índice")) {
      ok("link-check caza un documento que el índice no enlaza");
    } else {
      bad("link-check caza un documento sin enlazar", `exit ${res.status}: ${(res.stdout + res.stderr).trim().slice(0, 160)}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 3h. Un documento que enumera las señales del gate y se queda corto es rojo. El cebo es
//     un CONFIG temporal que declara un doc que no las nombra: no se escribe en el árbol.
if ((config.docs?.mentionSignals ?? []).length && (config.gate?.signals ?? []).length) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-docsync-"));
  try {
    const cebo = JSON.parse(JSON.stringify(config));
    // `incidents.file` existe y con seguridad NO enumera las señales del gate.
    cebo.docs.mentionSignals = [config.incidents?.file ?? "docs/gotchas.md"];
    const cfg = path.join(tmp, "cebo.json");
    fs.writeFileSync(cfg, JSON.stringify(cebo));
    const res = spawnSync("node", [abs("scripts/docs-linkcheck.mjs"), "--config", cfg], { encoding: "utf8" });
    if (res.status !== 0 && `${res.stdout}${res.stderr}`.includes("señal sin mencionar")) {
      ok("link-check caza un documento que no nombra todas las señales del gate");
    } else {
      bad("link-check caza un documento incompleto", `exit ${res.status}: ${(res.stdout + res.stderr).trim().slice(0, 160)}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 3i. El link-check no revisa lo que git IGNORA. Es la misma asimetría que ese script existe
//     para evitar, al revés: un rojo que CI nunca ve, sobre un archivo que no está en el repo.
//     El cebo va en un directorio derivado (gitignored) para no escribir en el árbol de fuentes.
{
  const derivado = ["coverage", "dist", "build", "out"].find((d) => {
    const r = spawnSync("git", ["check-ignore", "-q", "--", `${d}/`], { cwd: REPO_ROOT });
    return r.status === 0;
  });
  if (!derivado) {
    skip("link-check ignora lo que git ignora", "el repo no declara ningún directorio derivado en .gitignore");
  } else {
    const dir = abs(derivado);
    const existia = fs.existsSync(dir);
    const cebo = path.join(dir, "puntero-selftest.md");
    try {
      fs.mkdirSync(dir, { recursive: true });
      // linkcheck:ignore — las rutas son el CEBO: tienen que no existir para que el caso sirva.
      fs.writeFileSync(cebo, "Ver [esto](../docs/no-existe-en-ningun-lado.md) y `docs/tampoco/`.\n"); // linkcheck:ignore
      const r = spawnSync("node", [abs("scripts/docs-linkcheck.mjs")], { cwd: REPO_ROOT, encoding: "utf8" });
      if (r.status === 0) ok(`link-check no revisa \`${derivado}/\` (git lo ignora)`);
      else bad("link-check ignora lo que git ignora", `salió rojo por un archivo gitignored: ${(r.stdout ?? "").trim().split("\n")[0]}`);
    } finally {
      fs.rmSync(cebo, { force: true });
      if (!existia) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ── 4. Las reglas del lint muerden (por stdin: no escribe archivos) ──────────
section("4. reglas del lint");

/** Corre el lint contra una ruta virtual con contenido por stdin. */
function lint(rutaVirtual, contenido) {
  const [cmd, ...args] = config.lint?.command ?? ["node", "scripts/repo-lint.mjs"];
  const res = spawnSync(cmd, [...args, config.lint?.fileFlag ?? "--file", rutaVirtual, "--stdin"], {
    input: contenido,
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

// 4a. PATRON: cada patrón declarado tiene que hacer fallar el lint.
for (const regla of config.patterns ?? []) {
  const ruta = sampleFromPattern(regla.appliesTo);
  const texto = sampleFromPattern(regla.pattern);
  if (!ruta || !texto) {
    skip(`lint PATRON ${regla.id}`, "patrón no reducible a ejemplo; probalo a mano");
    continue;
  }
  const archivo = ruta.endsWith("/") ? `${ruta}ejemplo.mjs` : ruta;
  const r = lint(archivo, `${texto}\n`);
  if (r.status !== 0 && r.out.includes(regla.id)) ok(`lint PATRON ${regla.id} muerde`);
  else bad(`lint PATRON ${regla.id} muerde`, `exit ${r.status} sobre \`${archivo}\`: ${r.out.trim() || "sin salida"}`);
}

// 4b. PUREZA: un import prohibido en la capa pura es rojo, en la SINTAXIS de este repo.
//     La versión anterior cableaba `import x from "mod"` y un archivo `.mjs`, así que en un repo
//     de .NET (`using X;`) reportaba ROJO una regla que funcionaba. Un falso rojo enseña a
//     ignorar la sección entera — lo destapó el banco de perfiles contra repos reales.
const extensionDeMuestra = () =>
  (config.lint?.sourceExtensions ?? config.gate?.codeExtensions ?? [])[0] ?? codeExtensions([])[0];

for (const capa of config.purity ?? []) {
  const mod = (capa.forbiddenImports ?? [])[0];
  if (!capa.dir || !mod) continue;
  const archivo = `${capa.dir.replace(/\/$/, "")}/ejemplo-selftest${extensionDeMuestra()}`;
  const sintaxis = importSyntax(capa.importSyntax ?? config.purityImportSyntax);
  const lineas = sintaxis.map((t) => sampleFromPattern(t.split("{mod}").join(mod))).filter(Boolean);
  if (!lineas.length) {
    skip(`lint PUREZA protege \`${capa.dir}\``, "ninguna plantilla de import se reduce a un ejemplo");
    continue;
  }
  // Basta que UNA sintaxis de las declaradas muerda: el archivo de muestra es de un lenguaje.
  const rojos = lineas.filter((linea) => {
    const r = lint(archivo, `${linea}\n`);
    return r.status !== 0 && r.out.includes("PUREZA");
  });
  if (rojos.length) ok(`lint PUREZA protege \`${capa.dir}\` de \`${mod}\` (${rojos.length}/${lineas.length} sintaxis)`);
  else bad(`lint PUREZA protege \`${capa.dir}\``, `ninguna de las ${lineas.length} sintaxis declaradas hizo fallar el lint`);
}

// 4c. ONLY: un `.only(` olvidado es rojo.
if (config.tests?.onlyPattern) {
  const r = lint("tests/ejemplo.test.ts", 'describe.only("x", () => {});\n');
  if (r.status !== 0 && r.out.includes("ONLY")) ok("lint ONLY caza un `.only(` olvidado");
  else bad("lint ONLY caza un `.only(` olvidado", `exit ${r.status}: ${r.out.trim() || "sin salida"}`);
}

// 4d. FUENTEUNICA: cablear un literal del registro fuera de él es rojo.
for (const regla of config.singleSource ?? []) {
  // Un registro puede declarar sus literales a mano (`literals`) o extraerlos del propio archivo
  // fuente (`extract`). La segunda forma quedaba OMITIDA: el caso no corría y nadie se enteraba,
  // justo en la variante que usa un repo con un registro grande.
  let literal = (regla.literals ?? [])[0];
  if (!literal && regla.extract && regla.source) {
    try {
      const fuente = fs.readFileSync(abs(regla.source), "utf8");
      const hit = new RegExp(regla.extract).exec(fuente);
      literal = hit?.[1] ?? hit?.[0];
    } catch {
      /* la ruta inexistente ya la reporta la sección 2 */
    }
  }
  const ruta = sampleFromPattern(regla.appliesTo);
  if (!literal || !ruta) {
    skip(`lint ${regla.id ?? "FUENTEUNICA"}`, "sin literal (ni `literals` ni `extract` utilizable) o patrón no reducible");
    continue;
  }
  const archivo = ruta.endsWith("/") ? `${ruta}ejemplo.mjs` : ruta;
  const r = lint(archivo, `const evento = "${literal}";\n`);
  if (r.status !== 0) ok(`lint ${regla.id} bloquea cablear \`${literal}\``);
  else bad(`lint ${regla.id} bloquea cablear \`${literal}\``, `exit 0 sobre \`${archivo}\`: el literal pasó`);
}

// 4e. INCIDENTE: un gotcha sin `Mecanismo:` es rojo (cebo, no se escribe nada).
if (config.incidents?.file) {
  const heading = config.incidents.heading ?? "### GOTCHA";
  const cebo = `${heading}: incidente de prueba\n\nSíntoma: algo se rompió.\nCausa:   alguien lo rompió.\nRegla:   no romperlo.\n`;
  const r = lint(config.incidents.file, cebo);
  if (r.status !== 0 && r.out.includes("INCIDENTE")) ok("lint INCIDENTE exige `Mecanismo:` en cada gotcha");
  else bad("lint INCIDENTE exige `Mecanismo:`", `exit ${r.status}: ${r.out.trim() || "sin salida"}`);
}

// 4e-bis. COHERENCIA: una guía que recomienda lo que `bash.deny` veda es roja, y la misma guía
//     con un comando inocente pasa. La muestra sale de la primera regla de `bash.deny` cuyo
//     ejemplo tiene forma de comando en ESTE repo (`coherence.commandPattern`): el self-test
//     no lleva una lista de comandos peligrosos cableada.
{
  const coh = config.coherence;
  let reCmd = null;
  try {
    reCmd = coh?.commandPattern ? new RegExp(coh.commandPattern) : null;
  } catch {
    reCmd = null; // el regex inválido ya lo reporta la sección 2
  }
  const guia = (coh?.guides ?? []).map((g) => g.replace(/\/$/, "")).find((g) => g.endsWith(".md")) ??
    (coh?.guides?.[0] ? `${coh.guides[0].replace(/\/$/, "")}/cebo.md` : null);
  const vedado = (config.bash?.deny ?? [])
    .map((r) => sampleFromPattern(r.pattern)?.trim())
    .find((m) => m && reCmd?.test(m) && firstMatch(config.bash.deny, m));
  if (!reCmd || !guia) {
    skip("lint COHERENCIA", "este repo no declara `coherence.commandPattern` ni `coherence.guides`");
  } else if (!vedado) {
    skip("lint COHERENCIA", "ninguna regla de `bash.deny` se reduce a un comando con la forma de `commandPattern`; probalo a mano");
  } else {
    const valla = (cmd) => `# guía de prueba\n\n\`\`\`bash\n${cmd}\n\`\`\`\n`;
    const r = lint(guia, valla(vedado));
    if (r.status !== 0 && r.out.includes("COHERENCIA")) ok(`lint COHERENCIA: una guía que recomienda \`${vedado}\` es roja`);
    else bad("lint COHERENCIA muerde en una guía", `exit ${r.status} con \`${vedado}\` en \`${guia}\`: ${r.out.trim() || "sin salida"}`);

    const inocente = lint(guia, valla("git status --porcelain"));
    if (inocente.status === 0) ok("lint COHERENCIA deja pasar una guía que recomienda `git status`");
    else bad("lint COHERENCIA no muerde de más", `exit ${inocente.status}: ${inocente.out.trim()}`);

    // El config: un `message` que ofrece el comando vedado como salida es rojo; la regla de
    // `bash.deny` que CITA su propia ofensa en el motivo no lo es (si lo fuera, el config
    // real ya estaría rojo, y esa es la otra mitad de la prueba).
    const [cmd, ...args] = config.lint?.command ?? ["node", "scripts/repo-lint.mjs"];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-coherencia-"));
    const cebo = path.join(tmp, "config.json");
    fs.writeFileSync(
      cebo,
      JSON.stringify({ ...config, sdd: { ...config.sdd, routes: [{ route: "cebo", patterns: ["x"], message: `Salida: corré \`${vedado}\`.` }] } }),
    );
    const rc = spawnSync(cmd, [...args, "--config", cebo, config.lint?.fileFlag ?? "--file", ".claude/harness.config.json", "--stdin"], {
      input: fs.readFileSync(cebo, "utf8"),
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    fs.rmSync(tmp, { recursive: true, force: true });
    if (rc.status !== 0 && `${rc.stdout}${rc.stderr}`.includes("COHERENCIA")) ok("lint COHERENCIA: un `message` del config que ofrece un comando vedado es rojo");
    else bad("lint COHERENCIA muerde en el config", `exit ${rc.status}: ${`${rc.stdout}${rc.stderr}`.trim() || "sin salida"}`);
  }
}

// 4b-bis. PUREZA con la sintaxis de import DECLARADA: cada plantilla tiene que morder.
//     Sin esto, un repo que angosta `purityImportSyntax` a una sintaxis mal escrita se
//     queda con la regla de mayor retorno silenciosamente apagada.
for (const capa of config.purity ?? []) {
  const sintaxis = importSyntax(capa.importSyntax ?? config.purityImportSyntax);
  const mod = (capa.forbiddenImports ?? [])[0];
  if (!capa.dir || !mod) {
    // La regla de mayor retorno no puede quedar sin probar EN SILENCIO.
    skip(`lint PUREZA sintaxis de \`${capa.dir ?? "(sin dir)"}\``, "la capa no declara `dir` o no veta ningún import");
    continue;
  }
  if (!sintaxis.length) continue; // sin sintaxis declarada lo cubre 4b con el default
  const archivo = `${capa.dir.replace(/\/$/, "")}/ejemplo-selftest.mjs`;
  for (const plantilla of sintaxis) {
    const linea = sampleFromPattern(plantilla.split("{mod}").join(mod));
    if (!linea) {
      skip(`lint PUREZA sintaxis \`${plantilla}\``, "la plantilla no se reduce a un ejemplo; probala a mano");
      continue;
    }
    const r = lint(archivo, `${linea}\n`);
    if (r.status !== 0 && r.out.includes("PUREZA")) ok(`lint PUREZA caza \`${linea.trim()}\``);
    else bad(`lint PUREZA caza \`${linea.trim()}\``, `exit ${r.status}: ${r.out.trim() || "sin salida"}`);
  }
}

// 4g. DEPS: la dependencia vetada en el manifiesto es roja. Se prueba por stdin porque el
//     ejemplo se deriva de `forbiddenDeps.matcher` — el default sólo entiende manifiestos
//     clave-valor, así que un `.csproj` o un `pom.xml` sin matcher propio salía VERDE.
{
  const spec = config.forbiddenDeps;
  const pkg = (spec?.packages ?? [])[0];
  if (!spec?.manifest || !pkg) {
    skip("lint DEPS", "el repo no veta ninguna dependencia");
  } else {
    const matcher = spec.matcher ?? "^\\s*[\"']?{pkg}[\"']?\\s*[:=]";
    const linea = sampleFromPattern(matcher.split("{pkg}").join(pkg));
    if (!linea) {
      skip("lint DEPS", "`forbiddenDeps.matcher` no se reduce a un ejemplo; probalo a mano");
    } else {
      const r = lint(spec.manifest, `${linea}\n`);
      if (r.status !== 0 && r.out.includes("DEPS")) ok(`lint DEPS caza \`${pkg}\` en \`${spec.manifest}\``);
      else bad(`lint DEPS caza \`${pkg}\``, `exit ${r.status} con \`${linea.trim()}\`: ${r.out.trim() || "sin salida"}`);
    }
  }
}

// 4g-bis. Y DEPS no muerde de más: un manifiesto sin la dependencia vetada pasa. El ruteo por
//     stdin es nuevo (antes `--file <manifiesto> --stdin` se salteaba DEPS entero), así que la
//     dirección «deja pasar lo inocente» necesita su propio caso.
{
  const spec = config.forbiddenDeps;
  if (spec?.manifest && (spec.packages ?? []).length) {
    const r = lint(spec.manifest, '{\n  "dependencies": {}\n}\n');
    if (r.status === 0) ok(`lint DEPS deja pasar un \`${spec.manifest}\` limpio`);
    else bad("lint DEPS deja pasar un manifiesto limpio", `exit ${r.status}: ${r.out.trim()}`);
  }
}

// 4g-ter. INVARIANTE: la clase de regla que no se podía probar por stdin (lee el archivo del
//     disco) y por eso no tenía caso. Con `--config` se prueba con un config temporal: se le
//     exige a un archivo real una línea que no tiene, y se verifica que sea rojo.
if ((config.invariants ?? []).length) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-invariante-"));
  try {
    const cebo = JSON.parse(JSON.stringify(config));
    cebo.invariants = [
      {
        file: config.invariants[0].file,
        required: ["ESTA-LINEA-NO-EXISTE-EN-NINGUN-ARCHIVO"],
        forbidden: [],
        reason: "cebo del self-test",
      },
    ];
    const cfg = path.join(tmp, "cebo.json");
    fs.writeFileSync(cfg, JSON.stringify(cebo));
    const res = spawnSync("node", [abs("scripts/repo-lint.mjs"), "--config", cfg], { encoding: "utf8" });
    const salida = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    if (res.status !== 0 && salida.includes("INVARIANTE")) ok("lint INVARIANTE caza una línea que desapareció");
    else bad("lint INVARIANTE caza una línea faltante", `exit ${res.status}: ${salida.trim().slice(0, 160)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 4h. PERFIL: un perfil de stack con reglas adentro es rojo (P14). El cebo va por stdin.
if (config.profiles?.dir) {
  const dir = config.profiles.dir.replace(/\/$/, "");
  for (const clave of config.profiles.forbiddenKeys ?? []) {
    const [raiz, hijo] = clave.split(".");
    const cebo = hijo ? { [raiz]: { [hijo]: [{ x: 1 }] } } : { [raiz]: [{ x: 1 }] };
    const r = lint(`${dir}/cebo-selftest.json`, JSON.stringify(cebo));
    if (r.status !== 0 && r.out.includes("PERFIL")) ok(`lint PERFIL rechaza \`${clave}\` en un perfil`);
    else bad(`lint PERFIL rechaza \`${clave}\``, `exit ${r.status}: ${r.out.trim() || "sin salida"}`);
  }
  // Cada clave OBLIGATORIA también tiene su cebo: el cebo se arma con todas menos una.
  const requeridas = config.profiles.requiredKeys ?? [];
  for (const ausente of requeridas) {
    const cebo = {};
    for (const clave of requeridas) {
      if (clave === ausente) continue;
      const [raiz, hijo] = clave.split(".");
      if (hijo) cebo[raiz] = { ...(cebo[raiz] ?? {}), [hijo]: ["x"] };
      else cebo[raiz] = ["x"];
    }
    const r = lint(`${dir}/cebo-selftest.json`, JSON.stringify(cebo));
    if (r.status !== 0 && r.out.includes("PERFIL")) ok(`lint PERFIL exige \`${ausente}\` en un perfil`);
    else bad(`lint PERFIL exige \`${ausente}\``, `exit ${r.status}: ${r.out.trim() || "sin salida"}`);
  }

  // Y NO de más: los perfiles que el repo publica de verdad tienen que pasar.
  // El `.json` se filtra: un README o un .DS_Store en el directorio convertía esta aserción
  // en un fallo de JSON.parse con un mensaje que no señalaba la causa.
  const realExiste = fs.readdirSync(abs(dir)).filter((f) => f.endsWith(".json"))[0];
  if (realExiste) {
    const r = lint(`${dir}/verdadero-selftest.json`, fs.readFileSync(abs(`${dir}/${realExiste}`), "utf8"));
    if (r.status === 0) ok(`lint PERFIL deja pasar un perfil real (\`${realExiste}\`)`);
    else bad("lint PERFIL deja pasar un perfil real", `exit ${r.status}: ${r.out.trim()}`);
  }

  // Un `profiles.dir` que apunta a la nada, y uno vacío, también son rojos: es la forma en que
  // esta regla se apaga sin que nadie lo note. Se prueban con un CONFIG temporal (`--config`),
  // no escribiendo en el árbol de fuentes (P7).
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-perfilcfg-"));
    try {
      const conDir = (valor) => {
        const cebo = JSON.parse(JSON.stringify(config));
        cebo.profiles.dir = valor;
        const cfg = path.join(tmp, `cfg-${path.basename(valor)}.json`);
        fs.writeFileSync(cfg, JSON.stringify(cebo));
        const res = spawnSync("node", [abs("scripts/repo-lint.mjs"), "--config", cfg], { encoding: "utf8" });
        return `${res.stdout ?? ""}${res.stderr ?? ""}`;
      };

      const fantasma = conDir("plantillas/perfiles-que-no-existen"); // linkcheck:ignore — es el CEBO: tiene que NO existir
      if (fantasma.includes("PERFIL")) ok("lint PERFIL caza un `profiles.dir` que apunta a la nada");
      else bad("lint PERFIL caza un `profiles.dir` inexistente", `sin hallazgo: ${fantasma.trim().slice(0, 160)}`);

      const vacio = path.join(tmp, "perfiles-vacios");
      fs.mkdirSync(vacio, { recursive: true });
      const sinPerfiles = conDir(path.relative(REPO_ROOT, vacio));
      if (sinPerfiles.includes("PERFIL")) ok("lint PERFIL caza un directorio de perfiles vacío");
      else bad("lint PERFIL caza un directorio vacío", `sin hallazgo: ${sinPerfiles.trim().slice(0, 160)}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

// 4f. El arnés no escribe temporales dentro del árbol de fuentes.
{
  // La raíz NO alcanza: los casos nuevos operan sobre `scripts/`, `plantillas/perfiles/` y
  // `.claude/hooks/` por stdin, y un temporal ahí adentro es igual de dañino (un watcher lo
  // ve aparecer y el build muere con un error que nadie puede reproducir).
  const dondeBuscar = [".", "scripts", ".claude/hooks", config.profiles?.dir, config.examples?.dir].filter(Boolean);
  const sospechosos = [];
  for (const dir of dondeBuscar) {
    let entradas = [];
    try {
      entradas = fs.readdirSync(abs(dir));
    } catch {
      continue;
    }
    for (const f of entradas) {
      if (/selftest|cebo|tmp-|\.tmp$/.test(f)) sospechosos.push(dir === "." ? f : `${dir}/${f}`);
    }
  }
  // `harness-selftest.mjs` es el script, no un residuo.
  const residuos = sospechosos.filter((f) => f !== "scripts/harness-selftest.mjs");
  if (!residuos.length) ok(`el self-test no dejó temporales (${dondeBuscar.length} directorios revisados)`);
  else bad("el self-test no dejó temporales", `sobraron: ${residuos.join(", ")}`);
}

// ── 5. El clasificador de pedidos no se degrada ──────────────────────────────
section("5. ruteo de pedidos");
if (hookFiles.has("sdd-router.mjs")) {
  for (const route of config.sdd?.routes ?? []) {
    const muestra = sampleFromPattern((route.patterns ?? [])[0] ?? "");
    if (!muestra) {
      skip(`ruteo ${route.route}`, "patrón no reducible a ejemplo");
      continue;
    }
    const r = runHook("sdd-router.mjs", { hook_event_name: "UserPromptSubmit", prompt: `quiero ${muestra}` });
    const habla = r.stdout.includes(route.route);
    if (route.message && habla) ok(`ruteo «${muestra.trim()}» → ${route.route}`);
    else if (!route.message && !r.stdout.trim()) ok(`ruteo «${muestra.trim()}» → silencio (trivial)`);
    else bad(`ruteo «${muestra.trim()}» → ${route.route}`, `stdout: ${r.stdout.trim() || "(vacío)"}`);
  }
  const trivial = runHook("sdd-router.mjs", { hook_event_name: "UserPromptSubmit", prompt: "gracias" });
  if (!trivial.stdout.trim()) ok("el router se calla en lo trivial (un hook que habla siempre deja de leerse)");
  else bad("el router se calla en lo trivial", `habló: ${trivial.stdout.trim()}`);
}

// 5b. El índice del código: el hook `graph-first` habla SÓLO si hay algo que consultar.
//     Un hook que habla sin índice manda al agente a correr un comando que no existe, y con
//     eso se gana que dejen de leerlo. El caso se escribe a mano porque depende de un
//     artefacto DERIVADO (`graph.graphFile`), que puede estar o no estar en esta máquina.
if (hookFiles.has("graph-first.mjs") && config.graph) {
  const hayIndice = fs.existsSync(abs(config.graph.graphFile ?? ""));
  const muestra = sampleFromPattern((config.graph.questionPatterns ?? [])[0] ?? "");
  const r = runHook("graph-first.mjs", {
    hook_event_name: "UserPromptSubmit",
    prompt: muestra ? `${muestra} está el parser` : "dónde está el parser",
  });
  if (!hayIndice) {
    if (!r.stdout.trim()) ok("graph-first se calla sin índice construido (`codegraph init` no corrió acá)");
    else bad("graph-first se calla sin índice", `habló sin nada que consultar: ${r.stdout.trim().slice(0, 120)}`);
  } else if (r.stdout.includes(config.graph.queryCommand?.split(" ")[0] ?? "")) {
    ok("graph-first empuja al índice antes de abrir archivos");
  } else {
    bad("graph-first empuja al índice", `con índice construido no nombró el comando de consulta: ${r.stdout.trim().slice(0, 120) || "(vacío)"}`);
  }
  // Lo trivial no se rutea: vale para TODOS los hooks de UserPromptSubmit, no sólo el router.
  const trivialGrafo = runHook("graph-first.mjs", { hook_event_name: "UserPromptSubmit", prompt: "gracias" });
  if (!trivialGrafo.stdout.trim()) ok("graph-first se calla en lo trivial");
  else bad("graph-first se calla en lo trivial", `habló: ${trivialGrafo.stdout.trim().slice(0, 120)}`);
}

// ── 6. Señales del gate, subagentes y comandos ──────────────────────────────
section("6. gate, subagentes y comandos");
const senales = config.gate?.signals ?? [];
if (!senales.length) bad("gate.signals", "el gate no verifica nada: `signals` está vacío");
for (const s of senales) {
  const argv = s.command ?? [];
  if (!argv.length) {
    bad(`señal «${s.name}»`, "no declara command");
    continue;
  }
  // Si el segundo argumento es una ruta del repo, tiene que existir.
  const posibleRuta = argv.slice(1).find((a) => /[/\\]/.test(a) && !a.startsWith("-"));
  if (posibleRuta && !fs.existsSync(abs(posibleRuta))) bad(`señal «${s.name}»`, `\`${posibleRuta}\` no existe`);
  else if (!s.why) bad(`señal «${s.name}»`, "no declara `why`: una señal sin motivo es una señal que nadie defiende");
  else ok(`señal «${s.name}» → ${argv.join(" ")}`);
}
// `--config` es para los cebos del self-test: en una señal del gate mediría un config
// permisivo y el gate saldría verde igual. La deuda declarada sólo puede achicarse.
{
  const conConfig = (config.gate?.signals ?? []).filter((x) => (x.command ?? []).includes("--config"));
  if (!conConfig.length) ok("ninguna señal del gate mide un config alternativo (`--config`)");
  else bad("ninguna señal del gate usa `--config`", `«${conConfig.map((x) => x.name).join(", ")}»: el gate mediría otro config que el del repo`);
}
// El gate corre en cualquier plataforma o no es el entregable de todo el equipo. Tres cosas:
// que la implementación en Node exista y parsee, que el envoltorio de shell no tenga una
// segunda implementación adentro, y que el bit de ejecución sólo se exija donde existe
// (en Windows, NTFS no lo tiene: exigirlo daba un rojo que nadie podía arreglar).
{
  const gateMjs = abs("scripts/gate.mjs");
  if (!fs.existsSync(gateMjs)) bad("scripts/gate.mjs", "no existe: el gate no corre fuera de un shell POSIX");
  else if (spawnSync("node", ["--check", gateMjs], { encoding: "utf8" }).status !== 0)
    bad("scripts/gate.mjs", "no parsea: `node --check` falla");
  else ok("scripts/gate.mjs existe y parsea (el gate no depende de bash)");

  const gateSh = abs("scripts/gate.sh");
  if (!fs.existsSync(gateSh)) skip("scripts/gate.sh", "no hay envoltorio de shell (opcional)");
  else {
    const cuerpo = fs.readFileSync(gateSh, "utf8");
    if (!/gate\.mjs/.test(cuerpo))
      bad("scripts/gate.sh delega en gate.mjs", "no nombra `gate.mjs`: dos implementaciones del gate son dos definiciones de entregable");
    else ok("scripts/gate.sh delega en `gate.mjs` (una sola implementación)");

    if (process.platform === "win32") skip("bit de ejecución de scripts/gate.sh", "Windows no tiene bit de ejecución");
    else if (!(fs.statSync(gateSh).mode & 0o111)) bad("scripts/gate.sh", "no es ejecutable (`chmod +x scripts/gate.sh`)");
    else ok("scripts/gate.sh es ejecutable");
  }
}
// Ninguna señal del gate puede necesitar un shell para arrancar. `["bash", "algo.sh"]` como
// señal deja el entregable fuera de alcance en Windows, que es donde menos se prueba y donde
// más caro sale descubrirlo.
{
  const interpretes = new Set(["bash", "sh", "zsh", "cmd", "cmd.exe", "powershell", "pwsh"]);
  const conShell = senales.filter((s) => interpretes.has(String((s.command ?? [])[0] ?? "").toLowerCase()));
  if (!conShell.length) ok("ninguna señal del gate necesita un shell para arrancar (corre en Windows)");
  else
    bad(
      "ninguna señal del gate necesita un shell",
      `«${conShell.map((x) => x.name).join(", ")}»: invocan un intérprete que en Windows no está garantizado`,
    );
}
for (const dir of [".claude/agents", ".claude/commands"]) {
  if (!fs.existsSync(abs(dir))) {
    bad(dir, "no existe: el arnés declara subagentes/comandos que no están");
    continue;
  }
  const files = fs.readdirSync(abs(dir)).filter((f) => f.endsWith(".md"));
  if (!files.length) bad(dir, "está vacío");
  else {
    let malos = 0;
    for (const f of files) {
      const head = fs.readFileSync(abs(`${dir}/${f}`), "utf8").slice(0, 400);
      if (!head.startsWith("---") || !/description:/.test(head)) {
        malos += 1;
        bad(`${dir}/${f}`, "le falta el frontmatter con `description:` (Claude Code no lo va a ofrecer)");
      }
    }
    if (!malos) ok(`${dir}: ${files.length} archivo(s) con frontmatter válido`);
  }
}

// 6b. El banco corre sus casos en procesos hijos, uno por stack. Eso mete tres maneras nuevas
//     de reportar VERDE sin haber probado nada, y ninguna la ve otra señal:
//       · un nombre de caso mal escrito → el hijo no prueba nada y el total sale vacío;
//       · `--only=` sin valor → se piden uno y corren todos (pedir un caso y probar otra cosa);
//       · un hijo que revienta → sus resultados no llegan y el padre los cuenta como cero.
//     Los tres son la misma cicatriz que el gate ya tiene («ninguna señal llegó a correr»), y
//     los tres se prueban acá: el caso más caro corre UN caso del banco (~3s), no los nueve.
{
  const banco = abs("scripts/harness-bench.mjs");
  const correrBanco = (...args) => {
    const r = spawnSync("node", [banco, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
    return { status: r.status, salida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };

  if (!fs.existsSync(banco)) {
    skip("el banco es rojo si no probó nada", "este repo no lleva `scripts/harness-bench.mjs` (es del arnés, no de los repos portados)");
  } else {
    const inexistente = correrBanco("--only=no-existe-este-caso");
    if (inexistente.status !== 0 && /no existe el caso/.test(inexistente.salida))
      ok("el banco es ROJO con un caso que no existe (no verde vacío)");
    else
      bad("el banco es ROJO con un caso que no existe", `exit ${inexistente.status}: un nombre mal escrito daría «BANCO VERDE — 0 comprobaciones»`);

    const vacio = correrBanco("--only=");
    if (vacio.status !== 0 && /sin valor/.test(vacio.salida))
      ok("el banco es ROJO con `--only=` sin valor (pedir uno y correr nueve es probar otra cosa)");
    else
      bad("el banco es ROJO con `--only=` sin valor", `exit ${vacio.status}: corrió los nueve casos diciendo que corría uno`);

    // El nombre del caso sale de la lista que el propio banco imprime: cablear `dotnet` acá
    // metería un stack en el self-test (que tiene que ser agnóstico) y, peor, haría que
    // renombrar un fixture fallara con el mensaje del protocolo JSON en vez del suyo.
    const primero = /^Casos: (.+)$/m.exec(inexistente.salida)?.[1]?.trim().split(/\s+/)[0];
    if (!primero) {
      bad("el banco lista sus casos al rechazar uno", "sin la línea `Casos:` nadie sabe qué pedirle, ni este self-test");
    } else {
      // El camino feliz —el hijo entrega, el padre junta— NO se prueba acá a propósito: lo
      // prueba el banco entero, que es la señal siguiente del gate. Si el hijo dejara de
      // emitir la marca, el banco registra los nueve casos como «no entregó resultados» y
      // sale ROJO solo. Correr acá un caso del banco costaba 4s para afirmar lo mismo: es la
      // misma duplicación que se sacó del `quickstart`, más chica y en el camino crítico.

      // Lo que el banco NO puede producir solo: un hijo que no entrega. La costura
      // `--mute-child` existe sólo para esto y sólo puede poner el banco más rojo.
      const mudo = correrBanco(`--cases=${primero}`, `--mute-child=${primero}`);
      if (mudo.status !== 0 && new RegExp(`el caso .${primero}. entregó resultados`).test(mudo.salida))
        ok("el banco es ROJO si un hijo no entrega resultados (y nombra el caso)");
      else
        bad("el banco es ROJO si un hijo no entrega resultados", `exit ${mudo.status}: un caso que revienta desaparecería del resumen y el total daría verde`);
    }
  }
}

// ── 7. Kit SDD declarado ─────────────────────────────────────────────────────
section("7. kit SDD");
const fases = config.sdd?.phases ?? [];
if (!fases.length) {
  skip("fases SDD instaladas", "el proyecto no declara `sdd.phases` (el ruteo funciona igual)");
} else if (EN_CI) {
  skip("fases SDD instaladas", "$CI: las skills viven en la máquina del desarrollador");
} else {
  const roots = (config.sdd.skillRoots ?? []).map((r) => (r.startsWith("~") ? path.join(os.homedir(), r.slice(1)) : abs(r)));
  for (const fase of fases) {
    const encontrada = roots.some((root) => fs.existsSync(path.join(root, fase)) || fs.existsSync(path.join(root, `${fase}.md`)));
    if (encontrada) ok(`fase \`${fase}\` instalada`);
    else bad(`fase \`${fase}\``, `no está en ninguno de: ${(config.sdd.skillRoots ?? []).join(", ")}`);
  }
}
const puntero = config.sdd?.activeFeaturePointer;
if (puntero && !fs.existsSync(abs(puntero))) {
  bad("puntero de feature activa", `\`${puntero}\` no existe: el config apunta a la nada`);
} else if (puntero) {
  ok(`puntero de feature activa \`${puntero}\``);
}

// ── 8. Perfiles de stack: el portado a un repo que no es de este lenguaje ────
//    El instalador viajó roto dos releases porque nadie lo corría; un perfil que no se
//    puede fusionar o que se lleva puestas las señales del gate rompe el portado igual.
section("8. perfiles y ejemplos por stack");
{
  const dirPerfiles = config.profiles?.dir;
  const init = abs("scripts/harness-init.mjs");
  if (!dirPerfiles || !fs.existsSync(init)) {
    skip("perfiles de stack", "el repo no declara `profiles.dir` o no tiene instalador");
  } else {
    const perfiles = fs.readdirSync(abs(dirPerfiles)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
    if (!perfiles.length) bad("perfiles de stack", `\`${dirPerfiles}\` no tiene ningún perfil`);

    const plantilla = JSON.parse(fs.readFileSync(abs("plantillas/harness.config.json"), "utf8"));
    const nombresPlantilla = (plantilla.gate?.signals ?? []).map((x) => x.name).join(" · ");

    for (const perfil of perfiles) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `harness-perfil-${perfil}-`));
      try {
        spawnSync("git", ["init", "-q", tmp], { encoding: "utf8" });

        // Dry-run: no escribe nada (P9). Lo que se verifica es justamente eso.
        const seco = spawnSync("node", [init, tmp, "--profile", perfil], { encoding: "utf8" });
        const escribio = fs.existsSync(path.join(tmp, ".claude"));
        if (seco.status !== 0 || escribio) {
          bad(`perfil \`${perfil}\` en dry-run`, escribio ? "el dry-run ESCRIBIÓ en el destino" : (seco.stderr || seco.stdout).trim().slice(0, 160));
          continue;
        }

        const res = spawnSync("node", [init, tmp, "--profile", perfil, "--apply"], { encoding: "utf8" });
        if (res.status !== 0) {
          bad(`perfil \`${perfil}\` instalado`, (res.stderr || res.stdout).trim().slice(0, 160));
          continue;
        }
        const generado = JSON.parse(fs.readFileSync(path.join(tmp, ".claude/harness.config.json"), "utf8"));
        const propio = JSON.parse(fs.readFileSync(abs(`${dirPerfiles}/${perfil}.json`), "utf8"));

        const extEsperadas = propio.gate?.codeExtensions ?? [];
        const extFaltantes = extEsperadas.filter((e) => !(generado.gate?.codeExtensions ?? []).includes(e));
        // Por NOMBRE y no por cantidad: reemplazar las N señales de la plantilla por otras N es
        // justamente el error probable (uno «ya sabe» el comando de test del stack), y un
        // contador lo deja pasar.
        const nombresGenerados = (generado.gate?.signals ?? []).map((x) => x.name).join(" · ");

        // La divergencia de extensiones también se verifica sobre el config GENERADO: un perfil
        // que declare una extensión fuera del default agnóstico tiene que traer su
        // `lint.sourceExtensions`, o el portado arranca con el barrido ciego ahí.
        const huerfanasDelPerfil = huerfanasDe(generado);
        if (huerfanasDelPerfil.length) {
          bad(`perfil \`${perfil}\` no deja el barrido ciego`, `\`${huerfanasDelPerfil.join(", ")}\` ensucian el gate y el lint no las barre: declaralas en \`lint.sourceExtensions\``);
        } else if (extFaltantes.length) {
          bad(`perfil \`${perfil}\` aporta sus extensiones`, `faltan en el config generado: ${extFaltantes.join(", ")}`);
        } else if (nombresGenerados !== nombresPlantilla) {
          // Un perfil que llena `gate.signals` adivina el comando de test de otro equipo.
          bad(`perfil \`${perfil}\` no toca gate.signals`, `la plantilla trae «${nombresPlantilla}» y el generado «${nombresGenerados}»`);
        } else {
          // El lint que se corre es LA COPIA DEL DESTINO, no la de este repo: `repo-lint.mjs`
          // resuelve su config desde `import.meta.url` e IGNORA el cwd, así que correr la copia
          // de acá con `cwd: tmp` leía el config de ESTE repo — la aserción pasaba igual con un
          // config generado vacío o inválido. Es `--rules` y no el lint completo a propósito: el
          // portado arranca en ROJO por los placeholders, y eso está declarado en la plantilla.
          const lintDelDestino = spawnSync("node", [path.join(tmp, "scripts/repo-lint.mjs"), "--rules"], {
            cwd: tmp,
            encoding: "utf8",
          });
          const habla = lintDelDestino.stdout ?? "";
          if (lintDelDestino.status !== 0) {
            bad(`perfil \`${perfil}\` genera un config legible`, (lintDelDestino.stderr || habla).trim().slice(0, 200));
          } else if (habla.includes("plantillas/perfiles")) {
            // Si aparece el directorio de perfiles de ESTE repo, el lint leyó el config de acá.
            bad(`perfil \`${perfil}\` → se linteó el config del destino`, "la salida menciona `plantillas/perfiles`: se leyó el config de este repo, no el generado");
          } else {
            // El arnés recién instalado NO puede apuntar a la nada: los subagentes, los comandos
            // y la constitución citan documentos, y si el instalador no los copia el repo
            // portado arranca con el link-check en rojo el primer día (P10 violado por el
            // propio instalador). Lo destapó el banco de perfiles contra repos reales.
            const punteros = spawnSync("node", [path.join(tmp, "scripts/docs-linkcheck.mjs")], {
              cwd: tmp,
              encoding: "utf8",
            });
            if (punteros.status === 0) {
              ok(`perfil \`${perfil}\` → config instalable y sin punteros rotos (${extEsperadas.length} extensión(es))`);
            } else {
              bad(
                `perfil \`${perfil}\` → el arnés instalado no apunta a la nada`,
                `\`docs-linkcheck\` del repo portado sale rojo el primer día:\n      ${(punteros.stdout ?? "").trim().split("\n").slice(0, 4).join("\n      ")}`,
              );
            }
          }
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
  }
}

// 8a-bis. Ningún freno viaja MUERTO. El instalador copia hooks y hooks de git; si el config de
//     arranque no trae la clave que los activa, el repo portado tiene el archivo presente y el
//     eslabón activador que nunca corre — el anti-patrón que este arnés existe para evitar,
//     cometido por el propio instalador (viajaron `ask-first`, `action-guard` y `pre-push` con la
//     plantilla sin `askFirst` ni `branches`).
{
  const activadores = config.install?.activators ?? {};
  const init = abs("scripts/harness-init.mjs");
  if (!Object.keys(activadores).length) {
    skip("ningún freno viaja muerto", "el repo no declara `install.activators`");
  } else if (!fs.existsSync(init)) {
    skip("ningún freno viaja muerto", "el repo no tiene instalador");
  } else {
    const fuenteInit = fs.readFileSync(init, "utf8");
    const plantilla = JSON.parse(fs.readFileSync(abs("plantillas/harness.config.json"), "utf8"));
    const enRuta = (obj, ruta) => ruta.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
    const vacio = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);

    let muertos = 0;
    for (const [freno, clave] of Object.entries(activadores)) {
      // Sólo cuenta si el instalador realmente lo copia: la tabla puede nombrar frenos que este
      // repo tiene y no publica.
      if (!fuenteInit.includes(freno)) continue;
      if (vacio(enRuta(plantilla, clave))) {
        muertos += 1;
        bad(
          `el freno \`${freno}\` viaja activado`,
          `el instalador lo copia y la plantilla no trae \`${clave}\`: en el repo portado queda instalado y MUERTO`,
        );
      }
    }
    if (!muertos) ok(`los ${Object.keys(activadores).length} frenos que viajan traen su clave que los activa`);
  }
}

// 8b. Las configs de ejemplo se publican PARA COPIAR: un regex roto ahí viaja igual que un
//     script roto, y nadie las corría. Lo verificable sin el repo destino: que parseen, que
//     sus regex compilen, que cada señal declare su `why` y que un manifiesto que NO es
//     clave-valor traiga su `matcher` (sin eso, DEPS sale verde con la dependencia puesta).
if (config.examples?.dir) {
  const dirEjemplos = config.examples.dir.replace(/\/$/, "");
  // Qué manifiestos entiende el `matcher` por default sale del CONFIG: es una lista de
  // literales de formato, o sea exactamente lo que no va cableado en un script (P4).
  const patronesClaveValor = config.examples?.keyValueManifests ?? [];
  const esClaveValor = (manifiesto) =>
    patronesClaveValor.some((glob) =>
      new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").split("*").join(".*")}$`, "i").test(path.basename(manifiesto)),
    );
  let archivos = [];
  try {
    archivos = fs.readdirSync(abs(dirEjemplos)).filter((f) => f.endsWith(".json"));
  } catch {
    bad("configs de ejemplo", `\`${dirEjemplos}\` no existe`);
  }
  /** Qué se le puede exigir a una config de ejemplo sin tener el repo destino. */
  const validarEjemplo = (ej) => {
    const patrones = [
      ...(ej.protectedPaths ?? []).map((r) => r.pattern),
      ...(ej.bash?.deny ?? []).map((r) => r.pattern),
      ...(ej.reuse ?? []).flatMap((r) => [r.pattern, r.appliesTo]),
      ...(ej.patterns ?? []).flatMap((r) => [r.pattern, r.appliesTo]),
      ...(ej.singleSource ?? []).flatMap((r) => [r.appliesTo, r.extract]),
      ...(ej.purityImportSyntax ?? []).map((t) => t.split("{mod}").join("x")),
      ej.forbiddenDeps?.matcher?.split("{pkg}").join("x"),
      ej.tests?.filePattern,
      ej.tests?.onlyPattern,
      ej.tracker?.issuePattern,
      ej.commitMsg?.codePattern,
      ...(ej.sdd?.routes ?? []).flatMap((r) => r.patterns ?? []),
    ].filter(Boolean);

    const problemas = [];
    for (const p of patrones) {
      try {
        new RegExp(p);
      } catch (e) {
        problemas.push(`regex \`${p}\`: ${e.message}`);
      }
    }
    const sinWhy = (ej.gate?.signals ?? []).filter((s) => !s.why).map((s) => s.name);
    if (sinWhy.length) problemas.push(`señal(es) sin \`why\`: ${sinWhy.join(", ")}`);
    if (!(ej.gate?.signals ?? []).length) problemas.push("`gate.signals` vacío: el ejemplo no muestra nada");

    // La misma divergencia, en un artefacto que alguien va a COPIAR: el único ejemplo .NET
    // declaraba `.csproj` en el gate y ninguna señal lo barría.
    const huerfanas = huerfanasDe(ej);
    if (huerfanas.length) {
      problemas.push(`\`${huerfanas.join(", ")}\` ensucian el gate y el barrido del lint no las lee (declaralas en \`lint.sourceExtensions\`)`);
    }

    const dep = ej.forbiddenDeps;
    if (dep?.manifest && (dep.packages ?? []).length && !dep.matcher && !esClaveValor(dep.manifest)) {
      problemas.push(`\`${dep.manifest}\` no es un manifiesto clave-valor y no declara \`matcher\`: DEPS saldría verde`);
    }

    return { problemas, regex: patrones.length };
  };

  // El freno prueba que muerde ANTES de usarse, y se afirma por TIPO de hallazgo: un contador
  // («al menos 3») pasa con tres de cuatro comprobaciones funcionando y no dice cuál se perdió.
  // `.razor` no está en el default agnóstico y es lo que declara cualquier repo ASP.NET: es el
  // cebo de la comprobación de extensiones huérfanas, que si no tendría tres consumidores y
  // ningún caso —el mismo patrón «arreglado sin freno» que este arnés vino a cerrar.
  {
    const cebo = validarEjemplo({
      gate: { codeExtensions: [".razor"], signals: [{ name: "tests", command: ["mvn", "test"] }] },
      patterns: [{ id: "ROTO", pattern: "[", appliesTo: "^src/" }],
      forbiddenDeps: { manifest: "pom.xml", packages: ["junit"] },
    });
    const dice = (fragmento) => cebo.problemas.some((p) => p.includes(fragmento));
    const esperados = [
      ["regex roto", "regex `["],
      ["señal sin `why`", "sin `why`"],
      ["manifiesto sin `matcher`", "matcher"],
      ["extensión que el lint no barre", ".razor"],
    ];
    for (const [nombre, fragmento] of esperados) {
      if (dice(fragmento)) ok(`la validación de ejemplos caza ${nombre}`);
      else bad(`la validación de ejemplos caza ${nombre}`, `el cebo no produjo ese hallazgo. Salió: ${cebo.problemas.join(" · ") || "(nada)"}`);
    }
  }

  /**
   * Lo anterior mide la FORMA de un ejemplo (parsea, sus regex compilan). Esto corre sus reglas
   * de verdad, con el config del ejemplo (`--config`) y la muestra por stdin: no se escribe nada
   * en el árbol de fuentes (P7) y no hace falta un repo de juguete por ejemplo.
   *
   * OJO con lo que esto NO prueba, porque es la trampa de la técnica: la muestra se deriva del
   * propio `matcher`, así que «la regla caza su muestra» es casi una tautología — no dice nada
   * sobre si el `matcher` describe el formato REAL de un `Gemfile` o de un `pom.xml`. Eso sólo
   * lo mide un archivo real del lenguaje, o sea el banco (`harness-bench.mjs`).
   *
   * Lo que sí cierra, y no estaba cubierto por nada:
   *   1. RUTEO — que la regla LLEGUE a correr. Un `manifest: "./package.json"` o un
   *      `purity.dir: "/src/lib"` parsean, compilan y no se aplican nunca: freno muerto con
   *      el JSON impecable.
   *   2. ANCHURA — que no muerda de más. Un `matcher` sin anclas o una plantilla de import
   *      floja marcan cualquier línea, y un freno que bloquea trabajo legítimo se desactiva
   *      a mano en una semana (P3).
   */
  const lintConEjemplo = (ej, rutaVirtual, contenido) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-ejemplo-"));
    try {
      const cfg = path.join(tmp, "config.json");
      fs.writeFileSync(cfg, JSON.stringify(ej));
      const res = spawnSync(
        "node",
        [abs("scripts/repo-lint.mjs"), "--config", cfg, "--file", rutaVirtual, "--stdin"],
        { input: contenido, cwd: REPO_ROOT, encoding: "utf8" },
      );
      return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };

  /**
   * La ruta con la que el archivo aparece DE VERDAD en un repo (como la lista `git ls-files`),
   * no como la escribió el ejemplo. Es lo que hace que el caso pruebe el ruteo en vez de
   * repetir el config: pasarle al lint la misma cadena que declaró el ejemplo la compara
   * consigo misma y sale verde aunque `./package.json` nunca vaya a coincidir con nada.
   */
  const rutaCanonica = (p) => p.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");

  /** Los cuatro casos derivables de un ejemplo sin conocer su repo ni su lenguaje. */
  const probarReglasDelEjemplo = (ej) => {
    const casos = [];
    const AJENO = "paquete-que-nadie-veto";

    const dep = ej.forbiddenDeps;
    const paquetes = dep?.packages ?? [];
    if (!dep?.manifest || !paquetes.length) {
      casos.push({ nombre: "DEPS llega a su manifiesto", omitido: "el ejemplo no veta dependencias" });
    } else {
      const plantilla = depsMatcher(dep.matcher);
      const muestra = sampleFromPattern(plantilla.split("{pkg}").join(escapeRegex(paquetes[0])));
      const inocente = sampleFromPattern(plantilla.split("{pkg}").join(AJENO));
      if (!muestra) {
        casos.push({ nombre: "DEPS llega a su manifiesto", omitido: `\`${plantilla}\` no es reducible a un manifiesto de ejemplo` });
      } else {
        const r = lintConEjemplo(ej, rutaCanonica(dep.manifest), `${muestra}\n`);
        casos.push({
          nombre: `DEPS llega a su manifiesto (${dep.manifest})`,
          ok: r.status !== 0 && r.out.includes("DEPS"),
          detalle: `el lint no marcó DEPS sobre \`${dep.manifest}\` con \`${muestra}\` adentro: la regla NO se está aplicando a esa ruta (¿un \`./\` de más, una barra inicial, un nombre que no es el del manifiesto?). Un freno que no llega a correr es un freno muerto. exit ${r.status}: ${r.out.trim().slice(0, 200) || "sin salida"}`,
        });
        if (inocente) {
          const r2 = lintConEjemplo(ej, rutaCanonica(dep.manifest), `${inocente}\n`);
          casos.push({
            nombre: "DEPS no muerde de más",
            ok: !r2.out.includes("DEPS"),
            detalle: `\`${inocente}\` no declara ninguna dependencia vetada y el lint la marcó: el freno bloquearía trabajo legítimo. ${r2.out.trim().slice(0, 200)}`,
          });
        }
      }
    }

    const capa = (ej.purity ?? []).find((c) => c.dir && (c.forbiddenImports ?? []).length);
    if (!capa) {
      casos.push({ nombre: "PUREZA llega a su capa", omitido: "el ejemplo no declara una capa pura con imports vetados" });
    } else {
      const sintaxis = importSyntax(capa.importSyntax ?? ej.purityImportSyntax);
      const mod = capa.forbiddenImports[0];
      const ext = codeExtensions(ej.gate?.codeExtensions)[0];
      const ruta = `${rutaCanonica(capa.dir)}/muestra${ext}`;
      let plantillaUsada = null;
      let muestra = null;
      for (const t of sintaxis) {
        const s = sampleFromPattern(t.split("{mod}").join(escapeRegex(mod)));
        if (s) {
          plantillaUsada = t;
          muestra = s;
          break;
        }
      }
      if (!muestra) {
        casos.push({ nombre: "PUREZA llega a su capa", omitido: "ninguna plantilla de import es reducible a un ejemplo" });
      } else {
        const r = lintConEjemplo(ej, ruta, `${muestra}\n`);
        casos.push({
          nombre: `PUREZA llega a su capa (${capa.dir})`,
          ok: r.status !== 0 && r.out.includes("PUREZA"),
          detalle: `el lint no marcó PUREZA sobre \`${ruta}\` con \`${muestra}\` adentro: la capa declarada no está casando su propia ruta (¿barra inicial, \`./\`, un directorio que no existe con ese nombre?). exit ${r.status}: ${r.out.trim().slice(0, 200) || "sin salida"}`,
        });
        const limpio = sampleFromPattern(plantillaUsada.split("{mod}").join("modulo-sin-veto"));
        if (limpio) {
          const r2 = lintConEjemplo(ej, ruta, `${limpio}\n`);
          casos.push({
            nombre: "PUREZA no muerde de más",
            ok: !r2.out.includes("PUREZA"),
            detalle: `\`${limpio}\` importa un módulo que la capa no prohíbe y el lint lo marcó igual. ${r2.out.trim().slice(0, 200)}`,
          });
        }
      }
    }

    return casos;
  };

  // El freno prueba que muerde ANTES de usarse, y por TIPO de falla: un contador («al menos 2»)
  // pasa con la mitad funcionando y no dice cuál se perdió. Los cuatro cebos son las cuatro
  // clases que esto puede cazar — dos de ruteo (la regla no llega a correr) y dos de anchura
  // (la regla marca cualquier cosa). El cebo también documenta el límite: un cebo cuyo `matcher`
  // simplemente «no case el formato real» NO existe acá, porque esa clase la mide el banco.
  {
    const casoDe = (ej, prefijo) => probarReglasDelEjemplo(ej).find((c) => c.nombre.startsWith(prefijo));
    const rojo = (caso) => Boolean(caso) && !caso.omitido && caso.ok === false;

    const capaOk = { dir: "capa", forbiddenImports: ["modulo-vetado"] };
    const depOk = { manifest: "manifiesto.txt", matcher: "^{pkg}$", packages: ["dep-vetada"] };

    const cebos = [
      [
        "un manifiesto que la regla nunca mira",
        casoDe({ forbiddenDeps: { ...depOk, manifest: "./manifiesto.txt" } }, "DEPS llega"),
      ],
      [
        "una capa cuya ruta no casa nunca",
        casoDe({ purity: [{ ...capaOk, dir: "/capa" }], purityImportSyntax: ["^usa {mod}$"] }, "PUREZA llega"),
      ],
      [
        "un matcher que marca cualquier línea",
        casoDe({ forbiddenDeps: { ...depOk, matcher: "." } }, "DEPS no muerde"),
      ],
      [
        "una sintaxis de import que marca cualquier línea",
        casoDe({ purity: [capaOk], purityImportSyntax: ["\\w+"] }, "PUREZA no muerde"),
      ],
    ];
    for (const [nombre, caso] of cebos) {
      if (rojo(caso)) ok(`la prueba de reglas caza ${nombre}`);
      else bad(`la prueba de reglas caza ${nombre}`, `el cebo no salió rojo: ${JSON.stringify(caso ?? null)}`);
    }
  }

  for (const archivo of archivos) {
    let ej;
    try {
      ej = JSON.parse(fs.readFileSync(abs(`${dirEjemplos}/${archivo}`), "utf8"));
    } catch (e) {
      bad(`ejemplo \`${archivo}\``, `no es JSON válido: ${e.message}`);
      continue;
    }
    const { problemas, regex } = validarEjemplo(ej);
    if (problemas.length) bad(`ejemplo \`${archivo}\``, problemas.join("\n      "));
    else ok(`ejemplo \`${archivo}\` (${regex} regex, ${(ej.gate?.signals ?? []).length} señales con why)`);

    for (const caso of probarReglasDelEjemplo(ej)) {
      if (caso.omitido) skip(`ejemplo \`${archivo}\` · ${caso.nombre}`, caso.omitido);
      else if (caso.ok) ok(`ejemplo \`${archivo}\` · ${caso.nombre}`);
      else bad(`ejemplo \`${archivo}\` · ${caso.nombre}`, caso.detalle);
    }
  }
}

// ── 9. El costo del arnés se mide (latencia de los hooks) ───────────────────
//    Clase de freno NUEVA: el self-test no la deriva sola del config, así que el caso se
//    escribe a mano (P2). Los cebos van por `--config` a un temporal FUERA del repo: medir
//    no puede escribir en el árbol de fuentes (P7).
section("9. costo del arnés (hooks-timing)");
{
  const script = abs("scripts/hooks-timing.mjs");
  if (!fs.existsSync(script)) {
    bad("scripts/hooks-timing.mjs", "no existe: el costo del arnés vuelve a ser una intuición");
  } else if (spawnSync("node", ["--check", script], { encoding: "utf8" }).status !== 0) {
    bad("scripts/hooks-timing.mjs", "no parsea: `node --check` falla");
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arnes-timing-"));
    const escribirCebo = (nombre, observability) => {
      const ruta = path.join(tmp, nombre);
      fs.writeFileSync(
        ruta,
        JSON.stringify(
          { gate: { marker: config.gate?.marker }, askFirst: { marker: config.askFirst?.marker }, observability },
          null,
          2,
        ),
      );
      return ruta;
    };
    const correr = (ruta) => spawnSync("node", [script, "--config", ruta], { cwd: REPO_ROOT, encoding: "utf8" });
    // El probe de los cebos NO puede salir sólo del config: un repo que todavía no lo declaró
    // (la plantilla viaja con él vacío a propósito) hacía que la medición saliera OMITIDA y los
    // tres casos de abajo midieran nada creyendo que medían. Lo cazó el banco en el repo del
    // quick start. Para el cebo alcanza CUALQUIER archivo que exista: lo que se prueba es el
    // veredicto contra el presupuesto, no el camino caro.
    const probe = config.observability?.probe?.filePath
      ? config.observability.probe
      : { filePath: [...hookFiles].map((f) => `.claude/hooks/${f}`).find((f) => fs.existsSync(abs(f))) ?? ".claude/hooks/harness.mjs" };

    // ¿MUERDE? Presupuesto imposible: ningún proceso de node arranca en 0 ms.
    const imposible = correr(escribirCebo("imposible.json", { budgetMs: 0, runs: 1, probe }));
    if (imposible.status === 1 && /LATENCIA EN ROJO/.test(imposible.stderr ?? ""))
      ok("presupuesto de latencia: un hook sobre presupuesto pone la señal en ROJO");
    else
      bad(
        "presupuesto de latencia muerde",
        `con budgetMs=0 esperaba exit 1 y «LATENCIA EN ROJO», dio exit ${imposible.status}`,
      );

    // ¿NO MUERDE DE MÁS? Con presupuesto holgado, el repo real pasa.
    const holgado = correr(escribirCebo("holgado.json", { budgetMs: 60000, runs: 1, probe }));
    if (holgado.status === 0 && /LATENCIA VERDE/.test(holgado.stdout ?? ""))
      ok("presupuesto de latencia: con presupuesto holgado el repo pasa (no muerde de más)");
    else
      bad(
        "presupuesto de latencia no muerde de más",
        `con budgetMs=60000 esperaba exit 0 y «LATENCIA VERDE», dio exit ${holgado.status}`,
      );

    // Un repo portado que NO declara la clave no puede ponerse rojo por una señal que no eligió.
    const sinClave = correr(escribirCebo("sin-clave.json", undefined));
    if (sinClave.status === 0)
      ok("sin presupuesto declarado, la medición deja pasar (el repo portado no se pone rojo solo)");
    else bad("sin presupuesto declarado la medición deja pasar", `esperaba exit 0 y dio ${sinClave.status}`);

    // Medir NO puede cambiar el estado de la sesión: los hooks que escriben marcadores
    // (el del gate, el de ask-first) se corren de verdad, y un marcador fabricado por la
    // medición bloquea el turno siguiente sin que nadie entienda por qué.
    const marcadores = [config.gate?.marker, config.askFirst?.marker].filter(Boolean).map(abs);
    const antes = marcadores.map((f) => fs.existsSync(f));
    correr(escribirCebo("estado.json", { budgetMs: 60000, runs: 1, probe }));
    const despues = marcadores.map((f) => fs.existsSync(f));
    if (JSON.stringify(antes) === JSON.stringify(despues))
      ok("medir no deja marcadores de sesión fabricados (el estado se restaura)");
    else bad("medir no cambia el estado de la sesión", `marcadores antes=${antes} después=${despues}`);

    // Un equipo que sólo quiere acotar el hook caro declara `budgets` y ningún `budgetMs`. Con el
    // 0 de default, TODOS los demás hooks salían rojos contra un presupuesto imposible: el freno
    // mordía trabajo legítimo (P3), que es como se desactivan los frenos que sí servían.
    const soloBudgets = correr(
      escribirCebo("solo-budgets.json", { runs: 1, budgets: { ".claude/hooks/post-edit-check.mjs": 60000 }, probe }),
    );
    if (soloBudgets.status === 0 && /OMITIDO: sin presupuesto declarado/.test(soloBudgets.stdout ?? ""))
      ok("con `budgets` y sin `budgetMs`, los hooks sin presupuesto propio salen OMITIDOS (no rojos)");
    else
      bad(
        "presupuesto ausente no es presupuesto 0",
        `esperaba exit 0 y hooks OMITIDOS, dio exit ${soloBudgets.status}`,
      );

    // Sin archivo de prueba declarado no hay medición honesta: el hook que corre el lint del
    // archivo tocado toma el atajo con cualquier archivo que no sea código y se mide el camino
    // barato. La plantilla viaja con esto VACÍO, así que este caso es el que la sostiene.
    const sinProbe = correr(escribirCebo("sin-probe.json", { budgetMs: 60000, runs: 1 }));
    if (sinProbe.status === 0 && /OMITIDA/.test(sinProbe.stdout ?? ""))
      ok("sin `probe.filePath`, la medición sale OMITIDA en vez de medir el camino barato");
    else bad("sin `probe.filePath` la medición se omite", `esperaba exit 0 y «OMITIDA», dio exit ${sinProbe.status}`);

    // Un hook que revienta al arrancar mide rapidísimo: sin esta comprobación, «barato» y «roto»
    // se ven igual y los dos en verde.
    {
      const hookRoto = path.join(tmp, "hook-roto.mjs");
      fs.writeFileSync(hookRoto, 'process.stderr.write("reventé\\n");\nprocess.exit(1);\n');
      const settingsCebo = path.join(tmp, "settings-roto.json");
      fs.writeFileSync(
        settingsCebo,
        JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: `node ${hookRoto}` }] }] } }),
      );
      const cfg = escribirCebo("hook-roto.json", { budgetMs: 60000, runs: 1, probe });
      const r = spawnSync("node", [script, "--config", cfg, "--settings", settingsCebo], { cwd: REPO_ROOT, encoding: "utf8" });
      if (r.status === 1 && /MEDICIÓN EN ROJO/.test(r.stderr ?? "")) ok("un hook que no respeta el contrato de exit codes pone la medición en ROJO (barato ≠ roto)");
      else bad("un hook roto no puede medir verde", `esperaba exit 1 y «MEDICIÓN EN ROJO», dio exit ${r.status}`);
    }

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // El incidente: el `probe` con un archivo cualquiera medía el camino BARATO de post-edit-check
  // (72 ms en vez de 144) y la señal salía verde midiendo lo que no cuesta. Quedó registrado en
  // prosa en tres lugares y en ninguno como mecanismo: el día que alguien cambie `probe.filePath`,
  // la señal se vuelve decorativa SIN ponerse roja, que es el peor modo de falla de este repo (P13).
  {
    const fp = config.observability?.probe?.filePath;
    const exts = codeExtensions(config.gate?.codeExtensions);
    const globs = config.gate?.codeGlobs ?? [];
    const bajoGlob = (p) => !globs.length || globs.some((g) => p === g || p.startsWith(g.endsWith("/") ? g : `${g}/`));
    if (!fp) {
      skip("el archivo de prueba de la medición es código", "este repo no declara `observability.probe.filePath`");
    } else if (!fs.existsSync(abs(fp))) {
      bad("el archivo de prueba de la medición existe", `\`${fp}\` no existe: se mide un archivo que no está`);
    } else if (!exts.some((e) => fp.toLowerCase().endsWith(e.toLowerCase()))) {
      bad("el archivo de prueba de la medición es código", `\`${fp}\`: su extensión no está en \`gate.codeExtensions\`, así que el hook que lintea toma el atajo y se mide el camino barato`);
    } else if (!bajoGlob(fp)) {
      bad("el archivo de prueba de la medición es código", `\`${fp}\` está fuera de \`gate.codeGlobs\`: el hook que lintea toma el atajo y se mide el camino barato`);
    } else {
      ok(`el archivo de prueba de la medición (\`${fp}\`) es código para este config: se mide el peor caso`);
    }
  }

  // La señal sólo vale si el gate la corre: un script de medición que nadie invoca es una
  // métrica que nadie mira. Es el mismo anti-patrón «instalado y muerto» del resto del arnés.
  const enGate = (config.gate?.signals ?? []).some((s) =>
    (s.command ?? []).some((a) => String(a).includes("hooks-timing")),
  );
  // Sólo se exige en un repo que DECLARÓ presupuesto: sin `observability`, el script es un
  // no-op y pedirle una señal del gate sería inventarle una regla al repo portado (P14).
  // Las claves `$…` de `budgets` son comentarios del config, no presupuestos: contarlas hacía
  // que un repo con sólo un `$comment` pareciera tener reglas declaradas.
  const presupuestosPropios = Object.keys(config.observability?.budgets ?? {}).filter((k) => !k.startsWith("$"));
  const declaraPresupuesto = config.observability?.budgetMs !== undefined || presupuestosPropios.length > 0;
  if (!declaraPresupuesto) skip("la medición de latencia es una señal del gate", "este repo no declara `observability`: el script no mide nada");
  else if (enGate) ok("la medición de latencia es una señal del gate (alguien la corre)");
  else bad("la medición de latencia está en el gate", "hay presupuesto declarado y ninguna señal lo corre: métrica que nadie mira");
}

section("10. controles fuera del gate (deriva y revisor)");

// 10a. La deriva. Un repo git temporal con un cebo propio: un STATUS viejo es rojo, uno de hoy
//      pasa, uno sin fecha es rojo, y de dos reglas de contenido sólo la que nunca casó en el
//      historial sale como aviso. Corre con `cwd` en el repo temporal: nada toca este árbol (P7).
{
  const script = abs("scripts/drift-check.mjs");
  if (!fs.existsSync(script)) {
    skip("deriva", "el repo no trae scripts/drift-check.mjs");
  } else {
    const hoy = new Date().toISOString().slice(0, 10);
    const correr = (status) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-deriva-"));
      try {
        const git = (...args) => spawnSync("git", args, { cwd: tmp, encoding: "utf8" });
        git("init", "-q");
        git("config", "user.email", "selftest@example.com");
        git("config", "user.name", "selftest");
        fs.mkdirSync(path.join(tmp, ".claude"));
        fs.writeFileSync(
          path.join(tmp, ".claude/harness.config.json"),
          JSON.stringify({
            status: { file: "STATUS.md" },
            patterns: [
              { id: "CON_CICATRIZ", pattern: "\\bcicatriz_real\\b", appliesTo: "^src/" },
              { id: "SIN_CICATRIZ", pattern: "\\bnunca_visto\\b", appliesTo: "^src/" },
              // Lo cazó el reviewer: una línea quitada `-- comentario` (SQL, Lua, Haskell) sale en
              // el diff como `--- comentario`, y el parser la tomaba por encabezado de archivo.
              { id: "CICATRIZ_SQL", pattern: "\\bcicatriz_sql\\b", appliesTo: "^src/" },
              // Sin `appliesTo` la regla aplica a todo, como en el lint: no puede desaparecer.
              { id: "SIN_AMBITO", pattern: "\\bcicatriz_global\\b" },
            ],
            drift: { statusDatePattern: "Fecha:\\s*(\\d{4}-\\d{2}-\\d{2})", statusMaxAgeDays: 14, historyCommits: 50 },
          }),
        );
        fs.mkdirSync(path.join(tmp, "src"));
        fs.writeFileSync(path.join(tmp, "src/a.mjs"), "const cicatriz_real = 1;\n");
        git("add", "src/a.mjs");
        git("commit", "-q", "-m", "incidente");
        fs.writeFileSync(path.join(tmp, "src/a.mjs"), "const arreglado = 1;\n");
        git("add", "src/a.mjs");
        git("commit", "-q", "-m", "arreglo");
        fs.writeFileSync(path.join(tmp, "src/q.sql"), "-- viejo\nselect 1;\n");
        fs.writeFileSync(path.join(tmp, "notas.txt"), "cicatriz_global\n");
        git("add", "src/q.sql", "notas.txt");
        git("commit", "-q", "-m", "sql");
        fs.writeFileSync(path.join(tmp, "src/q.sql"), "select cicatriz_sql;\n");
        git("add", "src/q.sql");
        git("commit", "-q", "-m", "sql 2");
        if (status !== null) fs.writeFileSync(path.join(tmp, "STATUS.md"), status);
        const r = spawnSync("node", [script], { cwd: tmp, encoding: "utf8" });
        return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    };
    const vieja = correr("# STATUS\nFecha: 2020-01-01\n");
    if (vieja.status === 1 && /DERIVA/.test(vieja.out)) ok("deriva: un STATUS con veredicto vencido es rojo");
    else bad("deriva: un STATUS vencido es rojo", `exit ${vieja.status}: ${vieja.out.trim().slice(0, 200)}`);

    const fresca = correr(`# STATUS\nFecha: ${hoy}\n`);
    if (fresca.status === 0) ok("deriva: un STATUS de hoy pasa");
    else bad("deriva: un STATUS de hoy pasa", `exit ${fresca.status}: ${fresca.out.trim().slice(0, 200)}`);

    const sinFecha = correr("# STATUS\nverde\n");
    if (sinFecha.status === 1) ok("deriva: un STATUS sin fecha es rojo (sin fecha, nadie sabe si sigue siendo cierto)");
    else bad("deriva: un STATUS sin fecha es rojo", `exit ${sinFecha.status}`);

    if (/SIN_CICATRIZ/.test(fresca.out) && !/CON_CICATRIZ|CICATRIZ_SQL|SIN_AMBITO/.test(fresca.out))
      ok("deriva: sólo la regla que nunca casó en el historial sale como aviso (y un `-- comentario` quitado no confunde al parser)");
    else bad("deriva: avisa la regla sin cicatriz y sólo ésa", fresca.out.trim().slice(0, 300));
  }
  if (config.drift) corredorDeclarado("el barrido de deriva", config.drift.runner, "scripts/drift-check.mjs");
}

// 10b. La prueba de vida del revisor, probada ella misma. No se puede llamar a un modelo
//      desde el self-test (caro, no determinista, sin red en CI), así que se prueba la
//      MÁQUINA del eval con revisores de mentira: uno que acierta pasa, uno que aprueba todo
//      queda bajo el umbral, y un comando que no existe sale OMITIDO — nunca verde.
{
  const script = abs("scripts/reviewer-eval.mjs");
  if (!fs.existsSync(script)) {
    skip("prueba de vida del revisor", "el repo no trae scripts/reviewer-eval.mjs");
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-revisor-"));
    try {
      fs.writeFileSync(path.join(tmp, "malo.diff"), "+  process.exit(1);\n");
      fs.writeFileSync(path.join(tmp, "bueno.diff"), "+  // un comentario\n");
      const atento = path.join(tmp, "atento.cjs");
      fs.writeFileSync(
        atento,
        'const t = require("fs").readFileSync(0, "utf8");\nconsole.log(t.includes("exit(1)") ? "VEREDICTO: rechazado — P5" : "VEREDICTO: aprobado");\n',
      );
      const complaciente = path.join(tmp, "complaciente.cjs");
      fs.writeFileSync(complaciente, 'require("fs").readFileSync(0, "utf8");\nconsole.log("VEREDICTO: aprobado");\n');
      // El incidente: un revisor que ejecuta cosas en el repo deja marcadores en la sesión del
      // humano. Este revisor de mentira sólo contesta si encuentra su contexto en el directorio
      // donde corre, y escribe algo ahí: el eval tiene que haberlo corrido en un árbol aparte,
      // con el contexto copiado, y nada de lo que escribió puede aparecer en este repo.
      fs.writeFileSync(path.join(tmp, "contexto.md"), "# la constitución de mentira\n");
      const toque = "toque-del-revisor";
      const aislado = path.join(tmp, "aislado.cjs");
      fs.writeFileSync(
        aislado,
        `const fs = require("fs");\nconst t = fs.readFileSync(0, "utf8");\nif (!fs.existsSync("contexto.md")) process.exit(0);\nfs.writeFileSync(${JSON.stringify(toque)}, "x");\n` +
          'console.log(t.includes("exit(1)") ? "VEREDICTO: rechazado — P5" : "VEREDICTO: aprobado");\n',
      );
      const cebo = (comando) => {
        const ruta = path.join(tmp, `config-${path.basename(comando[comando.length - 1])}.json`);
        fs.writeFileSync(
          ruta,
          JSON.stringify({
            reviewerEval: {
              context: ["contexto.md"],
              command: comando,
              minScore: 1,
              cases: [
                { name: "malo", diff: "malo.diff", expect: "rechazado", mustCite: "P5" },
                { name: "bueno", diff: "bueno.diff", expect: "aprobado" },
              ],
            },
          }),
        );
        const r = spawnSync("node", [script, "--config", ruta], { cwd: REPO_ROOT, encoding: "utf8" });
        return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
      };
      const bien = cebo(["node", atento]);
      if (bien.status === 0 && /REVISOR VERDE/.test(bien.out)) ok("revisor: uno que distingue el diff malo del inocente pasa el eval");
      else bad("revisor: el eval deja pasar a un revisor que acierta", `exit ${bien.status}: ${bien.out.trim().slice(0, 200)}`);

      const mal = cebo(["node", complaciente]);
      if (mal.status === 1 && /REVISOR EN ROJO/.test(mal.out)) ok("revisor: uno que aprueba todo queda bajo el umbral (rojo)");
      else bad("revisor: el eval caza a un revisor complaciente", `exit ${mal.status}: ${mal.out.trim().slice(0, 200)}`);

      const encerrado = cebo(["node", aislado]);
      const seFiltro = [REPO_ROOT, tmp].filter((d) => fs.existsSync(path.join(d, toque)));
      if (encerrado.status === 0 && !seFiltro.length)
        ok("revisor: corre en un árbol aparte con su contexto copiado, y lo que escribe no llega al repo (P7)");
      else bad("revisor: el eval aísla al revisor", `exit ${encerrado.status}; escribió en: ${seFiltro.join(", ") || "ningún lado"} · ${encerrado.out.trim().slice(0, 160)}`);
      for (const d of seFiltro) fs.rmSync(path.join(d, toque), { force: true });

      // Lo cazó el reviewer: una CLI que arranca pero falla (sin clave, sin cuota) no contestó
      // nada, y eso se contaba como un revisor que se equivoca. Roto no es lo mismo que malo.
      const roto = path.join(tmp, "roto.cjs");
      fs.writeFileSync(roto, 'require("fs").readFileSync(0, "utf8");\nprocess.stderr.write("401 sin clave\\n");\nprocess.exit(1);\n');
      const infra = cebo(["node", roto]);
      if (infra.status === 1 && /EVAL ROTO/.test(infra.out) && !/REVISOR EN ROJO/.test(infra.out))
        ok("revisor: una CLI que falla sin contestar es EVAL ROTO, no un revisor que se equivoca");
      else bad("revisor: el eval separa infraestructura de juicio", `exit ${infra.status}: ${infra.out.trim().slice(0, 200)}`);

      const ausente = cebo(["comando-que-no-existe-en-ninguna-maquina"]);
      if (ausente.status === 0 && /OMITIDA/.test(ausente.out)) ok("revisor: sin la CLI instalada el eval sale OMITIDO, no verde");
      else bad("revisor: sin CLI el eval se omite", `exit ${ausente.status}: ${ausente.out.trim().slice(0, 200)}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }

    // Los casos reales tienen que existir: un caso que apunta a la nada es un eval que nunca corre.
    for (const c of config.reviewerEval?.cases ?? []) {
      if (fs.existsSync(abs(c.diff))) ok(`revisor: el caso «${c.name}» existe`);
      else bad(`revisor: el caso «${c.name}» existe`, `\`${c.diff}\` no existe`);
    }
    if (config.reviewerEval) corredorDeclarado("la prueba de vida del revisor", config.reviewerEval.runner, "scripts/reviewer-eval.mjs");
  }
}

// 10c. El mapa del arnés. Con el config real: completo, y cada hook declarado aparece en él.
//      Con un cebo de settings que agrega un evento que la taxonomía no conoce: rojo, porque
//      un control que nadie ubicó en el mapa es uno del que nadie sabe qué cubre.
{
  const script = abs("scripts/harness-map.mjs");
  if (!fs.existsSync(script) || !config.taxonomy) {
    skip("mapa del arnés", "el repo no trae scripts/harness-map.mjs o no declara `taxonomy`");
  } else {
    const real = spawnSync("node", [script], { cwd: REPO_ROOT, encoding: "utf8" });
    const faltan = [...hookFiles].filter((h) => !(real.stdout ?? "").includes(h));
    if (real.status === 0 && !faltan.length) ok("mapa del arnés: completo, y cada hook de settings.json tiene dirección, tipo y etapa");
    else bad("mapa del arnés completo", `exit ${real.status}; sin ubicar: ${faltan.join(", ") || `${real.stderr}`.trim().slice(0, 200)}`);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-mapa-"));
    try {
      const evento = "EventoQueNadieClasifico";
      const cebo = path.join(tmp, "settings.json");
      const comandoCebo = { type: "command", command: "node .claude/hooks/cebo.mjs" }; // linkcheck:ignore — ruta ficticia del cebo
      fs.writeFileSync(cebo, JSON.stringify({ hooks: { ...settings.hooks, [evento]: [{ hooks: [comandoCebo] }] } }));
      const r = spawnSync("node", [script, "--settings", cebo], { cwd: REPO_ROOT, encoding: "utf8" });
      if (r.status === 1 && (r.stderr ?? "").includes(evento)) ok("mapa del arnés: un hook en un evento sin clasificar es rojo");
      else bad("mapa del arnés caza lo no clasificado", `exit ${r.status}: ${`${r.stdout}${r.stderr}`.trim().slice(0, 200)}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

// ── 11. El panel se genera, y sus alarmas dicen la verdad ───────────────────
//
// El panel no es un freno: es el sensor que se mira. Pero un sensor que no se genera, o que pinta
// verde sobre un arnés con piezas muertas, es peor que no tenerlo — se le cree. Todo corre en
// directorios temporales FUERA del repo (P7) y la memoria se prueba sin la capa en vivo.
section("11. el panel del arnés");
{
  const dirPanel = abs("scripts/panel");
  if (!fs.existsSync(path.join(dirPanel, "generar.mjs"))) {
    skip("panel", "el repo no trae scripts/panel/");
  } else {
    // 11a. Parsean. La sección 1b sólo mira el primer nivel de scripts/.
    let rotos = 0;
    const modulos = fs.readdirSync(dirPanel).filter((f) => f.endsWith(".mjs"));
    for (const f of modulos) {
      const r = spawnSync("node", ["--check", path.join(dirPanel, f)], { encoding: "utf8" });
      if (r.status !== 0) {
        rotos += 1;
        bad(`scripts/panel/${f}`, r.stderr.trim().split("\n").slice(0, 3).join(" · "));
      }
    }
    if (!rotos) ok(`${modulos.length} módulo(s) del panel parsean`);

    const url = (f) => pathToFileURL(path.join(dirPanel, f)).href;
    const { generarPanel, resolverSalida } = await import(url("generar.mjs"));
    const { construirModelo, leerCitas } = await import(url("leer-fuentes.mjs"));
    const { construirArnes } = await import(url("leer-arnes.mjs"));
    const { leerGestor } = await import(url("leer-en-vivo.mjs"));
    const temporal = (prefijo) => fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
    const escribir = (raiz, rel, texto) => {
      fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true });
      fs.writeFileSync(path.join(raiz, rel), texto);
    };

    // 11b. La memoria es determinista: dos corridas sin la capa en vivo, los mismos bytes. Es lo
    //      que hace que la versión del panel identifique lo que se está mirando.
    const t1 = temporal("harness-panel-a-");
    const t2 = temporal("harness-panel-b-");
    try {
      const uno = await generarPanel(REPO_ROOT, { salida: t1, enVivo: false, config, settings });
      await generarPanel(REPO_ROOT, { salida: t2, enVivo: false, config, settings });
      const a = fs.readFileSync(path.join(t1, "index.html"), "utf8");
      const b = fs.readFileSync(path.join(t2, "index.html"), "utf8");
      if (a === b && a.includes("Panel del arnés") && fs.existsSync(path.join(t1, "modelo.json"))) ok(`panel: la memoria sale byte a byte igual en dos corridas (versión ${uno.modelo.version})`);
      else bad("panel determinista", a === b ? "falta index.html o modelo.json" : "dos corridas sin capa en vivo dieron HTML distinto: algo con reloj se coló en la memoria");

      // 11b-bis. `--verificar` es el modo señal: arma y renderiza sin escribir nada. Como señal
      //      del gate no puede pisar el panel que el gate regenera al final (lo destapó el
      //      portado: durante la corrida el panel quedaba en «sólo memoria»).
      const t3 = temporal("harness-panel-verificar-");
      try {
        const v = await generarPanel(REPO_ROOT, { salida: t3, enVivo: false, config, settings, escribir: false });
        if (!fs.readdirSync(t3).length && v.bytes > 1000) ok("panel: --verificar renderiza la página y no escribe nada");
        else bad("panel --verificar no escribe", `escribió ${fs.readdirSync(t3).join(", ")} · ${v.bytes} bytes`);
      } finally {
        fs.rmSync(t3, { recursive: true, force: true });
      }

      // 11c. P3: sobre el repo real no muerde de más. Una alarma acá es un falso rojo que enseña a
      //      no mirar el panel — o un freno de verdad muerto, y entonces hay que arreglarlo.
      const alarmas = [...uno.modelo.arnes.alarmas.map((x) => x.que), ...uno.modelo.advertencias.map((x) => x.que)];
      if (!alarmas.length) ok("panel: el arnés de este repo sale sin alarmas");
      else bad("panel sin alarmas sobre el repo real", alarmas.slice(0, 3).join(" · "));
    } catch (e) {
      bad("panel genera sobre este repo", e.message);
    } finally {
      fs.rmSync(t1, { recursive: true, force: true });
      fs.rmSync(t2, { recursive: true, force: true });
    }

    // 11d. P2: las advertencias de la memoria muerden. Un incidente sin mecanismo, un mecanismo que
    //      apunta a la nada y un principio BLOCKING sin comando tienen que salir con nombre.
    const cebo = temporal("harness-panel-cebo-");
    try {
      escribir(cebo, "STATUS.md", "# STATUS\n\n- **Veredicto:** ROJO\n");
      escribir(cebo, "docs/gotchas.md", "### GOTCHA: sin mecanismo\n\nSíntoma: a\nCausa: b\nRegla: c\n\n### GOTCHA: puntero muerto\n\nSíntoma: a\nCausa: b\nRegla: c\nMecanismo: `scripts/nada.mjs`\n"); // linkcheck:ignore — cebo
      escribir(cebo, "CONSTITUTION.md", "# C\n\n## P1 — Algo · BLOCKING\n\nSin mecanismo.\n");
      const cfgCebo = { status: { file: "STATUS.md" }, incidents: { file: "docs/gotchas.md", requiredLines: ["Síntoma:", "Causa:", "Regla:", "Mecanismo:"] }, docs: { proseRoots: ["docs", "scripts"] } };
      const m = construirModelo(cebo, { config: cfgCebo, settings: {} });
      const todo = m.advertencias.map((x) => x.que).join("\n");
      const esperadas = [
        ["un incidente sin Mecanismo", /gotcha 1 .*sin Mecanismo/],
        ["un mecanismo que apunta a la nada", /scripts\/nada\.mjs/],
        ["un principio BLOCKING sin mecanismo", /P1 .*BLOCKING/],
      ];
      const faltan = esperadas.filter(([, re]) => !re.test(todo)).map(([n]) => n);
      // La guía ausente se dice en «Fuentes», no como alarma: ningún comando la pone en rojo.
      if (!m.faltantes.includes("CLAUDE.md") || /CLAUDE\.md/.test(todo)) faltan.push("la guía ausente como faltante y no como alarma");
      if (!faltan.length && m.estado.veredicto?.tono === "rojo") ok(`panel: la memoria avisa ${esperadas.map(([n]) => n).join(", ")}`);
      else bad("panel: advertencias de la memoria", `no avisó: ${faltan.join(", ") || "el veredicto ROJO"} · dijo: ${todo.slice(0, 200)}`);

      // 11e. P2: las alarmas de la salud muerden. Cada una es la versión visible de algo que ya
      //      pone rojo a otro comando; si el panel no la ve, pinta verde un arnés muerto.
      escribir(cebo, "scripts/freno.mjs", "export {};\n"); // linkcheck:ignore — cebo
      const salud = construirArnes(cebo, {
        config: {
          install: { activators: { "scripts/freno.mjs": "claveQueNoEsta" } }, // linkcheck:ignore — cebo
          drift: { runner: ".github/workflows/nadie.yml" }, // linkcheck:ignore — cebo
          reviewerEval: { command: ["revisor"] },
          gate: { signals: [{ name: "sin porqué", command: ["node", "-v"] }] },
        },
        settings: { hooks: { Stop: [{ hooks: [{ type: "command", command: "node .claude/hooks/no-existe.mjs" }] }] } }, // linkcheck:ignore — cebo
      });
      const dicho = salud.alarmas.map((x) => x.que).join("\n");
      const muerden = [
        ["un freno instalado sin su clave", /instalado y .*claveQueNoEsta|claveQueNoEsta/],
        ["un hook declarado que no existe", /no-existe\.mjs/],
        ["un control fuera del gate sin runner", /nadie\.yml/],
        ["una señal sin why", /sin porqué/],
        ["un control encendido sin runner", /reviewerEval.* no declara .runner/],
      ];
      const mudas = muerden.filter(([, re]) => !re.test(dicho)).map(([n]) => n);
      if (!mudas.length) ok(`panel: la salud alarma ${muerden.map(([n]) => n).join(", ")}`);
      else bad("panel: alarmas de la salud", `no alarmó: ${mudas.join(", ")}`);
    } catch (e) {
      bad("panel: cebos", e.message);
    } finally {
      fs.rmSync(cebo, { recursive: true, force: true });
    }

    // 11d-bis. Un config de OTRA versión del arnés no tumba el panel. Lo destapó el portado a un
    //      repo real: su `purity` era un objeto (formato viejo) y el panel reventaba en vez de
    //      leerlo como la única regla que es. Formas inesperadas se toleran; una regla, se lee.
    {
      const viejo = temporal("harness-panel-viejo-");
      try {
        const cfgViejo = {
          purity: { dir: "src/lib", forbiddenImports: ["react"], except: ["src/lib/x.ts"] }, // linkcheck:ignore — cebo
          reuse: { pattern: "fetch\\(", see: "src/api.ts" }, // linkcheck:ignore — cebo
          gate: { signals: "no-es-una-lista" },
          install: { activators: ["no-es-un-mapa"] },
          observability: { budgets: null },
        };
        const m = construirModelo(viejo, { config: cfgViejo, settings: { hooks: { Stop: "tampoco" } } });
        if (m.reglas.frenos.purity.length === 1 && m.reglas.frenos.reuse.length === 1 && m.arnes) ok("panel: un config de otra versión (reglas sueltas en vez de listas) se lee sin reventar");
        else bad("panel tolera un config de otra versión", `purity ${m.reglas.frenos.purity.length} · reuse ${m.reglas.frenos.reuse.length}`);
      } catch (e) {
        bad("panel tolera un config de otra versión", e.message);
      } finally {
        fs.rmSync(viejo, { recursive: true, force: true });
      }
    }

    // 11e-bis. Los defaults de STATUS son los de la plantilla que el instalador deja: copiados a
    //      mano en el código, se desincronizan en silencio el día que cambie un título.
    {
      const plantilla = abs("plantillas/STATUS.md");
      if (!fs.existsSync(plantilla)) skip("panel lee la plantilla de STATUS", "no hay plantillas/STATUS.md");
      else {
        const { leerStatus } = await import(url("leer-fuentes.mjs"));
        const e = leerStatus(fs.readFileSync(plantilla, "utf8"));
        if (e.veredicto && e.fechaGate && e.senales.length) ok("panel: con sus defaults lee la plantilla de STATUS (veredicto, fecha y tabla de señales)");
        else bad("panel lee la plantilla de STATUS", `veredicto ${Boolean(e.veredicto)} · fecha ${e.fechaGate} · señales ${e.senales.length}: los defaults de \`panel.status\` no casan con plantillas/STATUS.md`);
      }
    }

    // 11f. «Siempre se genera»: el gate regenera el panel y escribe su registro en CADA corrida,
    //      también la roja — que es cuando más sirve mirarlo. Un repo git temporal con una señal
    //      verde y una roja, y el gate y el panel copiados tal cual.
    const repo = temporal("harness-panel-gate-");
    try {
      for (const rel of ["scripts/gate.mjs", ".claude/hooks/harness.mjs", "scripts/harness-map.mjs", ...modulos.map((f) => `scripts/panel/${f}`)]) {
        escribir(repo, rel, fs.readFileSync(abs(rel), "utf8"));
      }
      escribir(
        repo,
        ".claude/harness.config.json",
        JSON.stringify({
          gate: {
            signals: [
              { name: "pasa", command: ["node", "-e", "process.exit(0)"], why: "cebo" },
              { name: "falla", command: ["node", "-e", "process.exit(3)"], why: "cebo" },
            ],
          },
          panel: { tokens: false },
        }),
      );
      spawnSync("git", ["init", "-q"], { cwd: repo });
      const r = spawnSync("node", ["scripts/gate.mjs"], { cwd: repo, encoding: "utf8" });
      let registro = null;
      try {
        registro = JSON.parse(fs.readFileSync(path.join(repo, ".git/harness-gate.json"), "utf8"));
      } catch {
        registro = null;
      }
      const html = path.join(repo, ".git/harness-panel/index.html");
      const bien = r.status === 1 && registro?.veredicto === "rojo" && registro.senales?.pasa?.estado === "verde" && registro.senales?.falla?.estado === "rojo" && fs.existsSync(html);
      if (bien) ok("panel: el gate rojo igual escribe su registro por señal y regenera el panel");
      else bad("panel: el gate lo regenera siempre", `exit ${r.status}; registro ${JSON.stringify(registro?.senales ?? null).slice(0, 160)}; panel ${fs.existsSync(html) ? "sí" : "no"} · ${`${r.stdout}`.trim().split("\n").slice(-3).join(" · ")}`);

      // 11f-bis. P5: el panel NO puede decidir el veredicto. Lo cazó el reviewer: con el panel en el
      //      mismo proceso, un `process.exit(0)` adentro volvía VERDE a un gate rojo —y borraba el
      //      marcador—; y un panel colgado colgaba al gate. Dos sabotajes, el mismo gate rojo.
      const marcador = path.join(repo, ".git/gate-dirty");
      const cfgSabotaje = JSON.parse(fs.readFileSync(path.join(repo, ".claude/harness.config.json"), "utf8"));
      cfgSabotaje.gate.marker = ".git/gate-dirty";
      cfgSabotaje.panel.timeoutMs = 1500;
      escribir(repo, ".claude/harness.config.json", JSON.stringify(cfgSabotaje));
      const sabotajes = [
        ["un panel que sale con exit 0", "scripts/panel/plantilla.mjs", "export const renderizarHtml = () => ''; process.exit(0);\n"],
        // Se cuelga DE VERDAD: exporta lo que el gate espera y nunca termina. Sin exports, el
        // import fallaría y el caso pasaría por el motivo equivocado.
        ["un panel colgado", "scripts/panel/generar.mjs", "export const resumen = () => ({ lineas: [] });\nexport async function generarPanel() { setInterval(() => {}, 1000); return new Promise(() => {}); }\nif (process.argv[1]?.endsWith('generar.mjs')) await generarPanel();\n"],
      ];
      for (const [nombre, rel, codigo] of sabotajes) {
        escribir(repo, rel, codigo);
        fs.writeFileSync(marcador, "sucio");
        const t0 = Date.now();
        const s = spawnSync("node", ["scripts/gate.mjs"], { cwd: repo, encoding: "utf8", timeout: 30000 });
        const ms = Date.now() - t0;
        if (s.status === 1 && fs.existsSync(marcador) && ms < 20000) ok(`panel: ${nombre} no cambia el veredicto de un gate rojo (exit 1, marcador intacto, ${ms} ms)`);
        else bad(`panel: ${nombre} no decide el gate`, `exit ${s.status}${s.error ? ` (${s.error.code})` : ""}; marcador ${fs.existsSync(marcador) ? "intacto" : "BORRADO"}; ${ms} ms`);
        escribir(repo, rel, fs.readFileSync(abs(rel), "utf8"));
      }
    } catch (e) {
      bad("panel: el gate lo regenera siempre", e.message);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }

    // 11g. En un worktree `.git` es un archivo: el destino por defecto se resuelve a su gitdir, o
    //      el panel desaparece justo donde trabajan los agentes en paralelo.
    const wt = temporal("harness-panel-wt-");
    try {
      fs.writeFileSync(path.join(wt, ".git"), "gitdir: ../gitdir-real\n");
      const destino = resolverSalida(wt, ".git/harness-panel");
      if (destino === path.join(path.resolve(wt, "../gitdir-real"), "harness-panel")) ok("panel: en un worktree escribe en el gitdir real");
      else bad("panel en worktree", `resolvió ${destino}`);
    } finally {
      fs.rmSync(wt, { recursive: true, force: true });
    }

    // 11i. El burn-down sale de los DATOS y de nada más. Un repo git temporal con commits de fecha
    //      fija: la serie tiene que ser exacta, un merge no puede contar dos veces lo que trae, lo
    //      tildado sin commitear se ve aparte, y dos corridas dan la misma versión (sin reloj).
    //      Sin fuente del plan: OMITIDO con motivo, nunca «0 %».
    {
      const { serieDesdeEventos } = await import(url("leer-plan.mjs"));
      const planRepo = temporal("harness-panel-plan-");
      try {
        const git = (args, fecha) =>
          spawnSync("git", args, { cwd: planRepo, encoding: "utf8", env: { ...process.env, ...(fecha ? { GIT_AUTHOR_DATE: `${fecha}T12:00:00Z`, GIT_COMMITTER_DATE: `${fecha}T12:00:00Z` } : {}) } });
        const tareas = "specs/001-x/tasks.md"; // linkcheck:ignore — archivo del repo temporal
        const commit = (contenido, fecha) => {
          escribir(planRepo, tareas, contenido);
          git(["add", tareas]);
          git(["commit", "-q", "-m", fecha], fecha);
        };
        git(["init", "-q", "-b", "main"]);
        git(["config", "user.email", "selftest@example.com"]);
        git(["config", "user.name", "selftest"]);
        commit("- [ ] a\n- [ ] b\n- [ ] c\n", "2026-09-01");
        commit("- [x] a\n- [ ] b\n- [ ] c\n- [ ] d\n", "2026-09-03");
        git(["checkout", "-q", "-b", "feat/e"]);
        commit("- [x] a\n- [ ] b\n- [ ] c\n- [ ] d\n- [ ] e\n", "2026-09-04");
        git(["checkout", "-q", "main"]);
        git(["merge", "-q", "--no-ff", "-m", "merge", "feat/e"], "2026-09-05");
        escribir(planRepo, tareas, "- [x] a\n- [x] b\n- [ ] c\n- [ ] d\n- [ ] e\n");
        const cfgPlan = { tracker: { artifactsIn: "repo" }, workflow: { baseBranch: "main" } };
        const uno = construirModelo(planRepo, { config: cfgPlan, settings: {} });
        const dos = construirModelo(planRepo, { config: cfgPlan, settings: {} });
        const serie = uno.plan.serie.map((q) => `${q.fecha ?? "árbol"}:${q.hechas}/${q.total}`).join(" ");
        const esperada = "2026-09-01:0/3 2026-09-03:1/4 2026-09-05:1/5 árbol:2/5";
        if (serie === esperada && uno.version === dos.version && uno.plan.resumen.alcanceInicial === 3) ok("panel: el burn-down del repo sale exacto de la historia (merge sin doble conteo, lo no commiteado aparte, sin reloj)");
        else bad("panel: burn-down del repo", `serie «${serie}», esperaba «${esperada}»; versiones ${uno.version} / ${dos.version}`);
      } catch (e) {
        bad("panel: burn-down del repo", e.message);
      } finally {
        fs.rmSync(planRepo, { recursive: true, force: true });
      }

      const { serie: ev, sinFecha } = serieDesdeEventos([
        { createdAt: "2026-09-01T10:00:00Z", closedAt: "2026-09-04T09:00:00Z" },
        { createdAt: "2026-09-01", closedAt: null },
        { createdAt: "2026-09-02" },
        { title: "sin fecha" },
        { createdAt: "2026-09-01", inPlan: false },
      ]);
      const serieEv = ev.map((q) => `${q.fecha}:${q.hechas}/${q.total}`).join(" ");
      if (serieEv === "2026-09-01:0/2 2026-09-02:0/3 2026-09-04:1/3" && sinFecha === 1) ok("panel: el burn-down del gestor sale de createdAt/closedAt, lo que no trae fecha no se inventa y lo citado fuera del plan no es alcance");
      else bad("panel: burn-down del gestor", `serie «${serieEv}» · sin fecha ${sinFecha}`);

      const vacio = temporal("harness-panel-sinplan-");
      try {
        const sinComando = construirModelo(vacio, { config: { tracker: { artifactsIn: "tracker" } }, settings: {} }).plan;
        const sinFuente = construirModelo(vacio, { config: {}, settings: {} }).plan;
        if (sinComando.estado === "omitido" && !sinComando.resumen && /panel\.tracker\.command/.test(sinComando.motivo) && sinFuente.estado === "omitido" && /artifactsIn/.test(sinFuente.motivo)) ok("panel: sin fuente del plan el burn-down sale OMITIDO con su motivo, nunca 0 %");
        else bad("panel: plan omitido", `${JSON.stringify(sinComando).slice(0, 120)} · ${JSON.stringify(sinFuente).slice(0, 120)}`);
      } finally {
        fs.rmSync(vacio, { recursive: true, force: true });
      }
    }

    // 11h. El contrato con el gestor, sin ninguna forja: las citas salen de `tracker.issuePattern`
    //      y un comando que falla es «sin dato» con su error, nunca una lista vacía.
    const patron = config.tracker?.issuePattern ?? "(^|[^A-Za-z0-9_])#[0-9]+";
    const citas = leerCitas({ "STATUS.md": "bloqueado por #12 y por #7\n```\n#99 en código no cuenta\n```\n" }, [patron]);
    const spec = { command: ["gestor"], timeoutMs: 1000, closedStates: ["closed"] };
    const leido = leerGestor(REPO_ROOT, spec, ["#7"], () => ({ status: 0, stdout: JSON.stringify({ items: [{ id: "#7", title: "x", state: "closed" }] }), stderr: "" }));
    const caido = leerGestor(REPO_ROOT, spec, [], () => ({ status: 1, stdout: "", stderr: "sin credenciales" }));
    if (citas.map((c) => c.id).join(",") === "#7,#12" && leido.ok && leido.items[0].cerrado && !caido.ok && /sin credenciales/.test(caido.error)) ok("panel: las citas salen del patrón del gestor y un gestor caído es «sin dato» con su error");
    else bad("panel: contrato con el gestor", `citas ${citas.map((c) => c.id).join(",")} · leído ${JSON.stringify(leido).slice(0, 120)} · caído ${JSON.stringify(caido).slice(0, 120)}`);
  }
}

// ── Veredicto ────────────────────────────────────────────────────────────────
console.log("");
if (failures) {
  console.error(`SELF-TEST ROJO — ${failures} freno(s) del arnés no hacen lo que dicen hacer.`);
  process.exit(1);
}
console.log("SELF-TEST VERDE — cada regla del config tiene un comando que falla si se la viola.");
