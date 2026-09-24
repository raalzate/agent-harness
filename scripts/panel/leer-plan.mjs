/**
 * El burn-down del plan, DERIVADO de los datos: sin reloj, sin estimaciones, sin nada escrito a
 * mano. La serie se arma con las fechas que traen los datos —la de cada commit que movió una
 * casilla, o la de alta y cierre de cada ítem del gestor—, nunca con «hoy»: con los mismos datos,
 * el mismo burn-down, en cualquier máquina y cualquier día.
 *
 * De dónde sale el plan depende del caso, y lo dice el config (`tracker.artifactsIn`):
 *
 *   repo     las casillas de los archivos del plan (`- [ ]` / `- [x]`), recorridas por el
 *            historial de git de la rama principal: UN solo `git log`, que ve el diff de cada
 *            commit y suma lo que agrega y lo que quita. Versionado: igual para todo el equipo.
 *   tracker  los ítems que devuelve `panel.tracker.command`, con `createdAt` y `closedAt`. Es la
 *            MISMA respuesta que ya usa el panel para las citas: ninguna llamada de más.
 *   none     sin plan: la sección sale OMITIDA con su motivo, nunca «0 %». Un plan vacío y uno
 *            que no existe no se pueden ver igual.
 *
 * Lo que este número NO afirma: es conteo de ítems, no esfuerzo; cerrado no es entregado; y un
 * alcance que crece se ve crecer —no se esconde como avance que baja.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const CASILLAS_POR_DEFECTO = { done: "^\\s*[-*+] \\[[xX]\\]", pending: "^\\s*[-*+] \\[ \\]" };

/** La especificación del plan ya resuelta. `source: "auto"` sigue a `tracker.artifactsIn`. */
export function specDelPlan(config = {}) {
  const p = config.panel?.plan ?? {};
  const dondeViven = config.tracker?.artifactsIn ?? null;
  const pedido = p.source ?? "auto";
  const fuente = pedido === "auto" ? (dondeViven === "repo" ? "repo" : dondeViven === "tracker" ? "tracker" : "none") : pedido;
  const specs = config.tracker?.specsDir ?? config.sdd?.specsDir ?? "specs";
  return {
    fuente,
    pedido,
    files: Array.isArray(p.files) && p.files.length ? p.files : [`${specs}/**/tasks.md`],
    done: p.done ?? CASILLAS_POR_DEFECTO.done,
    pending: p.pending ?? CASILLAS_POR_DEFECTO.pending,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(p.dueDate ?? "") ? p.dueDate : null,
    branch: p.branch ?? config.workflow?.baseBranch ?? null,
  };
}

const compilar = (patron) => {
  try {
    return new RegExp(patron);
  } catch {
    return null;
  }
};

/** Cuántas casillas hechas y pendientes tiene un texto. */
export function contarCasillas(texto, spec) {
  const hecha = compilar(spec.done);
  const pendiente = compilar(spec.pending);
  let hechas = 0;
  let pendientes = 0;
  for (const l of String(texto ?? "").split("\n")) {
    if (hecha?.test(l)) hechas += 1;
    else if (pendiente?.test(l)) pendientes += 1;
  }
  return { hechas, pendientes };
}

/**
 * `git log -p` → serie. Cada línea agregada o quitada que es casilla suma o resta; el acumulado al
 * final de cada DÍA es un punto. Pura: el texto entra, la serie sale.
 */
export function serieDesdeHistorial(log, spec) {
  const hecha = compilar(spec.done);
  const pendiente = compilar(spec.pending);
  const porDia = new Map();
  let hechas = 0;
  let pendientes = 0;
  let dia = null;
  for (const linea of String(log ?? "").split("\n")) {
    const c = /^@@commit (\S+) (\d{4}-\d{2}-\d{2})$/.exec(linea);
    if (c) {
      dia = c[2];
      continue;
    }
    if (!dia || linea.startsWith("+++") || linea.startsWith("---")) continue;
    const signo = linea[0] === "+" ? 1 : linea[0] === "-" ? -1 : 0;
    if (!signo) continue;
    const cuerpo = linea.slice(1);
    if (hecha?.test(cuerpo)) hechas += signo;
    else if (pendiente?.test(cuerpo)) pendientes += signo;
    else continue;
    porDia.set(dia, { fecha: dia, total: hechas + pendientes, hechas });
  }
  return [...porDia.values()];
}

/**
 * Ítems del gestor → serie. Un alta suma alcance el día de `createdAt`; un cierre suma hecho el
 * día de `closedAt`. Los ítems sin `createdAt` no se inventan: se cuentan aparte. Los que el
 * gestor marca `inPlan: false` (vinieron sólo porque la memoria los cita) no son alcance.
 */
