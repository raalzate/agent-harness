#!/usr/bin/env node
/**
 * Instalador del arnés en OTRO repositorio.
 *
 *   node scripts/harness-init.mjs <ruta-del-repo>                     # dry-run: muestra qué haría
 *   node scripts/harness-init.mjs <ruta-del-repo> --apply             # copia de verdad
 *   node scripts/harness-init.mjs <ruta-del-repo> --perfil dotnet     # perfil de stack explícito
 *   node scripts/harness-init.mjs <ruta-del-repo> --perfil node,dotnet  # monorepo
 *
 * Copia lo genérico (hooks, scripts, subagentes, comandos, hooks de git, plantillas) y deja
 * un `harness.config.json` DE ARRANQUE, con las señales del gate vacías a propósito: nadie
 * más que el equipo del repo destino sabe cuáles son sus señales reales, y un gate que
 * verifica lo que no corresponde es peor que no tener gate.
 *
 * El PERFIL DE STACK (`plantillas/perfiles/`) rellena lo que sí es deducible del lenguaje:
 * qué extensión es código, cómo se escribe un import, dónde vive el manifiesto de
 * dependencias, qué directorios son derivados. Nunca reglas: eso lo frena la regla PERFIL
 * del lint. Las señales del gate siguen vacías — el perfil sólo deja CANDIDATAS comentadas
 * en `gate.$signalHints`, que el equipo confirma leyendo su CI.
 *
 * Nunca sobreescribe: lo que ya existe se reporta como conservado. Dry-run por defecto —
 * la regla del arnés es mostrar la lista antes de escribir en lote.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORIGEN = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PERFILES_DIR = path.join(ORIGEN, "plantillas/perfiles");
const argv = process.argv.slice(2);
const APLICAR = argv.includes("--apply");

/**
 * `--perfil x,y` o `--perfil=x,y`. Vacío = se intenta detectar.
 *
 * Devuelve también qué índices consume, porque el destino se elige por descarte: sin eso,
 * `--perfil dotnet /ruta` tomaba `dotnet` como DESTINO. Con `--apply` y un directorio
 * llamado `node/` o `go/` en el cwd, eso escribe 32 archivos donde nadie los pidió (P9).
 */
const { perfilArg, consumidos } = (() => {
  const i = argv.findIndex((a) => a === "--perfil" || a.startsWith("--perfil="));
  if (i === -1) return { perfilArg: null, consumidos: new Set() };
  if (argv[i].includes("=")) {
    return { perfilArg: argv[i].split("=").slice(1).join("="), consumidos: new Set([i]) };
  }
  const valor = argv[i + 1];
  const tieneValor = valor && !valor.startsWith("--");
  return { perfilArg: tieneValor ? valor : "", consumidos: new Set(tieneValor ? [i, i + 1] : [i]) };
})();

const destinoArg = argv.find((a, i) => !a.startsWith("--") && !consumidos.has(i)) ?? null;

