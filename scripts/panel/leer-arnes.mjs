/**
 * La SALUD del arnés, como dato: ¿cada pieza instalada está viva? Determinista y sin procesos:
 * lee el config, los settings y el disco. Lo que corrió de verdad (el registro del gate) es de la
 * capa en vivo.
 *
 * Cada chequeo es la versión «para mirar» de algo que un freno ya exige en otro lado —el mapa de
 * `harness-map`, los activadores del instalador, el `why` de cada señal (P6), el `runner` de los
 * controles fuera del gate (ADR 0007)—. El panel no inventa criterios: si acá aparece una alarma,
 * hay un comando que ya la ponía en rojo, y la alarma lo nombra.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { construirMapa } from "../harness-map.mjs";
import { parseHookCommand } from "../../.claude/hooks/harness.mjs";

/**
 * Una colección de reglas del config, venga como venga. Otra versión del arnés (o un repo que la
 * escribió a mano) declara a veces UNA regla suelta en vez de una lista —`purity: { dir, … }`—:
 * eso es una regla, no un error. Cualquier otra forma es una lista vacía, nunca una excepción: el
 * panel de un repo con un config raro tiene que salir igual y mostrar lo que sí entiende.
 */
export const comoLista = (x) => (Array.isArray(x) ? x.filter((y) => y && typeof y === "object") : x && typeof x === "object" ? [x] : []);
export const comoMapa = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});

/** `a.b.c` sobre un objeto: ¿la clave existe y tiene algo? Un array vacío es una clave muerta. */
export function claveViva(obj, ruta) {
  let v = obj;
  for (const parte of String(ruta).split(".")) {
    if (v === null || typeof v !== "object" || !(parte in v)) return false;
    v = v[parte];
  }
  if (Array.isArray(v)) return v.length > 0;
  return v !== null && v !== undefined && v !== "";
}

/** Toda clave del config que declara un `runner`: un control que vive en un pipeline y no en el gate. */
export function controlesConRunner(config) {
  const salida = [];
  for (const [clave, valor] of Object.entries(config ?? {})) {
    if (clave.startsWith("$") || !valor || typeof valor !== "object" || typeof valor.runner !== "string") continue;
    salida.push({ clave, runner: valor.runner });
  }
  return salida;
}

/**
 * Los controles del arnés que viven FUERA del gate (ADR 0007): encendidos, tienen que declarar su
 * `runner` y ese pipeline tiene que invocarlos. Es la misma exigencia que el self-test hace con
 * `corredorDeclarado`; acá se ve. `encendido` dice cuándo la clave pide pipeline.
 */
export const CONTROLES_FUERA_DEL_GATE = [
  { clave: "drift", invocacion: "scripts/drift-check.mjs", encendido: (v) => Boolean(v) },
  { clave: "reviewerEval", invocacion: "scripts/reviewer-eval.mjs", encendido: (v) => Boolean(v) },
  { clave: "xp.testFirst.verifyRed", invocacion: "--verify-red", encendido: (v) => Boolean(v?.enabled) },
];

const valorEn = (obj, ruta) => String(ruta).split(".").reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), obj);