export function serieDesdeEventos(items) {
  const dia = (x) => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null);
  const eventos = [];
  let sinFecha = 0;
  for (const it of items ?? []) {
    if (it.inPlan === false) continue;
    const alta = dia(it.createdAt);
    if (!alta) {
      sinFecha += 1;
      continue;
    }
    eventos.push([alta, 1, 0]);
    const cierre = dia(it.closedAt);
    if (cierre) eventos.push([cierre < alta ? alta : cierre, 0, 1]);
  }
  eventos.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const porDia = new Map();
  let total = 0;
  let hechas = 0;
  for (const [f, t, h] of eventos) {
    total += t;
    hechas += h;
    porDia.set(f, { fecha: f, total, hechas });
  }
  return { serie: [...porDia.values()], sinFecha };
}

/** El resumen y la línea ideal. La ideal existe sólo con `dueDate`: sin fecha objetivo no se inventa ritmo. */
export function resumirPlan(serie, dueDate = null) {
  if (!serie.length) return null;
  const ultimo = serie[serie.length - 1];
  const primero = serie[0];
  const ideal = dueDate && dueDate > primero.fecha ? [{ fecha: primero.fecha, pendientes: primero.total - primero.hechas }, { fecha: dueDate, pendientes: 0 }] : null;
  return {
    desde: primero.fecha,
    hasta: ultimo.fecha,
    total: ultimo.total,
    hechas: ultimo.hechas,
    pendientes: ultimo.total - ultimo.hechas,
    pct: ultimo.total ? Math.round((ultimo.hechas / ultimo.total) * 100) : 0,
    alcanceInicial: primero.total,
    ideal,
    dueDate,
  };
}

const omitido = (spec, motivo) => ({ fuente: spec.fuente, estado: "omitido", motivo, serie: [], resumen: null });

/**
 * El plan que vive en el repo. `git` se inyecta (el self-test lo prueba sin procesos reales).
 * Dos llamadas: el historial de la rama principal y qué archivos del plan hay hoy en el árbol.
 */
export function leerPlanDelRepo(raiz, spec, git) {
  const pathspec = spec.files.map((f) => `:(glob)${f}`);
  const rama = spec.branch && git(raiz, ["rev-parse", "--verify", "--quiet", spec.branch]).trim() ? spec.branch : "HEAD";
  // `--first-parent` + el diff del merge contra su primer padre: la historia de la rama principal
  // tal como quedó, sin contar dos veces lo que entró por un merge.
  const log = git(raiz, ["log", rama, "--reverse", "--first-parent", "--diff-merges=first-parent", "--no-renames", "-p", "--unified=0", "--format=@@commit %h %cs", "--", ...pathspec]);
  const serie = serieDesdeHistorial(log, spec);

  // El árbol de trabajo también es dato: lo que se tildó y todavía no se commiteó se ve, marcado.
  const archivos = git(raiz, ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...pathspec])
    .split("\n")
    .filter(Boolean)
    .sort();
  let hechas = 0;
  let pendientes = 0;
  for (const rel of archivos) {
    const abs = path.join(raiz, rel);
    if (!existsSync(abs)) continue;
    const c = contarCasillas(readFileSync(abs, "utf8"), spec);
    hechas += c.hechas;
    pendientes += c.pendientes;
  }
  const ultimo = serie[serie.length - 1];
  const sinCommitear = !ultimo ? hechas + pendientes > 0 : ultimo.total !== hechas + pendientes || ultimo.hechas !== hechas;
  if (sinCommitear) serie.push({ fecha: null, total: hechas + pendientes, hechas, sinCommitear: true });

  if (!serie.length) return omitido(spec, `ningún archivo de ${spec.files.join(", ")} tiene casillas (\`- [ ]\` / \`- [x]\`) en la historia de ${rama}`);
  const conFecha = serie.filter((p) => p.fecha);
  return { fuente: "repo", estado: "ok", archivos, rama, serie, resumen: resumirPlan(conFecha.length ? conFecha : serie, spec.dueDate), actual: { total: hechas + pendientes, hechas } };
}

/** El plan que vive en el gestor: de la respuesta que la capa en vivo ya leyó. */
export function leerPlanDelGestor(spec, gestor) {
  if (!gestor) return omitido(spec, "el plan vive en el gestor (`tracker.artifactsIn`) y no hay `panel.tracker.command` que lo lea");
  if (!gestor.ok) return omitido(spec, `no se pudo leer el gestor: ${gestor.error}`);
  const { serie, sinFecha } = serieDesdeEventos(gestor.items);
  if (!serie.length) return { ...omitido(spec, `el gestor devolvió ${gestor.items.length} ítem(s) y ninguno trae \`createdAt\``), sinFecha };
  return { fuente: "tracker", estado: "ok", serie, sinFecha, resumen: resumirPlan(serie, spec.dueDate) };
}

/** Qué decir cuando no hay fuente. */
export function planSinFuente(spec) {
  return omitido(
    spec,
    spec.pedido === "none"
      ? "`panel.plan.source` es `none`"
      : "el config no dice dónde vive el plan: `tracker.artifactsIn` (`repo` o `tracker`) o `panel.plan.source`",
  );
}