if (!destinoArg) {
  console.error("uso: node scripts/harness-init.mjs <ruta-del-repo> [--perfil <stack[,stack]>] [--apply]");
  console.error(`perfiles disponibles: ${perfilesDisponibles().join(", ") || "(ninguno)"}`);
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

// ── Perfiles de stack ────────────────────────────────────────────────────────

function perfilesDisponibles() {
  try {
    // El directorio se resuelve acá y no en un `const` de arriba: el mensaje de uso llama a
    // esta función ANTES de que ese const exista, y el ReferenceError salía como «(ninguno)».
    return fs.readdirSync(PERFILES_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

const leerPerfil = (nombre) => JSON.parse(fs.readFileSync(path.join(PERFILES_DIR, `${nombre}.json`), "utf8"));

/** Un glob de `$detect` como regex de nombre de archivo (sólo `*`: no hace falta más). */
const globAName = (glob) =>
  new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").split("*").join(".*")}$`, "i");

/**
 * Nombres de archivo del repo destino, hasta 3 niveles.
 *
 * Poco profundo a propósito: un `.csproj` vive en `Proyecto/Proyecto.csproj` y un
 * `pom.xml` de módulo en `modulo/pom.xml`, pero recorrer el árbol entero de un monorepo
 * para adivinar un stack cuesta más de lo que vale.
 */
function nombresDelRepo(dir, profundidad = 3, acc = new Set()) {
  if (profundidad === 0) return acc;
  let entradas;
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  const saltar = new Set(["node_modules", ".git", "target", "build", "dist", "bin", "obj", ".venv", "vendor"]);
  for (const e of entradas) {
    if (saltar.has(e.name)) continue;
    if (e.isDirectory()) nombresDelRepo(path.join(dir, e.name), profundidad - 1, acc);
    else acc.add(e.name);
  }
  return acc;
}

function detectarPerfiles() {
  const nombres = [...nombresDelRepo(DESTINO)];
  return perfilesDisponibles().filter((nombre) => {
    const globs = leerPerfil(nombre).$detect ?? [];
    return globs.some((g) => nombres.some((n) => globAName(g).test(n)));
  });
}

/** Fusiona el perfil sobre el config: arrays se suman sin duplicar, escalares pisan. */
function fusionar(base, encima) {
  for (const [clave, valor] of Object.entries(encima)) {
    if (clave === "$stack" || clave === "$detect" || clave === "$comment") continue;
    if (Array.isArray(valor)) {
      const previos = Array.isArray(base[clave]) ? base[clave] : [];
      const vistos = new Set(previos.map((v) => JSON.stringify(v)));
      base[clave] = [...previos, ...valor.filter((v) => !vistos.has(JSON.stringify(v)))];
    } else if (valor && typeof valor === "object") {
      base[clave] = fusionar(base[clave] && typeof base[clave] === "object" ? base[clave] : {}, valor);
    } else {
      base[clave] = valor;
    }
  }
  return base;
}

// Qué perfiles se aplican: explícitos si los pidieron, detectados si hay UNO solo.
// Con varios detectados el instalador NO elige: los lista y sigue con la plantilla pelada.
let perfiles = [];
if (perfilArg !== null) {
  perfiles = perfilArg.split(",").map((p) => p.trim()).filter(Boolean);
  const desconocidos = perfiles.filter((p) => !perfilesDisponibles().includes(p));
  if (!perfiles.length || desconocidos.length) {
    console.error(`perfil desconocido: ${desconocidos.join(", ") || "(vacío)"}`);
    console.error(`disponibles: ${perfilesDisponibles().join(", ")}`);
    process.exit(1);
  }
  console.log(`Perfil de stack (pedido): ${perfiles.join(" + ")}`);
} else {
  const detectados = detectarPerfiles();
  if (detectados.length === 1) {
    perfiles = detectados;
    console.log(`Perfil de stack (detectado): ${detectados[0]}`);
  } else if (detectados.length > 1) {
    console.log(`Varios stacks detectados: ${detectados.join(", ")}`);
    console.log(`El instalador NO elige por vos. Repetí con: --perfil ${detectados.join(",")}`);
  } else {
    console.log("Sin perfil de stack: la plantilla queda pelada (llenala a mano).");
  }
}
console.log("");

/** El config de arranque, con el/los perfil(es) ya fusionado(s). */
function configDeArranque() {
  const base = JSON.parse(fs.readFileSync(path.join(ORIGEN, "plantillas/harness.config.json"), "utf8"));
  if (!perfiles.length) return null; // sin perfil se copia la plantilla tal cual
  for (const nombre of perfiles) fusionar(base, leerPerfil(nombre));
  base.$perfil = `Generado con el/los perfil(es): ${perfiles.join(", ")}. El perfil trae la FORMA del stack; las reglas y las señales del gate las escribe este equipo.`;
  return `${JSON.stringify(base, null, 2)}\n`;
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
  ".claude/hooks/ask-first.mjs",
  ".claude/hooks/action-guard.mjs",
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
  // Documentos AGNÓSTICOS que el arnés instalado cita: sin ellos, el propio arnés arranca
  // apuntando a la nada en el repo destino (P10 violado por el instalador). Lo destapó el
  // banco de perfiles: `docs-linkcheck` del repo portado salía rojo el primer día.
  "docs/sdd.md",
  "docs/buenas-practicas.md",
  "docs/trazabilidad.md",
  ".githooks/pre-commit",
  ".githooks/commit-msg",
  ".githooks/pre-push",
  ".githooks/post-commit",
];

/** Plantillas: van a la raíz del destino con nombre final, para que el equipo las llene. */
const PLANTILLAS = [
  ["plantillas/CONSTITUTION.md", "CONSTITUTION.md"],
  ["plantillas/STATUS.md", "STATUS.md"],
  ["plantillas/gotchas.md", "docs/gotchas.md"],
  ["plantillas/harness.config.json", ".claude/harness.config.json"],
  ["plantillas/arnes.md", "docs/arnes.md"],
  // Crea `docs/decisions/` —que la guía y trazabilidad citan— y deja la plantilla adentro:
  // el directorio vacío no existe en git, y una decisión sin dónde escribirse no se escribe.
  ["plantillas/ADR.md", "docs/decisions/PLANTILLA.md"], // linkcheck:ignora — ruta del DESTINO, no de acá
  ["plantillas/ci.yml", ".github/workflows/ci.yml"],
];

const EJECUTABLES = new Set([
  "scripts/gate.sh",
  ".githooks/pre-commit",
  ".githooks/commit-msg",
  ".githooks/pre-push",
  ".githooks/post-commit",
]);

const acciones = [];
for (const rel of COPIAR) acciones.push({ tipo: "copia", desde: rel, hacia: rel });
for (const [desde, hacia] of PLANTILLAS) acciones.push({ tipo: "plantilla", desde, hacia });

// El config de arranque se GENERA cuando hay perfil: es la plantilla más los hechos del stack.
const configGenerado = configDeArranque();
if (configGenerado) {
  const accion = acciones.find((a) => a.hacia === ".claude/harness.config.json");
  if (accion) {
    accion.tipo = "generado";
    accion.contenido = configGenerado;
  }
}

let copiados = 0;
let conservados = 0;

const ETIQUETA = {
  plantilla: "   (plantilla: hay que llenarla)",
  generado: `   (plantilla + perfil ${perfiles.join("+")}: faltan gate.signals y las reglas)`,
};

for (const a of acciones) {
  const src = path.join(ORIGEN, a.desde);
  const dst = path.join(DESTINO, a.hacia);
  if (!a.contenido && !fs.existsSync(src)) {
    console.log(`  ! falta en el origen: ${a.desde}`);
    continue;
  }
  if (fs.existsSync(dst)) {
    console.log(`  = conservado (ya existe): ${a.hacia}`);
    conservados += 1;
    continue;
  }
  console.log(`  ${APLICAR ? "+" : "→"} ${a.hacia}${ETIQUETA[a.tipo] ?? ""}`);
  copiados += 1;
  if (!APLICAR) continue;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (a.contenido) fs.writeFileSync(dst, a.contenido);
  else fs.copyFileSync(src, dst);
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
     Leé el manifiesto y el CI del repo antes de escribirlas. Un gate vacío no verifica nada.${
       perfiles.length
         ? `\n     El perfil dejó CANDIDATAS en \`gate.$signalHints\`: confirmalas contra el CI real y
     movelas a \`gate.signals\`. Adivinar el comando de test de otro equipo es lo que hace
     que el gate mienta el primer día.`
         : ""
     }
     El arnés corre con \`node\` y \`bash\`: si este repo es de .NET, JVM, Python o Go,
     node tiene que estar en la máquina y en el runner de CI.

  2. .claude/harness.config.json → protectedPaths, bash.deny, purity, patterns
     Traducí las convenciones de este repo a reglas. Empezá por lo que ya se rompió una vez.

  2b. .claude/harness.config.json → commitMsg.codePattern
     Dónde vive el código EN ESTE REPO (\`src/\`, \`services/\`, \`apps/\`…). Ningún perfil lo
     puede traer: es layout del equipo, no del lenguaje. Si queda mal, \`commit-msg\` deja de
     exigir la referencia al ítem de trabajo y el registro se apaga sin ponerse rojo.

  3. Scripts del manifiesto (package.json, Makefile, justfile…):
       gate       → bash scripts/gate.sh
       gate:fast  → bash scripts/gate.sh fast

  4. git config core.hooksPath .githooks      (pre-commit, commit-msg y pre-push reales)
     Y activá la protección de rama en tu forja: el hook local avisa antes de la red,
     pero el freno fuerte es del lado del servidor.

  4b. .claude/harness.config.json → tracker
     El patrón de referencia de TU forja (#123, AB#123, PROJ-123…). Copiar el de otro
     equipo hace que el freno nunca encuentre la referencia y todos escriban
     \`sin-issue:\` como ritual. Ver docs/trazabilidad.md.

  5. CONSTITUTION.md y STATUS.md: principios que este repo puede hacer cumplir HOY.
     Un principio BLOCKING sin comando que falle es un principio REVIEW mal etiquetado.

  6. CI: que corra EL MISMO gate. Si CI verifica algo distinto, una de las dos señales miente.

Después: node scripts/harness-selftest.mjs && bash scripts/gate.sh
`);
