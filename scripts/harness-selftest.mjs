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
 *      de ejemplo que se publican para copiar parsean y compilan.
 *
 * Agnóstico: no conoce ningún stack. Todo lo que prueba lo deduce del config.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// El mismo helper que usan el hook y el lint: comparar contra la lista DECLARADA dejaba pasar
// justo el caso del incidente (el gate declara una extensión que el default agnóstico no tiene).
import { codeExtensions, importSyntax } from "../.claude/hooks/harness.mjs";

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

const hookFiles = new Set();

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
  return s;
}

/**
 * Qué ejecuta un hook declarado en settings.json.
 *
 * NO todo hook es `node <archivo>`: un repo real declara binarios externos y usa
 * `$CLAUDE_PROJECT_DIR` con comillas, como recomienda la documentación de Claude Code.
 * Asumir `node <archivo>` daba falso rojo sobre hooks que existían y funcionaban — y un
 * falso rojo enseña a ignorar la sección entera.
 */
function analizarComando(comando) {
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

/** ¿El ejecutable existe? Por ruta, o buscándolo en PATH si es un nombre suelto. */
function existeEjecutable(cmd) {
  if (cmd.includes("/")) return fs.existsSync(cmd) || fs.existsSync(abs(cmd));
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return dirs.some((d) => {
    try {
      return fs.statSync(path.join(d, cmd)).isFile();
    } catch {
      return false;
    }
  });
}

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
    ["node .claude/hooks/x.mjs", "script", ".claude/hooks/x.mjs"], // linkcheck:ignora (ficticio)
    ['node "$CLAUDE_PROJECT_DIR/scripts/ado.mjs" hook edit', "script", "scripts/ado.mjs"], // linkcheck:ignora
    ["node --experimental-strip-types scripts/x.ts", "script", "scripts/x.ts"], // linkcheck:ignora
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
if ((config.branches?.protected ?? []).length && fs.existsSync(abs(".githooks/pre-push"))) {
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
  } else {
    const rutaCodigo = sampleFromPattern(cm.codePattern);
    const refIssue = sampleFromPattern(tr.issuePattern);
    const fuga = cm.escapeLine ?? "sin-issue:";
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
      // linkcheck:ignora — las rutas son el CEBO: tienen que no existir para que el caso sirva.
      fs.writeFileSync(cebo, "Ver [esto](../docs/no-existe-en-ningun-lado.md) y `docs/tampoco/`.\n"); // linkcheck:ignora
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
  const literal = (regla.literals ?? [])[0];
  const ruta = sampleFromPattern(regla.appliesTo);
  if (!literal || !ruta) {
    skip(`lint ${regla.id ?? "FUENTEUNICA"}`, "sin literal declarado o patrón no reducible");
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

      const fantasma = conDir("plantillas/perfiles-que-no-existen"); // linkcheck:ignora — es el CEBO: tiene que NO existir
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
{
  const gateSh = abs("scripts/gate.sh");
  if (!fs.existsSync(gateSh)) bad("scripts/gate.sh", "no existe: no hay gate");
  else if (!(fs.statSync(gateSh).mode & 0o111)) bad("scripts/gate.sh", "no es ejecutable (`chmod +x scripts/gate.sh`)");
  else ok("scripts/gate.sh es ejecutable");
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
        const seco = spawnSync("node", [init, tmp, "--perfil", perfil], { encoding: "utf8" });
        const escribio = fs.existsSync(path.join(tmp, ".claude"));
        if (seco.status !== 0 || escribio) {
          bad(`perfil \`${perfil}\` en dry-run`, escribio ? "el dry-run ESCRIBIÓ en el destino" : (seco.stderr || seco.stdout).trim().slice(0, 160));
          continue;
        }

        const res = spawnSync("node", [init, tmp, "--perfil", perfil, "--apply"], { encoding: "utf8" });
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
  }
}

// ── Veredicto ────────────────────────────────────────────────────────────────
console.log("");
if (failures) {
  console.error(`SELF-TEST ROJO — ${failures} freno(s) del arnés no hacen lo que dicen hacer.`);
  process.exit(1);
}
console.log("SELF-TEST VERDE — cada regla del config tiene un comando que falla si se la viola.");
