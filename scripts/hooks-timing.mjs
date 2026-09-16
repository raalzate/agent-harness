#!/usr/bin/env node
/**
 * hooks-timing — el costo del arnés, medido.
 *
 * Todo freno se paga en latencia, y se paga en el peor momento: en CADA prompt y en CADA
 * edición. Hasta acá eso era una creencia — la regla PUREZA prohíbe que un hook lance
 * procesos «porque cuesta latencia», y nadie había medido cuánto. Una regla defendida con
 * una intuición se discute con otra intuición; con un número se discute con datos.
 *
 * Qué mide: el tiempo de pared de cada hook declarado en `.claude/settings.json`, corrido
 * con un payload sintético por stdin, N veces, quedándose con la MEDIANA (la media la
 * arruina un arranque frío de node; el máximo, cualquier hipo del sistema operativo).
 *
 * Qué NO mide: el costo en tokens del texto que un hook inyecta al contexto. Eso también
 * es costo, y todavía no tiene comando: está declarado como deuda en STATUS.md.
 *
 * Agnóstico: no conoce ningún hook por nombre. La lista sale de `.claude/settings.json`
 * (misma fuente única que la regla EVENTOS del lint) y los presupuestos de
 * `observability` en `.claude/harness.config.json`. Sin esa clave no mide nada y deja
 * pasar: un repo portado no se pone rojo por una señal que su equipo no declaró.
 *
 * Uso:
 *   node scripts/hooks-timing.mjs              # mide y falla si algún hook excede su presupuesto
 *   node scripts/hooks-timing.mjs --rules      # qué presupuesto rige cada hook y de dónde sale
 *   node scripts/hooks-timing.mjs --json       # las mediciones crudas (traza para CI)
 *   [--config <ruta>] [--settings <ruta>]      # para los cebos del self-test (P7: sin escribir en el árbol)
 *
 * Exit: 0 = dentro de presupuesto (o sin presupuesto declarado) · 1 = alguno lo excede.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseHookCommand } from "../.claude/hooks/harness.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const abs = (p) => path.join(REPO_ROOT, p);

const args = process.argv.slice(2);
const flag = (nombre) => {
  const i = args.indexOf(nombre);
  return i === -1 ? null : (args[i + 1] ?? "");
};
const tiene = (nombre) => args.includes(nombre);

const rutaConfig = flag("--config") || abs(".claude/harness.config.json");
const rutaSettings = flag("--settings") || abs(".claude/settings.json");

/** Un config o unos settings ilegibles no bloquean a nadie: el arnés no se cae encima del humano. */
const leerJson = (ruta) => {
  try {
    return JSON.parse(fs.readFileSync(ruta, "utf8"));
  } catch {
    return null;
  }
};

const config = leerJson(rutaConfig);
const settings = leerJson(rutaSettings);
if (!config || !settings) {
  console.log("hooks-timing: no pude leer el config o los settings — nada que medir.");
  process.exit(0);
}

const obs = config.observability ?? {};
// `Number(x) || 0` NO sirve acá: un presupuesto de 0 ms es un valor DECLARADO (el cebo del
// self-test), y el atajo del || lo confundía con «no declarado» — la medición salía verde
// justo en el caso donde tenía que morder. El freno se apagaba solo en su propia prueba.
const PRESUPUESTO_BASE = obs.budgetMs === undefined ? null : Number(obs.budgetMs);
// Las claves `$…` son comentarios del propio config, no hooks. Contarlas como presupuestos
// hacía que un repo con SÓLO un `$comment` pareciera tener reglas declaradas.
const PRESUPUESTOS = Object.fromEntries(
  Object.entries(obs.budgets ?? {}).filter(([k]) => !k.startsWith("$")),
);
if (PRESUPUESTO_BASE === null && !Object.keys(PRESUPUESTOS).length) {
  console.log("hooks-timing: este repo no declara `observability.budgetMs` — sin presupuesto, no hay veredicto.");
  process.exit(0);
}

const CORRIDAS = Math.max(1, Number(obs.runs) || 3);
const probe = obs.probe ?? {};

// Sin un archivo de prueba declarado no se puede medir el peor caso: el hook que corre el lint
// del archivo tocado toma el atajo con cualquier archivo que no sea código, y la medición
// reporta el camino barato — el que no cuesta nada. Eso es peor que no medir, porque sale
// VERDE. La plantilla viaja con esto vacío a propósito: sólo el equipo del repo destino sabe
// cuál es un archivo de código suyo.
if (!probe.filePath) {
  console.log(
    "hooks-timing: OMITIDA — falta `observability.probe.filePath` (omitido no es verde).\n" +
      "Declaralo con un archivo que ESTE repo considere código (`gate.codeExtensions` +\n" +
      "`gate.codeGlobs`): con cualquier otro, el hook que lintea toma el atajo y se mide el\n" +
      "camino barato.",
  );
  process.exit(0);
}

