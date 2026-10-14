#!/usr/bin/env node
/**
 * La tarea declarada — planificar antes de escribir, no salirse de lo planificado, y que
 * «terminado» lo demuestre el arnés (#52 alcance, #53 criterios con evidencia).
 *
 * XP con un agente: el agente decide, el arnés verifica. Hasta acá el arnés sabía si el repo
 * estaba sano (el gate) pero no QUÉ se había pedido, así que «terminé» era la palabra del agente.
 * Con la tarea declarada el pedido queda escrito —ítem, alcance, criterios— y cada criterio trae
 * el comando que lo demuestra, que el arnés corre él.
 *
 *   node scripts/task.mjs start <ítem> [--from-tracker]   abre la tarea (criterios del gestor)
 *   node scripts/task.mjs scope <ruta|glob>… --why "…"    declara o amplía el alcance, con motivo
 *   node scripts/task.mjs criterion "<texto>"             agrega un criterio de aceptación
 *   node scripts/task.mjs evidence <n> -- <argv…>         el comando que demuestra el criterio n
 *   node scripts/task.mjs status                          qué falta
 *   node scripts/task.mjs verify                          la señal del gate (exit 1 = no terminado)
 *   node scripts/task.mjs done                            cierra la tarea, sólo en verde
 *   node scripts/task.mjs abandon --why "…"               la descarta, con motivo
 *
 * Todo lo específico sale de `task` en el config. El archivo vive en `.git/` (P7): es estado de
 * ESTA sesión de trabajo, no del repo. Sin `task` en el config, el script no hace nada.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, CONFIG_PATH, resolverEjecutable, dentroDelAlcance, firstMatch, rutaDeEstado } from "../.claude/hooks/harness.mjs";

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
} catch {
  console.log("task: sin config legible — sin tarea que verificar.");
  process.exit(0);
}
const spec = config.task;
if (!spec?.file) {
  console.log("task: este repo no declara `task` en el config — sin tarea que verificar.");
  process.exit(0);
}

// `rutaDeEstado`: en un worktree `.git` es un archivo, y la tarea va al gitdir real (el mismo que lee el hook).
const ARCHIVO = rutaDeEstado(spec.file);
const [orden, ...resto] = process.argv.slice(2);

const leer = () => {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO, "utf8"));
  } catch {
    return null;
  }
};
const guardar = (t) => {
  try {
    fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
    fs.writeFileSync(ARCHIVO, JSON.stringify(t, null, 2) + "\n");
  } catch (e) {
    fallar(`no pude escribir la tarea en ${ARCHIVO}: ${e.message}`);
  }
};
const git = (...args) => {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout : null;
};
/** El valor de `--nombre "<valor>"`, o null. */
const opcion = (nombre) => {
  const i = resto.indexOf(nombre);
  return i >= 0 && resto[i + 1] && !resto[i + 1].startsWith("--") ? resto[i + 1] : null;
};
const fallar = (msg) => {
  console.error(`task: ${msg}`);
  process.exit(1);
};
const exigirTarea = () => leer() ?? fallar(`no hay tarea activa. Abrila con \`node scripts/task.mjs start <ítem>\`.`);

/** La línea de comandos de una evidencia, como la lee una persona (y como la comparan las reglas). */
const comoTexto = (argv) => argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ");

/**
 * ¿Por qué esta evidencia no sirve? null si sirve. Se pregunta al registrarla Y al verificar:
 * el config puede haber cambiado en el medio, y una evidencia que hoy está prohibida no se corre.
 *
 * Lo prohibido por `bash.deny`/`bash.ask` se rechaza porque la verificación la ejecuta el gate,
 * no el agente por Bash: sin este chequeo, declarar `git push --force` como evidencia era la
 * forma de que el arnés corriera lo que `bash-guard` le frena al agente.
 */
