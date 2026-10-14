#!/usr/bin/env node
/**
 * cycle-check — el ciclo de desarrollo del equipo, hecho comando.
 *
 * Un modelo de ramas (trunk-based, GitHub flow, git flow) y las prácticas de XP viven
 * normalmente en la cabeza del equipo y en un wiki: se explican una vez, se cumplen dos
 * semanas y nadie se entera cuando dejan de cumplirse. Lo que este script hace es la
 * única parte que sobrevive: la que falla con un comando.
 *
 * Agnóstico: no conoce ningún modelo de ramas ni ningún lenguaje. Todo sale del config
 * (`workflow` y `xp` en `.claude/harness.config.json`); una clave ausente o vacía =
 * el freno no corre. Un config roto DEJA PASAR: el arnés no bloquea al humano por
 * estar roto.
 *
 * Uso:
 *   node scripts/cycle-check.mjs --commit <archivo-de-mensaje>   # prácticas XP (commit-msg)
 *   node scripts/cycle-check.mjs --push                          # modelo de ramas (pre-push, refs por stdin)
 *   node scripts/cycle-check.mjs --branch <nombre>               # una rama suelta, sin git
 *   node scripts/cycle-check.mjs --sync [<rama>]                 # ¿la rama choca con la base? (antes del PR)
 *   node scripts/cycle-check.mjs --verify-red [<base>]           # la prueba nueva falla sin el cambio (CI, en el PR)
 *   node scripts/cycle-check.mjs --rules                         # qué está activo y de dónde sale
 *   [--config <ruta>]                                            # para los cebos del self-test (P7)
 *
 * Exit: 0 = seguir · 1 = bloquear (stderr es lo que se lee). Lo usan hooks de git, que
 * es lo que git entiende; el contrato 0/2 de los hooks del agente vive en harness.mjs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existeEjecutable } from "../.claude/hooks/harness.mjs";

const args = process.argv.slice(2);
const flag = (nombre) => {
  const i = args.indexOf(nombre);
  return i === -1 ? null : (args[i + 1] ?? "");
};
const tiene = (nombre) => args.includes(nombre);

const rutaConfig = flag("--config") || path.join(process.cwd(), ".claude", "harness.config.json");
let config;
try {
  config = JSON.parse(fs.readFileSync(rutaConfig, "utf8"));
} catch {
  process.exit(0); // config ausente o inválido: dejar pasar, nunca bloquear por estar roto
}

const workflow = config.workflow ?? {};
const xp = config.xp ?? {};
const errores = [];
const compila = (patron) => {
  try {
    return new RegExp(patron);
  } catch {
    return null; // regex inválido: lo caza el self-test, acá deja pasar
  }
};

/** git, cuando hay git. Devuelve "" si el comando falla: ninguna comprobación bloquea por eso. */
function git(...cmd) {
  const r = spawnSync("git", cmd, { encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").trim() : "";
}

/** Una línea propia en el cuerpo del mensaje, CON motivo: una fuga pelada es la misma omisión con otro nombre. */
function declarada(msg, linea) {
  if (!linea) return false;
  const re = new RegExp("^" + linea.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\S+", "im");
  return re.test(msg);
}

function bloquear(titulo, cuerpo) {
  errores.push([titulo, ...cuerpo].join("\n"));
}

// ───────────────────────────────── modelo de ramas ─────────────────────────────────

/**
 * Qué se verifica de una rama, y qué no. El nombre y la edad son observables desde acá;
 * a qué rama se mergea lo decide el pull request, que este hook no ve — por eso
 * `mergeInto` se declara, se le muestra al agente y al humano, y no se finge verificado.
 */
function revisarRama(rama) {
  if (!rama) return;
  const largas = workflow.longLived ?? config.branches?.protected ?? [];
  if (largas.includes(rama)) return; // main/develop/release no siguen el patrón de rama de trabajo

  const patron = workflow.branchPattern ? compila(workflow.branchPattern) : null;
  if (patron && !patron.test(rama)) {
    bloquear(`ciclo: el nombre de la rama \`${rama}\` no sigue el modelo declarado (${workflow.model ?? "sin nombre"}).`, [
      "",
      `Patrón: ${workflow.branchPattern}`,
      ...(workflow.branchExamples ?? []).map((e) => `  ej.  ${e}`),
      ...(workflow.reason ? ["", `Motivo: ${workflow.reason}`] : []),
      "",
      "Renombrar la rama local y volver a empujar:",
      "  git branch -m <nombre-que-sigue-el-patrón>",
      "  git push -u origin <nombre-que-sigue-el-patrón>",
    ]);
  }
}

/**
 * Rama vieja = lote grande esperando. La edad se mide desde el punto donde la rama se
 * separó de la base, que es lo que de verdad dice cuánto hace que no se integra.
 * `staleAction: "warn"` avisa sin bloquear: una rama vieja es una señal, no siempre un error.
 */
function revisarEdad(rama) {
  const dias = Number(workflow.maxAgeDays ?? 0);
  if (!dias || !rama) return;
  const base = workflow.baseBranch;
  if (!base || rama === base) return;

  const punto = git("merge-base", rama, base) || git("merge-base", rama, `origin/${base}`);
  if (!punto) return; // sin base local no hay medición honesta: no se inventa un veredicto
  const ts = Number(git("log", "-1", "--format=%ct", punto));
  if (!ts) return;

  const edad = Math.floor((Date.now() / 1000 - ts) / 86400);
  if (edad <= dias) return;

  const texto = [
    `ciclo: \`${rama}\` se separó de \`${base}\` hace ${edad} días (máximo declarado: ${dias}).`,
    "",
    "Una rama vieja es un lote grande esperando: el merge es más caro y el rojo aparece tarde.",
    `  git fetch origin && git rebase origin/${base}`,
    ...(workflow.staleReason ? ["", `Motivo: ${workflow.staleReason}`] : []),
  ].join("\n");

  if ((workflow.staleAction ?? "warn") === "block") bloquear(texto, []);
  else process.stderr.write(`${texto}\n\n`);
}

/**
 * Sincronía con la base: ¿esta rama, mergeada HOY, choca? La edad no lo dice —una rama de un
 * día choca si alguien tocó las mismas líneas—, y el PR lo descubre tarde, cuando el agente ya
 * pasó a otra cosa y nadie se acuerda de qué resolvía cada lado.
 *
 * Se simula el merge con `git merge-tree --write-tree` (git ≥ 2.38): calcula el resultado en la
 * base de objetos y no toca el árbol ni el índice (P7). Exit 1 = conflicto, 0 = limpio; otro
 * código = git viejo o refs rotas, y eso NO es un veredicto: se avisa y se deja pasar.
 *
 * El `fetch` es lo que hace honesta la medición: medir contra un `origin/<base>` de hace tres
 * días es exactamente el error que este freno existe para cazar. Si la red falla, se mide contra
 * lo que hay y se dice.
 */
function revisarSincronia(rama, sha, { manual = false } = {}) {
  const sync = workflow.sync;
  if (!sync?.enabled || !rama) return;
  const base = workflow.baseBranch;
  if (!base || rama === base) return;
  const remoto = sync.remote ?? "origin";

  let fetchFallo = false;
  if (sync.fetch !== false) fetchFallo = spawnSync("git", ["fetch", "--quiet", remoto, base], { encoding: "utf8" }).status !== 0;
  const ref = [`${remoto}/${base}`, base].find((r) => git("rev-parse", "--verify", "--quiet", r));
  if (!ref) return; // sin base no hay medición honesta: no se inventa un veredicto
  const punta = sha || rama;

  const atras = Number(git("rev-list", "--count", `${punta}..${ref}`)) || 0;
  const aviso = fetchFallo ? ` (no se pudo bajar \`${remoto}/${base}\`: medido contra la copia local)` : "";
  // merge y no rebase: ponerse al día no reescribe la rama, así que el push siguiente es uno
  // normal y no hace falta `--force-with-lease` (que con razón pide confirmación al humano).
  const salida = sync.command ?? `git fetch ${remoto} && git merge ${remoto}/${base}`;
  if (!atras) {
    if (manual) process.stdout.write(`ciclo (sincronía): \`${rama}\` está al día con \`${ref}\`${aviso}.\n`);
    return;
  }

  const r = spawnSync("git", ["merge-tree", "--write-tree", "--name-only", "--no-messages", ref, punta], { encoding: "utf8" });
  if (r.status === 1) {
    // Primera línea: el árbol resultante. Después, un archivo en conflicto por línea.
    const archivos = [...new Set((r.stdout ?? "").split("\n").slice(1).map((l) => l.trim()).filter(Boolean))];
    const texto = [
      `ciclo (sincronía): \`${rama}\` CHOCA con \`${ref}\` — ${atras} commit(s) de la base que la rama no tiene${aviso}.`,
      "",
      "Archivos en conflicto:",
      ...archivos.map((f) => `  - ${f}`),
      ...(sync.reason ? ["", `Motivo: ${sync.reason}`] : []),
      "",
      "Resolvelo ACÁ, donde sabés qué hace cada lado, no en el PR:",
      `  ${salida}`,
      "  # resolvé, `git add <archivo>`, `git commit`, corré el gate y empujá: sin reescribir nada",
    ].join("\n");
    if ((sync.conflictAction ?? "block") === "block") bloquear(texto, []);
    else process.stderr.write(`${texto}\n\n`);
    return;
  }
  if (r.status !== 0) {
    process.stderr.write(`ciclo (sincronía): no se pudo simular el merge con \`${ref}\` (¿git < 2.38?). Sin veredicto: no bloquea.\n\n`);
    return;
  }

  const umbral = Number(sync.behindWarn ?? 1);
  if (atras < umbral) return;
  const texto = [
    `ciclo (sincronía): \`${rama}\` está ${atras} commit(s) atrás de \`${ref}\`${aviso}. Hoy no choca; cada commit que entra a la base lo hace más probable.`,
    `  ${salida}`,
  ].join("\n");
  if (sync.behindAction === "block") bloquear(texto, []);
  else process.stderr.write(`${texto}\n\n`);
}

// ────────────────────────────────── prácticas XP ──────────────────────────────────

/**
 * Test primero. No prueba que el test se haya escrito ANTES —nada lo prueba desde acá—,
 * sino que el cambio de comportamiento y su prueba entran juntos al historial. Es el
 * mínimo verificable, y es el que se saltea.
 */
function revisarTestPrimero(msg, staged) {
  const regla = xp.testFirst;
  if (!regla?.enabled) return;
  const reCodigo = compila(regla.codePattern ?? config.commitMsg?.codePattern ?? "");
  const reTest = compila(regla.testPattern ?? config.tests?.filePattern ?? "");
  if (!reCodigo || !reTest) return;

  const ignoradas = regla.ignoreExtensions ?? config.commitMsg?.ignoreExtensions ?? [".md"];
  const codigo = staged.filter((f) => reCodigo.test(f) && !ignoradas.some((e) => f.endsWith(e)) && !reTest.test(f));
  if (!codigo.length) return;
  if (staged.some((f) => reTest.test(f))) return;

  const fuga = regla.escapeLine ?? "no-test:";
  if (declarada(msg, fuga)) return;

  bloquear("ciclo (XP · test primero): este commit cambia comportamiento y no trae ninguna prueba.", [
    "",
    ...codigo.map((f) => `  - ${f}`),
    "",
    `Lo que cuenta como prueba: ${regla.testPattern ?? config.tests?.filePattern}`,
    ...(regla.reason ? ["", `Motivo: ${regla.reason}`] : []),
    "",
    "Elegí una, y que quede en el historial:",
    "  1) agregá la prueba que falla sin este cambio;",
    `  2) declaralo con motivo:  ${fuga} <por qué este cambio no lleva prueba>`,
  ]);
}

/** Lote chico. El límite es de este equipo y sale del config: nadie sabe en abstracto cuántos archivos son demasiados. */
function revisarLote(msg, staged, numstat) {
  const regla = xp.smallBatch;
  if (!regla?.enabled) return;
  const fuga = regla.escapeLine ?? "big-batch:";
  if (declarada(msg, fuga)) return;

  const ignoradas = (regla.ignorePattern && compila(regla.ignorePattern)) || null;
  const cuentan = ignoradas ? staged.filter((f) => !ignoradas.test(f)) : staged;

  const lineas = numstat
    .filter(([, , f]) => !ignoradas || !ignoradas.test(f))
    .reduce((acc, [mas, menos]) => acc + mas + menos, 0);

  const excesos = [];
  if (regla.maxFiles && cuentan.length > regla.maxFiles) excesos.push(`${cuentan.length} archivos (máximo ${regla.maxFiles})`);
  if (regla.maxLines && lineas > regla.maxLines) excesos.push(`${lineas} líneas cambiadas (máximo ${regla.maxLines})`);
  if (!excesos.length) return;

  bloquear(`ciclo (XP · lote chico): ${excesos.join(" y ")}.`, [
    ...(regla.reason ? ["", `Motivo: ${regla.reason}`] : []),
    "",
    "Elegí una, y que quede en el historial:",
    "  1) partilo: `git reset` y commiteá por pieza con sentido propio;",
    `  2) declaralo con motivo:  ${fuga} <por qué este lote no se parte>`,
  ]);
}

/**
 * Refactor separado. Verificable: un commit que se declara refactor no cambia las pruebas
 * —si el comportamiento no cambió, las expectativas tampoco—. Que el refactor sea de
 * verdad un refactor sigue siendo juicio del reviewer.
 */
function revisarRefactor(msg, staged) {
  const regla = xp.refactorSeparate;
  if (!regla?.enabled) return;
  const reSujeto = compila(regla.subjectPattern ?? "^refactor(\\(|:)");
  const reTest = compila(regla.testPattern ?? config.tests?.filePattern ?? "");
  if (!reSujeto || !reTest) return;
  if (!reSujeto.test(msg.split("\n")[0] ?? "")) return;

  const tests = staged.filter((f) => reTest.test(f));
  if (!tests.length) return;

  const fuga = regla.escapeLine ?? "mixed-refactor:";
  if (declarada(msg, fuga)) return;

  bloquear("ciclo (XP · refactor separado): este commit se declara `refactor` y cambia pruebas.", [
    "",
    ...tests.map((f) => `  - ${f}`),
    "",
    "Un refactor no cambia comportamiento; si cambian las expectativas, no es un refactor:",
    "son dos commits, y el orden importa para poder revertir uno solo.",
    ...(regla.reason ? ["", `Motivo: ${regla.reason}`] : []),
    "",
    `Si el cambio de prueba es de forma y no de expectativa:  ${fuga} <por qué>`,
  ]);
}

/** Programación de a dos. Lo verificable es el rastro: el trailer de co-autoría, o la declaración de que se hizo solo. */
function revisarPairing(msg) {
  const regla = xp.pairing;
  if (!regla?.enabled) return;
  const trailer = regla.trailer ?? "Co-authored-by:";
  if (msg.toLowerCase().includes(trailer.toLowerCase())) return;

  const fuga = regla.escapeLine ?? "solo:";
  if (declarada(msg, fuga)) return;

  bloquear("ciclo (XP · de a dos): el commit no dice con quién se hizo.", [
    ...(regla.reason ? ["", `Motivo: ${regla.reason}`] : []),
    "",
    "Elegí una, y que quede en el historial:",
    `  1) ${trailer} Nombre <mail@ejemplo>`,
    `  2) ${fuga} <por qué este cambio se hizo sin par>`,
  ]);
}

/**
 * Test primero, versión fuerte: la prueba nueva FALLA sin el cambio de producción.
 *
 * `revisarTestPrimero` sólo ve que prueba y cambio entran juntos; una prueba que pasa igual
 * sin el cambio es un espejo del código y no prueba nada. Es el hueco del «arnés de
 * comportamiento» del marco de guías y sensores: la respuesta típica es confiar en pruebas que
 * escribió el mismo agente, y esto convierte esa confianza en un comando.
 *
 * Cómo: un worktree temporal FUERA del repo (P7) en el punto donde la rama se separó de la
 * base, con los archivos de prueba de HEAD encima, y `verifyRed.command` corriendo ahí. Tiene
 * que fallar. Que falle por la razón CORRECTA no lo ve ningún comando: sigue siendo juicio.
 * Es caro (corre la suite sobre otro árbol), así que va a la derecha del ciclo: CI, en el PR.
 */
function revisarRojo(base) {
  const regla = xp.testFirst;
  const rojo = regla?.verifyRed;
  if (!regla?.enabled || !rojo?.enabled || !(rojo.command ?? []).length) {
    process.stdout.write("ciclo (XP · rojo sin el cambio): OMITIDO — `xp.testFirst.verifyRed` no está activo.\n");
    return;
  }
  const punto = git("merge-base", base, "HEAD");
  if (!punto) {
    process.stdout.write(`ciclo (XP · rojo sin el cambio): OMITIDO — no encuentro \`${base}\` para medir contra él.\n`);
    return;
  }
  const reCodigo = compila(regla.codePattern ?? config.commitMsg?.codePattern ?? "");
  const reTest = compila(regla.testPattern ?? config.tests?.filePattern ?? "");
  if (!reCodigo || !reTest) return;
  const ignoradas = regla.ignoreExtensions ?? config.commitMsg?.ignoreExtensions ?? [".md"];
  const cambiados = git("diff", "--name-only", "--diff-filter=ACMR", punto, "HEAD").split("\n").filter(Boolean);
  const pruebas = cambiados.filter((f) => reTest.test(f));
  const codigo = cambiados.filter((f) => reCodigo.test(f) && !ignoradas.some((e) => f.endsWith(e)) && !reTest.test(f));
  if (!pruebas.length || !codigo.length) {
    process.stdout.write("ciclo (XP · rojo sin el cambio): nada que medir — la rama no trae prueba y cambio de producción juntos.\n");
    return;
  }
  const fuga = rojo.escapeLine ?? "no-red:";
  if (declarada(git("log", "--format=%B", `${punto}..HEAD`), fuga)) {
    process.stdout.write(`ciclo (XP · rojo sin el cambio): declarado con \`${fuga}\` en el historial de la rama.\n`);
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rojo-"));
  const arbol = path.join(tmp, "base");
  // Un comando que no llegó a correr (binario ausente, timeout, señal) no es una prueba roja:
  // `status` vale null y `null !== 0` certificaba la prueba. Lo cazó el reviewer.
  const noCorrio = (r) => Boolean(r.error) || r.status === null;
  // Que el binario exista se pregunta antes de lanzarlo: en Windows (shell) un binario ausente es
  // un exit 1 como cualquier prueba roja, y se certificaba la rama (ver `existeEjecutable`).
  const correr = ([cmd, ...cmdArgs]) =>
    existeEjecutable(cmd)
      ? spawnSync(cmd, cmdArgs, { cwd: arbol, encoding: "utf8", timeout: rojo.timeoutMs ?? 600000, shell: process.platform === "win32" })
      : { status: null, error: { code: "ENOENT" } };
  let status = null;
  let invalida = null;
  try {
    if (spawnSync("git", ["worktree", "add", "--detach", arbol, punto], { encoding: "utf8" }).status !== 0) {
      process.stdout.write("ciclo (XP · rojo sin el cambio): OMITIDO — git no pudo crear el árbol de la base.\n");
      return;
    }
    // Un worktree no trae nada ignorado (dependencias, entornos, compilados): sin preparar el
    // árbol, la suite de cualquier repo con dependencias falla por falta de ellas y el freno
    // pasaría siempre. `setupCommand` es lo que las instala; si falla, la medición no vale.
    if ((rojo.setupCommand ?? []).length) {
      const s = correr(rojo.setupCommand);
      if (noCorrio(s) || s.status !== 0)
        invalida = `\`setupCommand\` (${rojo.setupCommand.join(" ")}) no dejó el árbol de la base listo (exit ${s.status ?? s.error?.code ?? "?"}).`;
    }
    if (!invalida) {
      for (const f of pruebas) {
        const destino = path.join(arbol, f);
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        fs.writeFileSync(destino, spawnSync("git", ["show", `HEAD:${f}`], { encoding: "buffer" }).stdout);
      }
      const r = correr(rojo.command);
      if (noCorrio(r)) invalida = `\`${rojo.command.join(" ")}\` no llegó a correr (${r.error?.code ?? "sin exit code: timeout o señal"}).`;
      status = r.status;
    }
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", arbol], { encoding: "utf8" });
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (invalida) {
    bloquear("ciclo (XP · rojo sin el cambio): la medición no vale — un comando que no corre no es una prueba roja.", [
      "",
      invalida,
      "Arreglá `xp.testFirst.verifyRed` (`command`, `setupCommand`) o declaralo con motivo:",
      `  ${rojo.escapeLine ?? "no-red:"} <por qué esta rama no se puede medir>`,
    ]);
    return;
  }
  if (status !== 0) {
    process.stdout.write(`ciclo (XP · rojo sin el cambio): las pruebas de la rama fallan sin el cambio de producción (exit ${status}). Prueban algo.\n`);
    return;
  }
  bloquear("ciclo (XP · rojo sin el cambio): las pruebas de la rama PASAN sin el cambio de producción.", [
    "",
    "Pruebas que se corrieron sobre la base:",
    ...pruebas.map((f) => `  - ${f}`),
    "Cambio de producción que no hizo falta para que pasen:",
    ...codigo.map((f) => `  - ${f}`),
    ...(rojo.reason ? ["", `Motivo: ${rojo.reason}`] : []),
    "",
    "Elegí una, y que quede en el historial:",
    "  1) escribí la prueba que falla sin este cambio (la que describe lo que cambió);",
    `  2) declaralo con motivo en un commit de la rama:  ${fuga} <por qué la prueba no puede fallar antes>`,
  ]);
}

// ───────────────────────────────────── modos ─────────────────────────────────────

if (tiene("--rules")) {
  const filas = [
    ["modelo de ramas", workflow.model ?? "—"],
    ["patrón de rama", workflow.branchPattern ?? "—"],
    ["rama base", workflow.baseBranch ?? "—"],
    ["edad máxima de rama", workflow.maxAgeDays ? `${workflow.maxAgeDays} días (${workflow.staleAction ?? "warn"})` : "—"],
    ["sincronía con la base", workflow.sync?.enabled ? `conflicto: ${workflow.sync.conflictAction ?? "block"} · atraso: ${workflow.sync.behindAction ?? "warn"}` : "—"],
    ["XP · test primero", xp.testFirst?.enabled ? "activo" : "—"],
    ["XP · rojo sin el cambio", xp.testFirst?.enabled && xp.testFirst?.verifyRed?.enabled ? `activo (${(xp.testFirst.verifyRed.command ?? []).join(" ")})` : "—"],
    ["XP · lote chico", xp.smallBatch?.enabled ? `activo (${xp.smallBatch.maxFiles ?? "∞"} archivos / ${xp.smallBatch.maxLines ?? "∞"} líneas)` : "—"],
    ["XP · refactor separado", xp.refactorSeparate?.enabled ? "activo" : "—"],
    ["XP · de a dos", xp.pairing?.enabled ? "activo" : "—"],
  ];
  console.log(`ciclo de desarrollo — leído de ${path.relative(process.cwd(), rutaConfig) || rutaConfig}\n`);
  for (const [k, v] of filas) console.log(`  ${k.padEnd(24)} ${v}`);
  process.exit(0);
}

if (tiene("--branch")) {
  revisarRama(flag("--branch"));
} else if (tiene("--verify-red")) {
  const base = flag("--verify-red");
  const pedida = base && !base.startsWith("--") ? base : workflow.baseBranch;
  revisarRojo(pedida && git("rev-parse", "--verify", "--quiet", pedida) ? pedida : `origin/${pedida}`);
} else if (tiene("--push")) {
  // git pasa por stdin una línea por ref: <ref local> <sha local> <ref remoto> <sha remoto>
  let entrada = "";
  try {
    entrada = fs.readFileSync(0, "utf8");
  } catch {
    entrada = "";
  }
  const ramas = new Map(); // rama → sha local que se empuja
  for (const linea of entrada.split("\n").filter(Boolean)) {
    const [refLocal, shaLocal, refRemoto] = linea.split(/\s+/);
    const ref = refLocal || refRemoto || "";
    // Un tag (`v1.2.3`) no es una rama de trabajo: el modelo de ramas no lo juzga. Sin esto, un
    // repo cuyo release es «empujar un tag» no puede publicar nada.
    if (/^refs\/tags\//.test(ref) || /^refs\/tags\//.test(refRemoto || "")) continue;
    const rama = ref.replace(/^refs\/heads\//, "");
    // Borrar una rama remota llega con sha de ceros: no hay nada que mergear.
    const sha = /^0+$/.test(shaLocal ?? "") ? null : shaLocal;
    if (rama && rama !== "(delete)") ramas.set(rama, sha);
  }
  for (const [rama, sha] of ramas) {
    revisarRama(rama);
    revisarEdad(rama);
    if (sha) revisarSincronia(rama, sha);
  }
} else if (tiene("--sync")) {
  // El mismo chequeo que el pre-push, a mano: antes de abrir el PR, o al retomar una rama.
  const pedida = flag("--sync");
  const rama = pedida && !pedida.startsWith("--") ? pedida : git("rev-parse", "--abbrev-ref", "HEAD");
  if (!workflow.sync?.enabled) process.stdout.write("ciclo (sincronía): OMITIDO — `workflow.sync` no está activo.\n");
  else if (rama === workflow.baseBranch) process.stdout.write(`ciclo (sincronía): estás en \`${rama}\`, la base. Abrí la rama desde \`${workflow.sync.remote ?? "origin"}/${rama}\` recién bajado.\n`);
  else revisarSincronia(rama, git("rev-parse", "--verify", "--quiet", rama), { manual: true });
} else if (tiene("--commit")) {
  const archivo = flag("--commit");
  let msg = "";
  try {
    msg = fs.readFileSync(archivo, "utf8");
  } catch {
    process.exit(0);
  }
  const salteables = config.commitMsg?.skipSubjects ?? ["Merge ", "Revert ", "fixup! ", "squash! "];
  if (salteables.some((p) => msg.startsWith(p))) process.exit(0);

  const staged = git("diff", "--cached", "--name-only", "--diff-filter=ACMR").split("\n").filter(Boolean);
  const numstat = git("diff", "--cached", "--numstat")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [mas, menos, archivoStat] = l.split("\t");
      return [Number(mas) || 0, Number(menos) || 0, archivoStat ?? ""];
    });

  revisarTestPrimero(msg, staged);
  revisarLote(msg, staged, numstat);
  revisarRefactor(msg, staged);
  revisarPairing(msg);
}

if (errores.length) {
  process.stderr.write(errores.join("\n\n") + "\n\nSaltear el hook está prohibido: si el freno estorba, se arregla el freno.\n");
  process.exit(1);
}
process.exit(0);