/** El presupuesto de un hook: el suyo si lo declara, el base si no. */
/**
 * El presupuesto de un hook: el suyo si lo declara, el base si hay base, y `null` si no hay
 * ninguno de los dos.
 *
 * `null` y no 0: un repo que sólo quiere acotar el hook caro declara `budgets` y ningún
 * `budgetMs`, y con el 0 de default TODOS los demás hooks salían rojos contra un presupuesto
 * imposible — 9 de 10 en este repo. Un freno que muerde trabajo legítimo se desactiva a mano
 * en una semana y se lleva puestos a los que servían (P3). Sin presupuesto no hay veredicto:
 * el hook se mide y se reporta OMITIDO.
 */
const presupuestoDe = (archivo) => {
  if (PRESUPUESTOS[archivo] !== undefined) return Number(PRESUPUESTOS[archivo]);
  return PRESUPUESTO_BASE;
};

// ── Qué se mide ──────────────────────────────────────────────────────────────

/**
 * Los hooks declarados, con su evento y su matcher. Los nombres de evento NO se cablean
 * acá: son las claves de `settings.hooks`, que es la fuente única (regla EVENTOS del lint).
 */
function hooksDeclarados() {
  const lista = [];
  for (const [evento, grupos] of Object.entries(settings.hooks ?? {})) {
    for (const grupo of grupos ?? []) {
      for (const h of grupo.hooks ?? []) {
        const parsed = parseHookCommand(h.command);
        if (!parsed) continue;
        lista.push({ evento, matcher: grupo.matcher ?? "", ...parsed });
      }
    }
  }
  return lista;
}

/**
 * El payload sintético. Un solo objeto para todos los eventos, con los campos que cada hook
 * pueda mirar: el que no los usa los ignora, y así ningún nombre de hook entra en este script.
 *
 * `tool_name` sale del matcher del propio settings (`Write|Edit|MultiEdit` → `Write`): un
 * payload cuyo `tool_name` no case con el matcher mediría un hook que en la vida real no
 * habría corrido.
 */
function payload({ evento, matcher }) {
  const herramienta = matcher.split("|")[0].replace(/[^A-Za-z]/g, "") || "Write";
  return {
    hook_event_name: evento,
    tool_name: herramienta,
    cwd: REPO_ROOT,
    prompt: probe.prompt ?? "¿cómo está el arnés?",
    tool_input: {
      file_path: abs(probe.filePath ?? "README.md"),
      content: "x",
      command: probe.command ?? "git status",
    },
  };
}

/**
 * Los archivos de ESTADO que un hook puede tocar al correr (el marcador del gate, el de
 * `ask-first`). Medir no puede cambiar el estado de la sesión: un `gate-dirty` fabricado
 * por la medición bloquea el cierre del turno siguiente y nadie entiende por qué.
 *
 * Salen del config, no de una lista cableada: son las mismas claves que los hooks usan.
 */
const archivosDeEstado = () => {
  const declarados = obs.stateFiles;
  const lista = Array.isArray(declarados) && declarados.length
    ? declarados
    : [config.gate?.marker, config.askFirst?.marker];
  return lista.filter(Boolean).map((p) => abs(p));
};

function tomarEstado() {
  return archivosDeEstado().map((f) => ({
    f,
    existia: fs.existsSync(f),
    contenido: fs.existsSync(f) ? fs.readFileSync(f) : null,
  }));
}

function restaurarEstado(snapshot) {
  for (const s of snapshot) {
    try {
      if (s.existia) fs.writeFileSync(s.f, s.contenido);
      else fs.rmSync(s.f, { force: true });
    } catch {
      /* si no se puede restaurar, el peor caso es un marcador de más: nunca un rojo falso */
    }
  }
}

/** La ruta del hook: relativa al repo, o absoluta tal cual (los cebos viven en el temporal). */
const rutaDeHook = (file) => (path.isAbsolute(file) ? file : abs(file));

/** La mediana de N corridas: la media la arruina el arranque frío, el máximo cualquier hipo del SO. */
const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function medir(hook) {
  const entrada = JSON.stringify(payload(hook));
  const muestras = [];
  let roto = null;
  for (let i = 0; i < CORRIDAS; i += 1) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync("node", [rutaDeHook(hook.file)], { input: entrada, encoding: "utf8" });
    muestras.push(Number(process.hrtime.bigint() - t0) / 1e6);
    // Contrato de los hooks: 0 = seguir, 2 = bloquear. Cualquier otra cosa es un hook que
    // reventó al arrancar — y un hook roto mide rapidísimo, así que sin esta comprobación
    // "barato" y "roto" se ven exactamente igual, los dos en verde.
    if (r.status !== 0 && r.status !== 2) {
      roto = `exit ${r.status}: ${(r.stderr ?? "").trim().split("\n")[0] || "sin mensaje"}`;
    }
  }
  return { muestras, roto, ms: Math.round(mediana(muestras)) };
}