function evidenciaInvalida(argv) {
  if (!Array.isArray(argv) || !argv.length || !argv[0]) return "sin comando";
  const texto = comoTexto(argv);
  const trivial = (spec.trivialEvidence ?? []).find((p) => {
    try {
      return new RegExp(p, "i").test(texto.trim());
    } catch {
      return false;
    }
  });
  if (trivial) return `\`${texto}\` pasa siempre (casa \`${trivial}\` de \`task.trivialEvidence\`): no demuestra nada`;
  const prohibido = firstMatch(config.bash?.deny, texto) ?? firstMatch(config.bash?.ask, texto);
  if (prohibido) return `\`${texto}\` está en \`bash.deny\`/\`bash.ask\` (${prohibido.reason}) y la verificación la ejecutaría el gate sin preguntar`;
  return null;
}

/**
 * Los archivos que cambiaron desde que empezó la tarea: commiteados, sin commitear y nuevos. null
 * si git no pudo decirlo — y eso es ROJO, no «nada cambió»: con una base que git ya no conoce
 * (rebase + gc, clon shallow) la verificación salía verde con un archivo de afuera staged.
 *
 * `--no-renames`: con detección de renombres, mover un archivo de afuera hacia el alcance listaba
 * sólo el nombre nuevo, y el borrado de afuera desaparecía.
 */
function cambiados(tarea) {
  const salidas = tarea.base
    ? [git("diff", "--name-only", "--no-renames", tarea.base)]
    : // Repo sin commits al empezar: no hay base contra la que comparar, sólo el índice y el árbol.
      [git("diff", "--name-only", "--no-renames", "--cached"), git("diff", "--name-only", "--no-renames")];
  salidas.push(git("ls-files", "--others", "--exclude-standard"));
  if (salidas.some((x) => x === null)) return null;
  const lista = new Set();
  for (const salida of salidas) for (const l of salida.split("\n")) if (l.trim()) lista.add(l.trim());
  return [...lista].sort();
}

/** Un alcance que abarca todo el repo no es un alcance: es apagar el freno con un motivo. */
const esTodoElRepo = (ruta) => /^(\.?\/?|\/|(\*+\/?)+(\*+\.?\*?)?)$/.test(String(ruta).split("\\").join("/").trim());

/** Verifica la tarea. Devuelve la lista de faltas (vacía = terminada) e imprime el detalle. */
function verificar(tarea) {
  const faltas = [];
  console.log(`tarea ${tarea.item}${tarea.titulo ? ` — ${tarea.titulo}` : ""}`);

  if (!tarea.alcance?.length) faltas.push("no hay alcance declarado (`scope <ruta> --why`)");
  const lista = cambiados(tarea);
  if (lista === null) {
    console.log(`  ✗ alcance — no pude calcular qué cambió desde ${tarea.base ?? "el inicio"} (¿la base ya no existe?). Sin diff no hay verificación.`);
    faltas.push("no pude calcular el diff de la tarea");
  }
  const afuera = (lista ?? []).filter((f) => !dentroDelAlcance(f, tarea.alcance));
  if (afuera.length) {
    console.log(`  ✗ alcance — cambió fuera de lo declarado:\n${afuera.map((f) => `      ${f}`).join("\n")}`);
    faltas.push(`${afuera.length} archivo(s) fuera del alcance`);
  } else if (lista && tarea.alcance?.length) console.log(`  ✓ alcance — todo lo cambiado cae en: ${tarea.alcance.map((a) => a.ruta).join(", ")}`);

  if (!tarea.criterios?.length) faltas.push("la tarea no tiene criterios de aceptación: sin criterios no hay definición de terminado");
  for (const [i, c] of (tarea.criterios ?? []).entries()) {
    const n = i + 1;
    if (!c.evidencia) {
      console.log(`  ✗ ${n}. ${c.texto} — sin evidencia (\`evidence ${n} -- <comando>\`)`);
      faltas.push(`criterio ${n} sin evidencia`);
      continue;
    }
    const invalida = evidenciaInvalida(c.evidencia);
    if (invalida) {
      console.log(`  ✗ ${n}. ${c.texto} — ${invalida}`);
      faltas.push(`criterio ${n}: evidencia inválida`);
      continue;
    }
    // Sin shell, como el gate: ningún dato de la tarea se interpola en una línea de comandos.
    const r = spawnSync(resolverEjecutable(c.evidencia[0]), c.evidencia.slice(1), {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: Number(spec.timeoutMs) > 0 ? Number(spec.timeoutMs) : 600000,
      windowsHide: true,
    });
    if (r.status === 0) console.log(`  ✓ ${n}. ${c.texto} — \`${comoTexto(c.evidencia)}\``);
    else {
      // Una evidencia que no pudo correr NO es una evidencia que pasó: omitido no es verde.
      const motivo = r.error ? `no corrió (${r.error.code ?? r.error.message})` : `salió con ${r.status}`;
      const cola = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-3).join(" ⏎ ").slice(0, 300);
      console.log(`  ✗ ${n}. ${c.texto} — \`${comoTexto(c.evidencia)}\` ${motivo}${cola ? `: ${cola}` : ""}`);
      faltas.push(`criterio ${n}: la evidencia falla`);
    }
  }
  return faltas;
}

