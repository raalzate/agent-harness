#!/usr/bin/env node
/**
 * ci-investigate — leer el fallo del pipeline remoto, no adivinarlo.
 *
 * El gate local es la evidencia del agente; la de CI vive en la forja. Cuando CI sale rojo y el
 * gate local verde, el agente tiende a contar la historia que ya conoce («seguro es flaky») en vez
 * de leer el log: el agente no puede ser la única fuente de evidencia de su propio trabajo. Este
 * script trae la evidencia de afuera con el CLI de la forja que declara el config, y la recorta a
 * lo que importa: la corrida, el job y el paso, las líneas del error con su contexto, y el cruce
 * con el registro del gate local — una señal verde acá y roja allá apunta al ENTORNO (SO, rutas,
 * shell), no al código.
 *
 * Agnóstico de forja: todo sale de `ci.investigate` (GitHub con `gh`, GitLab con `glab`, Azure con
 * `az pipelines`…; las plantillas están en docs/cicd.md). Sin la clave, no corre.
 *
 *   node scripts/ci-investigate.mjs [--branch <rama>] [--run <id>] [--config <ruta>]
 *
 * `--run` investiga una corrida concreta (una vieja, la de otro PR) y se saltea la lista.
 *
 * Exit: 0 = la última corrida está verde, en curso, o no hay dato (CLI ausente, sin credenciales:
 * OMITIDO, y omitido no es verde) · 1 = encontró un fallo y lo reportó. Lo corre el humano o el
 * subagente `ci-investigator`, no es un hook: el contrato 0/2 no aplica.
 *
 * Nunca imprime el entorno: los comandos heredan las variables (las credenciales del CLI viven
 * ahí) y de su error sólo se muestra la primera línea.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existeEjecutable, resolverEjecutable } from "../.claude/hooks/harness.mjs";

const args = process.argv.slice(2);
const opcion = (nombre) => {
  const i = args.indexOf(nombre);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
};
const CWD = process.cwd();
const rutaConfig = opcion("--config") ? path.resolve(opcion("--config")) : path.join(CWD, ".claude", "harness.config.json");

const omitido = (motivo) => {
  console.log(`ci-investigate: OMITIDO — ${motivo}\nSin dato de CI: omitido no es verde.`);
  process.exit(0);
};

let config;
try {
  config = JSON.parse(fs.readFileSync(rutaConfig, "utf8"));
} catch {
  omitido("no hay config legible.");
}
const spec = config.ci?.investigate;
if (!spec?.listCommand?.length) omitido("el repo no declara `ci.investigate.listCommand`.");

const git = (...a) => {
  const r = spawnSync("git", a, { cwd: CWD, encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
};

// La rama y el id de corrida terminan en argv. Sin shell no hay nada que inyectar, pero en Windows
// un `.cmd` (az, por ejemplo) corre por `cmd.exe`: ahí un `&` en la rama sería un comando. Se
// aceptan sólo los caracteres que una rama o un id usan de verdad.
const SEGURO = /^[\w./@+-]+$/;
const rama = opcion("--branch") ?? git("rev-parse", "--abbrev-ref", "HEAD");
if (!rama || rama === "HEAD") omitido("no hay rama (HEAD separado): pasala con `--branch <rama>`.");
if (!SEGURO.test(rama)) omitido(`la rama \`${rama}\` tiene caracteres que no se pasan a un comando.`);

// En Windows, SÓLO un `.cmd`/`.bat` corre por `cmd.exe` (Node no lo lanza sin shell); todo lo demás
// sin shell, igual que el gate y el despliegue.
const porCmd = (bin) => process.platform === "win32" && /\.(cmd|bat)$/i.test(resolverEjecutable(String(bin)));
function correr(argv) {
  const [bin, ...resto] = argv;
  if (!existeEjecutable(bin)) return { ausente: true };
  const shell = porCmd(bin);
  const r = spawnSync(shell ? bin : resolverEjecutable(bin), resto, {
    cwd: CWD,
    encoding: "utf8",
    shell,
    windowsHide: true,
    timeout: Number.isFinite(spec.timeoutMs) ? spec.timeoutMs : 60000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const motivo = r.error?.code === "ETIMEDOUT" ? "no contestó a tiempo (`timeoutMs`)" : `${r.stderr ?? ""}`.trim().split("\n")[0].slice(0, 200) || `exit ${r.status}`;
  return { ok: r.status === 0 && !r.error, stdout: r.stdout ?? "", motivo };
}
const sustituir = (argv, marca, valor) => argv.map((a) => String(a).split(marca).join(valor));
const campo = (obj, ruta) => (ruta ? String(ruta).split(".").reduce((o, k) => (o == null ? o : o[k]), obj) : undefined);

// ── 1. La última corrida de la rama (o la que se pidió con `--run`) ─────────
const fallidos = spec.failedValues ?? ["failure"];
const verdes = spec.passedValues ?? ["success"];
const pedida = opcion("--run");
let id, conclusion, nombre, url;
if (pedida) {
  // Para investigar una corrida concreta (una vieja, la de otro PR): se salta la lista y se va al log.
  if (!SEGURO.test(pedida)) omitido(`el id de corrida \`${pedida}\` tiene caracteres que no se pasan a un comando.`);
  id = pedida;
  conclusion = "pedida con --run";
} else {
  const lista = correr(sustituir(spec.listCommand, "{branch}", rama));
  if (lista.ausente) omitido(`no encuentro \`${spec.listCommand[0]}\` (el CLI de la forja) en el PATH.`);
  if (!lista.ok) omitido(`\`${spec.listCommand[0]}\` falló (¿sin credenciales, sin red?): ${lista.motivo}`);
  let corridas;
  try {
    corridas = JSON.parse(lista.stdout);
  } catch {
    omitido(`\`${spec.listCommand[0]}\` no devolvió JSON: revisá \`listCommand\`.`);
  }
  // La forja devuelve una lista (gh, glab, az) o un objeto que la contiene (`listPath`, p. ej. la
  // API de Jenkins): la primera es la más nueva. Un objeto suelto es la corrida misma.
  const enLista = Array.isArray(corridas) ? corridas : spec.listPath ? campo(corridas, spec.listPath) : [corridas];
  const corrida = Array.isArray(enLista) ? enLista[0] : null;
  if (!corrida || typeof corrida !== "object") {
    console.log(`ci-investigate: la rama \`${rama}\` no tiene corridas en CI. Sin dato: omitido no es verde.`);
    process.exit(0);
  }
  id = campo(corrida, spec.idField ?? "id");
  conclusion = campo(corrida, spec.conclusionField ?? "conclusion") ?? "";
  nombre = campo(corrida, spec.nameField ?? "name");
  url = campo(corrida, spec.urlField ?? "url");
}
const titulo = pedida ? `corrida ${id}` : `corrida ${id ?? "?"}${nombre ? ` «${nombre}»` : ""} en \`${rama}\``;

if (!pedida && verdes.includes(conclusion)) {
  console.log(`CI VERDE — ${titulo} (${conclusion}).${url ? `\n  ${url}` : ""}`);
  process.exit(0);
}
if (!pedida && !fallidos.includes(conclusion)) {
  console.log(
    conclusion
      ? `CI SIN VEREDICTO — ${titulo} terminó con «${conclusion}», que no está en \`failedValues\` ni en \`passedValues\`.${url ? `\n  ${url}` : ""}`
      : `CI EN CURSO — ${titulo} todavía no tiene conclusión. Volvé a correrlo cuando termine.${url ? `\n  ${url}` : ""}`,
  );
  process.exit(0);
}

// ── 2. El log de lo que falló, recortado al error ───────────────────────────
console.log(`CI ROJO — ${titulo} (${conclusion}).${url ? `\n  ${url}` : ""}`);
if (!spec.logCommand?.length || id == null || !SEGURO.test(String(id))) {
  console.log("  (sin `logCommand` o sin id de corrida: abrí la corrida para leer el error)");
  process.exit(1);
}
const log = correr(sustituir(spec.logCommand, "{run}", String(id)));
if (!log.ok) {
  console.log(`  (no pude leer el log: ${log.ausente ? `no encuentro \`${spec.logCommand[0]}\`` : log.motivo})`);
  process.exit(1);
}

const compilar = (p) => {
  try {
    return new RegExp(p, "i");
  } catch {
    return null; // el regex inválido lo reporta el self-test
  }
};
// Default agnóstico: lo que casi cualquier herramienta imprime cuando algo falla.
const patrones = (spec.failurePatterns ?? ["\\berror\\b", "\\bfail(ed|ure|ing)?\\b", "\\bexception\\b", "\\bfatal\\b", "✗", "exit code [1-9]"]).map(compilar).filter(Boolean);
const quitar = spec.stripPattern ? compilar(spec.stripPattern) : null;
// Lo que casa un patrón de error sin serlo: un caso VERDE cuyo nombre dice «rojo» o «error».
const ignorar = (spec.ignorePatterns ?? []).map(compilar).filter(Boolean);
const campos = spec.logFields ?? [];
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

const lineas = log.stdout.split(/\r?\n/).map((cruda) => {
  const partes = cruda.replace(ANSI, "").split("\t");
  const meta = partes.length > campos.length ? partes.slice(0, campos.length) : [];
  let texto = (meta.length ? partes.slice(campos.length).join("\t") : partes.join("\t")).trimEnd();
  if (quitar) texto = texto.replace(quitar, "");
  return { meta, texto };
});
const marcadas = lineas.map((l, i) => (l.texto.trim() && patrones.some((re) => re.test(l.texto)) && !ignorar.some((re) => re.test(l.texto)) ? i : -1)).filter((i) => i >= 0);
if (!marcadas.length) {
  console.log("  El log no tiene ninguna línea que case `failurePatterns`: leelo entero en la corrida.");
  process.exit(1);
}

// Dónde falló: los campos (job, paso) de las líneas marcadas, sin repetir.
if (campos.length) {
  const donde = [...new Set(marcadas.map((i) => lineas[i].meta.map((v, k) => `${campos[k]}: ${v}`).join(" · ")).filter(Boolean))];
  for (const d of donde.slice(0, 5)) console.log(`  ${d}`);
}

const ctx = Number.isFinite(spec.contextLines) ? spec.contextLines : 2;
const max = Number.isFinite(spec.maxLines) ? spec.maxLines : 40;
const elegidas = new Set(marcadas.flatMap((i) => Array.from({ length: 2 * ctx + 1 }, (_, k) => i - ctx + k)).filter((i) => i >= 0 && i < lineas.length));
const orden = [...elegidas].sort((a, b) => a - b);
console.log(`\n  Líneas del error (${marcadas.length} marcada(s), contexto ±${ctx}):`);
let previa = null;
for (const i of orden.slice(0, max)) {
  if (previa !== null && i !== previa + 1) console.log("    …");
  console.log(`  ${marcadas.includes(i) ? "▶" : " "} ${lineas[i].texto}`);
  previa = i;
}
if (orden.length > max) console.log(`    … recortado: ${max} de ${orden.length} líneas (\`maxLines\`). El log completo: \`${sustituir(spec.logCommand, "{run}", String(id)).join(" ")}\``);

// ── 3. El cruce con el gate local ──────────────────────────────────────────
// Una señal roja en CI y verde acá no es un bug del código: es el entorno (SO, rutas, shell).
{
  const rel = config.gate?.registry ?? ".git/harness-gate.json";
  const candidatas = [path.resolve(CWD, rel)];
  // En un worktree `.git` es un archivo: el registro vive en el gitdir real, o en el del repo
  // principal (que puede ser de otra rama: por eso el reporte nombra la rama y el HEAD del registro).
  if (/^\.git[\\/]/.test(rel)) {
    const propio = git("rev-parse", "--path-format=absolute", "--git-path", rel.slice(5));
    const comun = git("rev-parse", "--path-format=absolute", "--git-common-dir");
    if (propio) candidatas.push(propio);
    if (comun) candidatas.push(path.join(comun, rel.slice(5)));
  }
  let registro = null;
  for (const c of candidatas) {
    try {
      registro = JSON.parse(fs.readFileSync(c, "utf8"));
      break;
    } catch {
      /* el siguiente */
    }
  }
  const textoMarcado = marcadas.map((i) => lineas[i].texto);
  const senales = Object.entries(registro?.senales ?? {}).filter(([n]) => textoMarcado.some((t) => t.includes(n)));
  console.log("");
  if (!registro) console.log(`  Sin registro del gate local (\`${rel}\`): corré el gate acá para saber si el fallo se reproduce.`);
  else if (!senales.length) console.log(`  Ninguna señal del gate local aparece en las líneas del error: el fallo es de otra etapa del pipeline.`);
  else {
    console.log(`  Cruce con el gate local (\`${rel}\`${registro.rama ? `, rama ${registro.rama}` : ""}${registro.head ? ` @ ${registro.head}` : ""}):`);
    for (const [n, s] of senales) {
      if (s.estado === "verde") console.log(`    · «${n}»: verde acá, roja en CI → falla sólo en CI → entorno: SO, rutas, shell, variables.`);
      else if (s.estado === "rojo") console.log(`    · «${n}»: también roja acá → se reproduce local: arreglala acá primero.`);
      else console.log(`    · «${n}»: ${s.estado ?? "sin estado"} acá → corré la señal local para comparar.`);
    }
  }
}
process.exitCode = 1;