// ── --rules: qué está activo y de dónde sale ─────────────────────────────────

if (tiene("--rules")) {
  console.log("Presupuesto de latencia de los hooks (observability)\n");
  console.log(`  base:     ${PRESUPUESTO_BASE === null ? "(sin base)" : PRESUPUESTO_BASE} ms por hook`);
  console.log(`  corridas: ${CORRIDAS} (se reporta la mediana)`);
  for (const h of hooksDeclarados()) {
    const propio = PRESUPUESTOS[h.file] !== undefined ? " (propio)" : "";
    const p = presupuestoDe(h.file);
    console.log(`  ${h.evento.padEnd(16)} ${h.file.padEnd(38)} ${String(p === null ? "—" : p).padStart(5)} ms${propio}`);
  }
  if (obs.reason) console.log(`\nMotivo: ${obs.reason}`);
  process.exit(0);
}

// ── Medición ─────────────────────────────────────────────────────────────────

const hooks = hooksDeclarados();
if (!hooks.length) {
  console.log("hooks-timing: `settings.hooks` no declara ningún hook — nada que medir.");
  process.exit(0);
}

const snapshot = tomarEstado();
const filas = [];
for (const h of hooks) {
  if (h.tipo !== "script" || !fs.existsSync(rutaDeHook(h.file))) {
    filas.push({ ...h, omitido: "no es un script de este repo (no se puede medir su costo acá)" });
    continue;
  }
  const presupuesto = presupuestoDe(h.file);
  const { ms, muestras, roto } = medir(h);
  if (roto) filas.push({ ...h, ms, muestras, presupuesto, roto });
  else if (presupuesto === null) filas.push({ ...h, ms, muestras, omitido: `sin presupuesto declarado — midió ${ms} ms` });
  else filas.push({ ...h, ms, muestras, presupuesto });
}
restaurarEstado(snapshot);

if (tiene("--json")) {
  console.log(JSON.stringify({ runs: CORRIDAS, rows: filas }, null, 2));
}

const excedidos = filas.filter((f) => !f.omitido && !f.roto && f.ms > f.presupuesto);
const rotos = filas.filter((f) => f.roto);

if (!tiene("--json")) {
  console.log(`Latencia de los hooks (mediana de ${CORRIDAS} corridas)\n`);
  for (const f of filas) {
    if (f.omitido) {
      console.log(`  – ${f.etiqueta} — OMITIDO: ${f.omitido}`);
      continue;
    }
    if (f.roto) {
      console.log(`  ✗ ${f.evento.padEnd(16)} ${f.file.padEnd(38)} ROTO — ${f.roto}`);
      continue;
    }
    const marca = f.ms > f.presupuesto ? "✗" : "✓";
    console.log(`  ${marca} ${f.evento.padEnd(16)} ${f.file.padEnd(38)} ${String(f.ms).padStart(5)} ms  (presupuesto ${f.presupuesto} ms)`);
  }

  // El número que de verdad importa no es el de un hook: es lo que el arnés le cuesta al
  // agente en un turno completo, que es la suma de los hooks del mismo evento.
  console.log("\nCosto por evento (lo que el arnés agrega a un turno):");
  for (const evento of [...new Set(filas.map((f) => f.evento))]) {
    const total = filas.filter((f) => f.evento === evento && f.ms !== undefined).reduce((a, f) => a + f.ms, 0);
    console.log(`  ${evento.padEnd(16)} ${String(total).padStart(5)} ms`);
  }
}

if (rotos.length) {
  console.error(
    `\nMEDICIÓN EN ROJO — ${rotos.length} hook(s) no respetan el contrato de exit codes: ` +
      `${rotos.map((f) => f.file).join(", ")}`,
  );
  console.error("Un hook que revienta al arrancar mide rapidísimo y parecería el más barato de todos.");
  process.exit(1);
}

if (excedidos.length) {
  console.error(
    `\nLATENCIA EN ROJO — ${excedidos.length} hook(s) sobre presupuesto: ${excedidos.map((f) => f.file).join(", ")}`,
  );
  console.error(
    "Un hook lento se paga en cada edición y en cada prompt. Sacale el proceso que lanza, o subí\n" +
      "el presupuesto en `observability.budgets` DEJANDO ESCRITO por qué vale la pena.",
  );
  process.exit(1);
}
console.log("\nLATENCIA VERDE — todos los hooks dentro de presupuesto.");