export function construirArnes(raiz, { config = {}, settings = {} } = {}) {
  const existe = (rel) => existsSync(path.join(raiz, rel));
  const alarmas = [];

  const mapa = construirMapa({ config, settings, raiz });
  if (mapa) for (const s of mapa.sinClasificar) alarmas.push({ que: s, comando: "node scripts/harness-map.mjs" });

  // Hooks declarados: existen, y si lanzan procesos, están en la excepción declarada.
  const excepciones = new Set(comoLista(config.purity).flatMap((p) => (Array.isArray(p.except) ? p.except : [])));
  const presupuestos = comoMapa(config.observability?.budgets);
  const hooks = [];
  for (const [evento, grupos] of Object.entries(comoMapa(settings.hooks)))
    for (const g of comoLista(grupos))
      for (const h of comoLista(g.hooks)) {
        const c = parseHookCommand(h.command);
        const archivo = c?.file ?? String(h.command ?? "");
        const ok = c?.tipo !== "script" || existe(archivo);
        if (!ok) alarmas.push({ que: `el hook \`${archivo}\` (${evento}) está declarado y no existe`, comando: "node scripts/harness-selftest.mjs" });
        hooks.push({
          evento,
          matcher: g.matcher ?? "*",
          archivo,
          tipo: c?.tipo ?? "ejecutable",
          existe: ok,
          lanzaProcesos: excepciones.has(archivo),
          presupuestoMs: presupuestos[archivo] ?? config.observability?.budgetMs ?? null,
        });
      }

  // Activadores: el freno copiado sin su clave queda «instalado y muerto».
  const activadores = Object.entries(comoMapa(config.install?.activators))
    .filter(([archivo]) => !archivo.startsWith("$"))
    .map(([archivo, clave]) => {
      const instalado = existe(archivo);
      const viva = claveViva(config, clave);
      const estado = !instalado ? "no instalado" : viva ? "activo" : "instalado y muerto";
      if (estado === "instalado y muerto") alarmas.push({ que: `\`${archivo}\` está instalado y \`${clave}\` no está en el config: no frena nada`, comando: "node scripts/harness-selftest.mjs" });
      return { archivo, clave, instalado, viva, estado };
    });

  // Señales: cada una con su `why` (P6); las que dependen de una ruta que hoy falta salen OMITIDAS.
  const senales = comoLista(config.gate?.signals).map((s) => {
    const omitidaHoy = Boolean(s.skipIfMissing) && !existe(s.skipIfMissing);
    const argv = Array.isArray(s.command) ? s.command : [];
    const script = argv.find((a) => typeof a === "string" && /\//.test(a) && existe(a)) ?? null;
    if (!s.why) alarmas.push({ que: `la señal «${s.name}» no declara \`why\` (P6)`, comando: "node scripts/harness-selftest.mjs" });
    return { nombre: s.name, comando: argv.join(" "), script, why: s.why ?? "", fastSkip: Boolean(s.fastSkip), skipIfMissing: s.skipIfMissing ?? null, omitidaHoy };
  });
  if (!senales.length) alarmas.push({ que: "`gate.signals` está vacío: el gate no verifica nada", comando: "node scripts/gate.mjs" });

  // Controles fuera del gate: encendido y sin nadie que lo corra es «instalado y muerto».
  const runners = controlesConRunner(config).map(({ clave, runner }) => {
    const ok = existe(runner);
    if (!ok) alarmas.push({ que: `\`${clave}.runner\` apunta a \`${runner}\`, que no existe: el control no lo corre nadie`, comando: "node scripts/harness-selftest.mjs" });
    return { clave, runner, existe: ok };
  });
  // Encendido y SIN runner, o con un runner que no lo invoca: el hueco que el cebo del reviewer
  // destapó en un repo recién portado (el self-test rojo y el panel «sin alarmas»).
  for (const c of CONTROLES_FUERA_DEL_GATE) {
    const v = valorEn(config, c.clave);
    if (!c.encendido(v)) continue;
    const runner = typeof v?.runner === "string" ? v.runner : null;
    if (!runner) {
      alarmas.push({ que: `\`${c.clave}\` está encendido y no declara \`runner\`: nadie lo corre`, comando: "node scripts/harness-selftest.mjs" });
      runners.push({ clave: c.clave, runner: "—", existe: false });
    } else if (existe(runner) && !readFileSync(path.join(raiz, runner), "utf8").includes(c.invocacion) && !invocaPorTarea(raiz, runner, c.invocacion, config.panel?.tasks)) {
      alarmas.push({ que: `\`${runner}\` no invoca \`${c.invocacion}\`: \`${c.clave}\` encendido y muerto`, comando: "node scripts/harness-selftest.mjs" });
    }
  }

  // Subagentes y comandos: lo que el agente puede invocar.
  const listar = (dir, ext) => {
    try {
      return readdirSorted(path.join(raiz, dir)).filter((f) => f.endsWith(ext));
    } catch {
      return [];
    }
  };
  const agentes = listar(".claude/agents", ".md").map((f) => f.replace(/\.md$/, ""));
  const comandos = listar(".claude/commands", ".md").map((f) => f.replace(/\.md$/, ""));
  const skills = (() => {
    try {
      return readdirSorted(path.join(raiz, ".claude/skills")).filter((d) => existe(`.claude/skills/${d}/SKILL.md`));
    } catch {
      return [];
    }
  })();

  return { mapa, hooks, activadores, senales, runners, agentes, comandos, skills, alarmas };
}

const readdirSorted = (dir) => readdirSync(dir).sort();

/**
 * El pipeline puede invocar el script directo o por una tarea del manifiesto que lo corre. Cómo se
 * invoca una tarea lo dice `panel.tasks`: sin eso, sólo cuenta la invocación directa.
 */
function invocaPorTarea(raiz, runner, invocacion, tasks) {
  if (!tasks?.manifest || !tasks.key || !tasks.invocation) return false;
  try {
    const tareas = JSON.parse(readFileSync(path.join(raiz, tasks.manifest), "utf8"))[tasks.key] ?? {};
    const texto = readFileSync(path.join(raiz, runner), "utf8");
    return Object.entries(tareas).some(([n, c]) => String(c).includes(invocacion) && texto.includes(`${tasks.invocation} ${n}`));
  } catch {
    return false;
  }
}