/** Deja la tarea en el registro (`task.log`): de ahí salen los indicadores (#50 §5). */
function registrar(tarea, verificada, motivo) {
  if (!spec.log) return;
  const linea = {
    fecha: new Date().toISOString(),
    item: tarea.item,
    verificada,
    criterios: tarea.criterios?.length ?? 0,
    // El alcance entero, con el motivo de cada entrada: un reviewer tiene que poder ver QUÉ se
    // amplió y por qué, no sólo cuántas veces.
    alcance: tarea.alcance ?? [],
    ampliaciones: Math.max(0, (tarea.alcance?.length ?? 0) - 1),
    ...(motivo ? { motivo } : {}),
  };
  try {
    const destino = rutaDeEstado(spec.log);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.appendFileSync(destino, JSON.stringify(linea) + "\n");
  } catch {
    /* un registro que no se pudo escribir es un indicador menos, no una tarea sin cerrar */
  }
}

switch (orden) {
  case "start": {
    const item = resto.find((a) => !a.startsWith("--"));
    if (!item) fallar("falta el ítem: `start <ítem>` (el número del issue, la clave del ticket).");
    const previa = leer();
    if (previa) fallar(`ya hay una tarea activa (${previa.item}). Cerrala con \`done\` o descartala con \`abandon --why "…"\`.`);
    const tarea = { item, inicio: new Date().toISOString(), base: (git("rev-parse", "HEAD") ?? "").trim() || null, alcance: [], criterios: [] };
    if (resto.includes("--from-tracker")) {
      const plantilla = spec.criteriaCommand ?? [];
      if (!plantilla.length) fallar("`--from-tracker` necesita `task.criteriaCommand` en el config.");
      const argv = plantilla.map((a) => String(a).split("{issue}").join(item));
      const r = spawnSync(resolverEjecutable(argv[0]), argv.slice(1), { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
      if (r.status !== 0) fallar(`no pude leer el ítem ${item} del gestor (\`${comoTexto(argv)}\`): ${`${r.stderr ?? r.error?.message ?? ""}`.trim().split("\n")[0]}`);
      let re;
      try {
        re = new RegExp(spec.criterionPattern ?? "^\\s*[-*]\\s+\\[[ xX]\\]\\s+(.+)$");
      } catch {
        fallar("`task.criterionPattern` no compila.");
      }
      for (const l of r.stdout.split(/\r?\n/)) {
        const m = l.match(re);
        if (m?.[1]) tarea.criterios.push({ texto: m[1].trim(), evidencia: null });
      }
      if (!tarea.criterios.length) console.log(`  (el ítem ${item} no trae casillas de criterios: agregalos con \`criterion\`)`);
    }
    guardar(tarea);
    console.log(`tarea ${item} abierta con ${tarea.criterios.length} criterio(s). Siguiente: declarar el alcance — \`scope <ruta> --why "…"\`.`);
    break;
  }
  case "scope": {
    const tarea = exigirTarea();
    const motivo = opcion("--why");
    const rutas = resto.filter((a, i) => !a.startsWith("--") && resto[i - 1] !== "--why");
    if (!rutas.length) fallar("falta la ruta o el glob: `scope src/ --why \"…\"`.");
    // Ampliar el alcance es legítimo; hacerlo en silencio, no. El motivo queda en la tarea.
    if (!motivo?.trim()) fallar("declarar o ampliar el alcance exige motivo: `--why \"<por qué esto entra en la tarea>\"`.");
    const todo = rutas.filter(esTodoElRepo);
    if (todo.length) fallar(`\`${todo.join(" ")}\` abarca todo el repo: eso no es un alcance. Nombrá los directorios o archivos que la tarea toca.`);
    for (const ruta of rutas) if (!tarea.alcance.some((a) => a.ruta === ruta)) tarea.alcance.push({ ruta, motivo, fecha: new Date().toISOString() });
    guardar(tarea);
    console.log(`alcance: ${tarea.alcance.map((a) => a.ruta).join(", ")}`);
    break;
  }
  case "criterion": {
    const tarea = exigirTarea();
    const texto = resto.join(" ").trim();
    if (!texto) fallar("falta el texto del criterio.");
    tarea.criterios.push({ texto, evidencia: null });
    guardar(tarea);
    console.log(`criterio ${tarea.criterios.length}: ${texto}`);
    break;
  }
  case "evidence": {
    const tarea = exigirTarea();
    const n = Number(resto[0]);
    const corte = resto.indexOf("--");
    const argv = corte >= 0 ? resto.slice(corte + 1) : [];
    if (!Number.isInteger(n) || n < 1 || n > tarea.criterios.length) fallar(`no hay criterio ${resto[0]} (hay ${tarea.criterios.length}).`);
    const invalida = evidenciaInvalida(argv);
    if (invalida) fallar(`evidencia rechazada: ${invalida}. La evidencia es el comando que FALLA si el criterio no se cumple (un test, un script de verificación).`);
    tarea.criterios[n - 1].evidencia = argv;
    guardar(tarea);
    console.log(`criterio ${n} ← \`${comoTexto(argv)}\``);
    break;
  }
  case "status": {
    const tarea = leer();
    if (!tarea) {
      console.log("sin tarea activa.");
      break;
    }
    console.log(`tarea ${tarea.item} (desde ${tarea.inicio})`);
    console.log(`  alcance: ${tarea.alcance.length ? tarea.alcance.map((a) => `${a.ruta} («${a.motivo}»)`).join(", ") : "SIN DECLARAR — no se puede editar"}`);
    for (const [i, c] of tarea.criterios.entries()) console.log(`  ${c.evidencia ? "·" : "✗"} ${i + 1}. ${c.texto}${c.evidencia ? ` ← \`${comoTexto(c.evidencia)}\`` : " — sin evidencia"}`);
    break;
  }
  case "verify": {
    const tarea = leer();
    if (!tarea) {
      console.log("task: sin tarea activa — nada que verificar (omitido no es verde).");
      break;
    }
    const faltas = verificar(tarea);
    if (faltas.length) {
      console.log(`TAREA NO TERMINADA — ${faltas.join(" · ")}.`);
      process.exitCode = 1;
    } else console.log("TAREA VERIFICADA — cada criterio con su evidencia pasando y todo dentro del alcance.");
    break;
  }
  case "done": {
    const tarea = exigirTarea();
    const faltas = verificar(tarea);
    if (faltas.length) fallar(`no se cierra una tarea en rojo: ${faltas.join(" · ")}. Si se decidió no terminarla, \`abandon --why "…"\`.`);
    registrar(tarea, true);
    fs.rmSync(ARCHIVO, { force: true });
    console.log(`tarea ${tarea.item} cerrada y registrada.`);
    break;
  }
  case "abandon": {
    const tarea = exigirTarea();
    const motivo = opcion("--why");
    if (!motivo?.trim()) fallar("descartar una tarea exige motivo: `abandon --why \"…\"`.");
    registrar(tarea, false, motivo);
    fs.rmSync(ARCHIVO, { force: true });
    console.log(`tarea ${tarea.item} descartada: ${motivo}`);
    break;
  }
  default:
    console.log("uso: node scripts/task.mjs start|scope|criterion|evidence|status|verify|done|abandon (ver el encabezado del script)");
    if (orden) process.exitCode = 1;
}
