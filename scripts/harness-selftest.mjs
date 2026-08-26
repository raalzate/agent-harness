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
 *   7. el kit SDD declarado está instalado (en CI se reporta OMITIDO, nunca «pasó»).
 *
 * Agnóstico: no conoce ningún stack. Todo lo que prueba lo deduce del config.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

// 4b. PUREZA: un import prohibido en la capa pura es rojo.
for (const capa of config.purity ?? []) {
  const mod = (capa.forbiddenImports ?? [])[0];
  if (!capa.dir || !mod) continue;
  const archivo = `${capa.dir.replace(/\/$/, "")}/ejemplo-selftest.mjs`;
  const r = lint(archivo, `import x from "${mod}";\n`);
  if (r.status !== 0 && r.out.includes("PUREZA")) ok(`lint PUREZA protege \`${capa.dir}\` de \`${mod}\``);
  else bad(`lint PUREZA protege \`${capa.dir}\``, `exit ${r.status}: ${r.out.trim() || "sin salida"}`);
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

// 4f. El arnés no escribe temporales dentro del árbol de fuentes.
{
  const antes = fs.readdirSync(REPO_ROOT);
  const sospechosos = antes.filter((f) => /selftest|tmp-|\.tmp$/.test(f));
  if (!sospechosos.length) ok("el self-test no dejó archivos temporales en el repo");
  else bad("el self-test no dejó temporales", `sobraron: ${sospechosos.join(", ")}`);
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

// ── Veredicto ────────────────────────────────────────────────────────────────
console.log("");
if (failures) {
  console.error(`SELF-TEST ROJO — ${failures} freno(s) del arnés no hacen lo que dicen hacer.`);
  process.exit(1);
}
console.log("SELF-TEST VERDE — cada regla del config tiene un comando que falla si se la viola.");
