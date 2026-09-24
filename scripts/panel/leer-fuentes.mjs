/**
 * Lectores del panel: texto de las fuentes → modelo. Las funciones de lectura son PURAS (texto
 * adentro, datos afuera); el disco lo toca `construirModelo`, al final.
 *
 * El formato que leen es el que los frenos ya exigen (regla INCIDENTE para los gotchas, el contrato
 * de la constitución para `## P1 — Título · BLOCKING`): si una fuente se desvía, el modelo lo
 * reporta como `advertencias` —cada una con el comando que ya la pone en rojo—, nunca lo inventa.
 * Una fuente que falta va a `faltantes` y no es excepción ni alarma: el panel de un repo recién
 * portado —sin constitución todavía— tiene que salir igual, y decir qué le falta.
 *
 * Genérico: qué archivo es qué, cómo se invoca una tarea, qué carpeta es qué pieza del arnés y
 * qué cuenta como cita al gestor de trabajo lo dice `panel` en el config (`specDelPanel`), con
 * defaults que no suponen ningún lenguaje.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// El formato de un comando de hook lo parsea UN módulo, el de los hooks: dos parsers son dos verdades.
import { parseHookCommand } from "../../.claude/hooks/harness.mjs";
import { comoLista, comoMapa, construirArnes } from "./leer-arnes.mjs";
import { leerPlanDelRepo, planSinFuente, specDelPlan } from "./leer-plan.mjs";
import { gitPorDefecto } from "./leer-en-vivo.mjs";
import { leerDecisiones, specDeMemoria } from "./leer-memoria.mjs";

// ── El config del panel, con sus defaults ───────────────────────────────────

/**
 * Qué carpeta es qué pieza del arnés. Es el layout que el instalador deja en CUALQUIER repo, no
 * el de un proyecto: por eso puede ser default. Se prueba por la PRIMERA que coincide, así que el
 * orden es parte del contrato (`.claude/hooks/` antes que `.claude/`).
 */
export const AMBITOS_POR_DEFECTO = [
  { pattern: "^\\.claude/hooks/", label: "hook" },
  { pattern: "^\\.githooks/", label: "githook" },
  { pattern: "^\\.claude/agents/", label: "subagente" },
  { pattern: "^\\.claude/(commands|skills)/", label: "comando" },
  { pattern: "^\\.claude/", label: "agente" },
  { pattern: "^scripts/", label: "script" },
  { pattern: "^(\\.github|\\.gitlab|\\.circleci)/|(^|/)(azure-pipelines\\.ya?ml|Jenkinsfile|bitbucket-pipelines\\.yml)$", label: "ci" },
  { pattern: "^docs/", label: "docs" },
];

/** Qué FORMA tiene un freno, por su nombre de archivo. Los dos primeros son los scripts del propio arnés. */
export const FORMAS_POR_DEFECTO = [
  { pattern: "harness-selftest\\.mjs$", label: "self-test" },
  { pattern: "harness-bench\\.mjs$", label: "banco" },
];

/** Las secciones de STATUS.md que el panel entiende: las de la plantilla (`plantillas/STATUS.md`). */
export const STATUS_POR_DEFECTO = {
  sections: { open: "^Abierto ahora", signals: "^Señales", blockers: "^Bloqueos", debt: "^Deuda conocida" },
  fields: { date: "Fecha del último gate completo", branch: "Rama", verdict: "Veredicto" },
};

/**
 * La especificación del panel ya resuelta: lo que el repo declaró en `panel`, y para lo que no
 * declaró, lo que ya dicen otras claves (`status.file`, `incidents`, `tracker.issuePattern`,
 * `tests.filePattern`) antes que un literal. Un default nuevo que repite algo que el config ya
 * sabe es la segunda verdad que después se desincroniza.
 */
export function specDelPanel(config = {}) {
  const p = config.panel ?? {};
  const fuentes = p.sources ?? {};
  const formas = [...(p.forms ?? FORMAS_POR_DEFECTO)];
  if (!p.forms && config.tests?.filePattern) formas.push({ pattern: config.tests.filePattern, label: "test" });
  const estado = config.status?.file ?? "STATUS.md";
  return {
    enabled: p.enabled !== false,
    out: p.out ?? ".git/harness-panel",
    command: p.command ?? "node scripts/panel/generar.mjs",
    sources: {
      guide: fuentes.guide ?? "CLAUDE.md",
      status: estado,
      incidents: config.incidents?.file ?? null,
      incidentHeading: config.incidents?.heading ?? "### GOTCHA",
      constitutions: fuentes.constitutions ?? ["CONSTITUTION.md"],
      mechanismMarker: fuentes.mechanismMarker ?? "*Mecanismo:*",
      manifest: fuentes.manifest ?? null,
      readme: fuentes.readme ?? "README.md",
    },
    project: { name: p.project?.name ?? null, description: p.project?.description ?? null, summaryHeading: p.project?.summaryHeading ?? "^(Qué es|What)" },
    status: {
      sections: { ...STATUS_POR_DEFECTO.sections, ...(p.status?.sections ?? {}) },
      fields: { ...STATUS_POR_DEFECTO.fields, ...(p.status?.fields ?? {}) },
    },
    tasks: p.tasks?.invocation ? { manifest: p.tasks.manifest ?? null, key: p.tasks.key ?? null, invocation: p.tasks.invocation } : null,
    scopes: p.scopes ?? AMBITOS_POR_DEFECTO,
    forms: formas,
    citations: {
      patterns: p.citations?.patterns ?? (config.tracker?.issuePattern ? [config.tracker.issuePattern] : []),
      sources: p.citations?.sources ?? [estado],
    },
    repos: Array.isArray(p.repos) ? p.repos : [],
    probes: Array.isArray(p.probes) ? p.probes : [],
    tracker: Array.isArray(p.tracker?.command) && p.tracker.command.length
      ? { command: p.tracker.command, timeoutMs: p.tracker.timeoutMs ?? 20000, closedStates: p.tracker.closedStates ?? ["closed", "done", "resolved", "removed", "merged"] }
      : null,
    tokens: p.tokens !== false,
    live: p.live !== false,
  };
}

// ── Markdown mínimo ─────────────────────────────────────────────────────────

/** Secciones `## Título` → `{ titulo, cuerpo }`, en orden. Lo anterior al primer `##` va como preámbulo. */
export function seccionesDe(texto) {
  const partes = texto.split(/^## /m);
  const preambulo = partes[0] ?? "";
  const secciones = partes.slice(1).map((bloque) => {
    const salto = bloque.indexOf("\n");
    return {
      titulo: (salto === -1 ? bloque : bloque.slice(0, salto)).trim(),
      cuerpo: salto === -1 ? "" : bloque.slice(salto + 1),
    };
  });
  return { preambulo, secciones };
}

/** Sub-secciones `### Título` de un cuerpo. */
export function subseccionesDe(cuerpo) {
  return seccionesDe(cuerpo.replace(/^### /gm, "## ")).secciones;
}

/**
 * Viñetas de primer nivel (`- `) con sus líneas de continuación y sus sub-viñetas.
 * Devuelve `{ texto, hijos: string[] }`; el texto une las continuaciones con un espacio.
 */
export function vinetasDe(cuerpo) {
  const items = [];
  let actual = null;
  let hijo = null;
  const cerrarHijo = () => {
    if (actual && hijo !== null) actual.hijos.push(hijo.trim());
    hijo = null;
  };
  for (const linea of cuerpo.split("\n")) {
    if (/^- /.test(linea)) {
      cerrarHijo();
      actual = { texto: linea.slice(2).trim(), hijos: [] };
      items.push(actual);
    } else if (/^\s+- /.test(linea) && actual) {
      cerrarHijo();
      hijo = linea.replace(/^\s+- /, "");
    } else if (/^\s+\S/.test(linea) && actual) {
      if (hijo !== null) hijo += " " + linea.trim();
      else actual.texto += " " + linea.trim();
    } else if (linea.trim() === "") {
      cerrarHijo();
    } else if (!/^\s/.test(linea) && actual && !/^[#|>]/.test(linea)) {
      cerrarHijo();
      actual = null;
    }
  }
  cerrarHijo();
  return items;
}

/** Filas de la primera tabla `| a | b |` del cuerpo, como objetos con las cabeceras por clave. */
export function tablaDe(cuerpo) {
  const lineas = cuerpo.split("\n").filter((l) => /^\s*\|/.test(l));
  if (lineas.length < 2) return [];
  const celdas = (l) =>
    l
      .trim()
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());
  const cabeceras = celdas(lineas[0]);
  return lineas
    .slice(1)
    .filter((l) => !/^\s*\|[\s|:-]+\|\s*$/.test(l))
    .map((l) => {
      const valores = celdas(l);
      return Object.fromEntries(cabeceras.map((c, i) => [c, valores[i] ?? ""]));
    });
}

/** Texto plano sin marcas de markdown, para buscar y para títulos. */
export function sinMarcas(texto) {
  return String(texto ?? "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<!--.*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Los tokens citados entre backticks. Se mira TOKEN a token dentro de cada span: un mecanismo se
 * cita casi siempre como el comando que lo corre (`` `node <script> --flag` ``), y exigir que
 * el span entero fuera la ruta dejaba esos punteros sin verificar — y su tarjeta sin etiqueta.
 */
export function tokensCitados(texto) {
  const tokens = [];
  for (const span of String(texto ?? "").matchAll(/`([^`]+)`/g)) {
    for (const crudo of span[1].split(/\s+/)) {
      const token = crudo.replace(/^[([]+/, "").replace(/[.,;:)\]]+$/, "");
      if (token) tokens.push(token);
    }
  }
  return tokens;
}

/** Rutas citadas (con `/` y extensión, o carpeta con `/` final), sin URL ni placeholders. */
export function rutasCitadas(texto) {
  const rutas = new Set();
  for (const ruta of tokensCitados(texto)) {
    if (!/^[\w.@-][^\s]*\/./.test(ruta) && !/^[\w.@-][^\s]*\/$/.test(ruta)) continue;
    if (/^https?:/.test(ruta) || ruta.includes("<") || ruta.includes("*")) continue;
    if (!/\.[a-z]{1,5}$/i.test(ruta) && !ruta.endsWith("/")) continue;
    rutas.add(ruta);
  }
  return [...rutas].sort();
}

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Tareas citadas con la invocación del repo (`npm run x`, `make x`, `just x`). Sin `panel.tasks`
 * no se extrae ninguna: adivinar el ejecutor de tareas de otro stack es cablear un lenguaje.
 */
export function tareasCitadas(texto, invocacion) {
  if (!invocacion) return [];
  const re = new RegExp("`" + escaparRegex(invocacion) + "\\s+([\\w:.-]+)", "g");
  return [...new Set([...String(texto ?? "").matchAll(re)].map((m) => m[1]))].sort();
}

// ── Etiquetas ───────────────────────────────────────────────────────────────

/** Las que no dicen dónde vive el freno, sino que algo anda mal con él. */
export const ETIQUETAS_DE_ALARMA = ["puntero muerto", "sin freno"];

const compilar = (lista) =>
  (lista ?? []).flatMap((x) => {
    try {
      return [[new RegExp(x.pattern), x.label]];
    } catch {
      return [];
    }
  });

/**
 * Los tokens con los que el gate invoca sus señales: rutas de script y argumentos. Con ellos, una
 * tarjeta cuyo mecanismo cita una señal se etiqueta `gate` — el dato sale del config, no de leer
 * la prosa buscando la palabra.
 */
export function tokensDelGate(gate, invocacion = null) {
  const tokens = new Set();
  const agregar = (comando) => {
    if (!comando) return;
    const texto = Array.isArray(comando) ? comando.join(" ") : String(comando);
    for (const parte of texto.split(/\s+/)) tokens.add(parte.replace(/^["']|["']$/g, ""));
    if (invocacion) for (const t of tareasCitadas(`\`${texto}\``, invocacion)) tokens.add(t);
  };
  agregar(gate?.command);
  agregar(gate?.fastCommand);
  for (const s of gate?.signals ?? []) agregar(s.argv ?? s.command);
  return tokens;
}

/** Los hooks enganchados, por su nombre de archivo y sin extensión: así los cita la prosa. */
export function nombresDeHooks(hooks) {
  const nombres = new Set();
  for (const h of hooks ?? []) {
    const base = String(h.script ?? "").split("/").pop();
    if (!base) continue;
    nombres.add(base);
    nombres.add(base.replace(/\.[^.]+$/, ""));
  }
  return nombres;
}

/**
 * LAS ETIQUETAS SON HECHOS, NO OPINIONES: salen de datos que la tarjeta YA tiene —la ruta que cita
 * su mecanismo, la forma de ese archivo, el estado de sus punteros, su fuerza—, así que no hay una
 * lista paralela que mantener al día. El orden es por código de carácter y nunca `localeCompare`:
 * ese depende del ICU con el que se compiló node, y el panel tiene que salir byte a byte igual en
 * cualquier máquina.
 */
export function etiquetasDe(item, { enElGate = new Set(), hooks = new Set(), ambitos = [], formas = [] } = {}) {
  const etiquetas = new Set();
  const primera = (reglas, texto) => {
    for (const [re, tag] of reglas)
      if (re.test(texto)) {
        etiquetas.add(tag);
        return;
      }
  };
  for (const r of item.rutas ?? []) {
    const ruta = typeof r === "string" ? r : r.ruta;
    // `existe: null` es una ruta fuera de las raíces que este repo declara como propias.
    if (r.existe === null) etiquetas.add("externa");
    primera(ambitos, ruta);
    primera(formas, ruta);
    if (enElGate.has(ruta)) etiquetas.add("gate");
  }
  for (const s of item.tareas ?? []) if (enElGate.has(typeof s === "string" ? s : s.tarea)) etiquetas.add("gate");
  // La mitad de los mecanismos nombra su archivo SIN carpeta («lo fija `x.spec.ts`»). Ahí no hay
  // ámbito que deducir, pero la FORMA y el hook enganchado se leen igual del nombre.
  for (const token of tokensCitados(item.mecanismo)) {
    primera(formas, token);
    if (hooks.has(token)) etiquetas.add("hook");
    if (enElGate.has(token)) etiquetas.add("gate");
  }
  if (item.fuerza === "BLOCKING" || item.fuerza === "REVIEW") etiquetas.add(item.fuerza);
  if (item.ejecutable === false) etiquetas.add("sin freno");
  if ((item.rutas ?? []).some((r) => r.existe === false) || (item.tareas ?? []).some((s) => s.existe === false)) etiquetas.add("puntero muerto");
  return [...etiquetas].sort();
}

// ── STATUS.md ───────────────────────────────────────────────────────────────

/** El vocabulario con el que el gate del arnés imprime su veredicto: VERDE, ROJO, OMITIDA. */
const TONOS = [
  ["rojo", /^roj[oa]\b/i, /\bROJ[OA]\b/],
  ["verde", /^verde\b/i, /\bVERDE\b/],
  ["omitido", /^omitid[oa]\b/i, /\bOMITID[OA]\b/],
];

/** Color de un resultado: lo dice la palabra con la que empieza (o la que grita en mayúsculas). */
export function tonoDe(texto) {
  const plano = sinMarcas(texto);
  if (/^⚠/.test(plano)) return "advertencia";
  for (const [tono, alInicio] of TONOS) if (alInicio.test(plano)) return tono;
  for (const [tono, , enMayusculas] of TONOS) if (enMayusculas.test(plano)) return tono;
  return "neutro";
}

const fueraDeTabla = (cuerpo) =>
  cuerpo
    .split("\n")
    .filter((l) => !/^\s*\|/.test(l))
    .join("\n")
    .trim();

function tonoDeGrupoDeDeuda(titulo) {
  if (/cerrad|closed/i.test(titulo)) return "verde";
  if (/no es nuestra|upstream|ajena/i.test(titulo)) return "neutro";
  if (/diseño|design/i.test(titulo)) return "info";
  return "advertencia";
}

export function leerStatus(texto, spec = STATUS_POR_DEFECTO) {
  const { preambulo, secciones } = seccionesDe(texto);
  const cabecera = vinetasDe(preambulo);
  const campo = (nombre) => {
    const v = cabecera.find((i) => sinMarcas(i.texto).startsWith(nombre));
    if (!v) return null;
    return { valor: sinMarcas(v.texto).slice(nombre.length).replace(/^:\s*/, ""), crudo: v.texto, hijos: v.hijos };
  };
  const veredicto = campo(spec.fields.verdict);
  const seccion = (patron) => secciones.find((s) => new RegExp(patron, "i").test(s.titulo));

  const abiertos = seccion(spec.sections.open);
  const senales = seccion(spec.sections.signals);
  const bloqueos = seccion(spec.sections.blockers);
  const deuda = seccion(spec.sections.debt);
  // El sub-bloque de deuda son viñetas sueltas o grupos `###`: los dos formatos existen en uso.
  const gruposDeDeuda = (cuerpo) => {
    const sub = subseccionesDe(cuerpo);
    if (sub.length) return sub.map((g) => ({ titulo: g.titulo, tono: tonoDeGrupoDeDeuda(g.titulo), items: vinetasDe(g.cuerpo) }));
    const items = vinetasDe(cuerpo);
    return items.length ? [{ titulo: "Pendiente", tono: "advertencia", items }] : [];
  };

  return {
    fechaGate: campo(spec.fields.date)?.valor ?? null,
    rama: campo(spec.fields.branch)?.valor?.replace(/`/g, "") ?? null,
    veredicto: veredicto
      ? { texto: veredicto.crudo.replace(/^\*\*[^*]+:\*\*\s*/, ""), tono: tonoDe(veredicto.valor), notas: veredicto.hijos }
      : null,
    abiertos: { titulo: abiertos?.titulo ?? "Abierto ahora", items: abiertos ? vinetasDe(abiertos.cuerpo) : [] },
    senales: senales
      ? tablaDe(senales.cuerpo).map((f) => {
          const [senal, comando, resultado] = Object.values(f);
          return { senal: senal ?? "", comando: (comando ?? "").replace(/^`|`$/g, ""), resultado: resultado ?? "", tono: tonoDe(resultado ?? "") };
        })
      : [],
    senalesNota: senales ? fueraDeTabla(senales.cuerpo) : "",
    bloqueos: bloqueos ? vinetasDe(bloqueos.cuerpo) : [],
    deuda: deuda ? { intro: deuda.cuerpo.split(/^(### |- )/m)[0].trim(), grupos: gruposDeDeuda(deuda.cuerpo) } : { intro: "", grupos: [] },
  };
}

// ── Registro de incidentes (gotchas) ────────────────────────────────────────

const CAMPOS_GOTCHA = ["Síntoma", "Causa", "Regla", "Mecanismo"];
const sinComentariosHtml = (s) => s.replace(/<!--.*?-->/g, "");

/** Los campos se leen de `incidents.requiredLines` (`Síntoma:` …): el mismo contrato que exige el lint. */
export function leerGotchas(texto, { encabezado = "### GOTCHA", marcadorIgnorar = "linkcheck:ignore", campos = CAMPOS_GOTCHA, invocacion = null } = {}) {
  const nombres = campos.map((c) => c.replace(/:$/, ""));
  const reCampo = new RegExp(`^(${nombres.map(escaparRegex).join("|")}):\\s*(.*)$`);
  const bloques = texto.split(new RegExp(`^${escaparRegex(encabezado)}`, "m")).slice(1);
  return bloques.map((bloque, i) => {
    const [primeraLinea, ...resto] = bloque.split("\n");
    const cuerpo = resto.join("\n").split(/^---\s*$/m)[0];
    const leidos = {};
    let actual = null;
    for (const linea of cuerpo.split("\n")) {
      const m = reCampo.exec(linea.replace(/^\*\*([^*]+)\*\*/, "$1"));
      if (m) {
        actual = m[1];
        leidos[actual] = [m[2]];
      } else if (actual && linea.trim() && !/^#/.test(linea)) {
        leidos[actual].push(linea.trim());
      } else if (!linea.trim()) {
        actual = null;
      }
    }
    // Una línea marcada con el marcador de ignorar cita una ruta muerta A PROPÓSITO (evidencia).
    const lineasDe = (c) => leidos[c] ?? [];
    const texto = (c) => sinComentariosHtml(lineasDe(c).join(" ")).trim();
    const ultimo = nombres[nombres.length - 1];
    const verificables = lineasDe(ultimo).filter((l) => !l.includes(marcadorIgnorar)).join("\n");
    const mecanismo = texto(ultimo);
    return {
      n: i + 1,
      titulo: primeraLinea.replace(/^:\s*/, "").trim(),
      campos: nombres.slice(0, -1).map((c) => ({ nombre: c, texto: texto(c) })),
      mecanismo,
      ejecutable: Boolean(mecanismo) && !/^(ninguno|none)\b/i.test(sinMarcas(mecanismo)),
      rutas: rutasCitadas(verificables),
      tareas: tareasCitadas(verificables, invocacion),
      faltan: nombres.filter((c) => !(c in leidos)),
    };
  });
}

// ── Constituciones ──────────────────────────────────────────────────────────

/**
 * `## P3 — Título · BLOCKING`. El prefijo NO se configura: se lee del encabezado, así que una
 * constitución de producto con `G1…` y una del arnés con `P1…` salen de la misma función.
 */
export function leerConstitucion(texto, archivo, { marcador = "*Mecanismo:*", invocacion = null } = {}) {
  const version = /\*\*(?:Versión|Version) (\d+\.\d+\.\d+)\*\*(?:\s*·\s*(\d{4}-\d{2}-\d{2}))?/.exec(texto);
  const encabezado = /^([A-Z][A-Za-z]*)(\d+) — (.+?)(?: · (BLOCKING|REVIEW))?\s*$/;
  const reMarca = new RegExp(`^${escaparRegex(marcador)}`, "m");
  const principios = [];
  for (const s of seccionesDe(texto).secciones) {
    const m = encabezado.exec(s.titulo);
    if (!m) continue;
    // El marcador vale al INICIO de línea: un principio puede citarlo entre backticks en su enunciado.
    const marca = reMarca.exec(s.cuerpo);
    const idx = marca ? marca.index : -1;
    const enunciado = (idx === -1 ? s.cuerpo : s.cuerpo.slice(0, idx)).split(/^---\s*$/m)[0].trim();
    const mecanismo = idx === -1 ? "" : s.cuerpo.slice(idx + marca[0].length).split(/^---\s*$/m)[0].trim();
    principios.push({
      id: `${m[1]}${m[2]}`,
      titulo: m[3].trim(),
      fuerza: m[4] ?? "sin declarar",
      enunciado,
      mecanismo,
      rutas: rutasCitadas(mecanismo),
      tareas: tareasCitadas(mecanismo, invocacion),
    });
  }
  return {
    archivo,
    titulo: (/^# (.+)$/m.exec(texto)?.[1] ?? archivo).trim(),
    version: version?.[1] ?? null,
    fecha: version?.[2] ?? null,
    principios,
  };
}

// ── harness.config.json + settings.json ─────────────────────────────────────

const sinComentarios = (obj) => {
  if (Array.isArray(obj)) return obj.map(sinComentarios);
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([k]) => !k.startsWith("$"))
        .map(([k, v]) => [k, sinComentarios(v)]),
    );
  }
  return obj;
};

// Una regla suelta es una lista de uno; cualquier otra forma, vacía (ver `comoLista`). Los campos
// que son listas de TEXTO (`required`, `literals`…) sólo valen como arrays.
const lista = comoLista;
const textos = (x) => (Array.isArray(x) ? x.filter((y) => typeof y === "string") : []);

/** Las reglas declaradas, tal como las ejecutan los frenos. Una clave ausente es una lista vacía, no un error. */
export function leerConfig(config) {
  const c = sinComentarios(config ?? {});
  const xp = c.xp && typeof c.xp === "object"
    ? Object.entries(c.xp).map(([practica, v]) => ({ practica, enabled: Boolean(v?.enabled), reason: v?.reason ?? "", escapeLine: v?.escapeLine ?? null }))
    : [];
  return {
    gate: {
      command: c.gate?.command ?? null,
      fastCommand: c.gate?.fastCommand ?? null,
      marker: c.gate?.marker ?? null,
      registry: c.gate?.registry ?? ".git/harness-gate.json",
      signals: lista(c.gate?.signals).map((s) => ({
        name: s.name,
        command: textos(s.command).join(" "),
        argv: textos(s.command),
        why: s.why ?? "",
        fastSkip: Boolean(s.fastSkip),
        skipIfMissing: s.skipIfMissing ?? null,
      })),
    },
    frenos: {
      protectedPaths: lista(c.protectedPaths).map((p) => ({ pattern: p.pattern, reason: p.reason ?? "", agentOnly: Boolean(p.agentOnly) })),
      bashDeny: lista(c.bash?.deny).map((d) => ({ pattern: d.pattern, reason: d.reason ?? "" })),
      patterns: lista(c.patterns).map((p) => ({ id: p.id, pattern: p.pattern, appliesTo: p.appliesTo ?? "", message: p.message ?? "" })),
      invariants: lista(c.invariants).map((i) => ({ file: i.file, required: textos(i.required), forbidden: textos(i.forbidden), reason: i.reason ?? "" })),
      singleSource: lista(c.singleSource).map((s) => ({ id: s.id, source: s.source, literals: textos(s.literals), appliesTo: s.appliesTo ?? "", reason: s.reason ?? "" })),
      purity: lista(c.purity).map((p) => ({ dir: p.dir, forbiddenImports: textos(p.forbiddenImports), except: textos(p.except), reason: p.reason ?? "" })),
      reuse: lista(c.reuse).map((r) => ({ pattern: r.pattern, appliesTo: r.appliesTo ?? "", see: r.see ?? "", reason: r.reason ?? "" })),
      forbiddenDeps: c.forbiddenDeps?.packages?.length ? [{ manifest: c.forbiddenDeps.manifest ?? "", packages: textos(c.forbiddenDeps.packages), reason: c.forbiddenDeps.reason ?? "" }] : [],
    },
    incidents: c.incidents ? { file: c.incidents.file, requiredLines: textos(c.incidents.requiredLines) } : null,
    workflow: c.workflow
      ? { model: c.workflow.model ?? "", baseBranch: c.workflow.baseBranch ?? null, branchPattern: c.workflow.branchPattern ?? null, maxAgeDays: c.workflow.maxAgeDays ?? null, reason: c.workflow.reason ?? "" }
      : null,
    xp,
    tracker: c.tracker ? { kind: c.tracker.kind ?? "", issuePattern: c.tracker.issuePattern ?? "", example: c.tracker.issueExample ?? "" } : null,
    observability: c.observability ? { budgetMs: c.observability.budgetMs ?? null, budgets: c.observability.budgets ?? {} } : null,
  };
}

export function leerHooks(settings) {
  const salida = [];
  for (const [evento, grupos] of Object.entries(comoMapa(settings?.hooks))) {
    for (const grupo of comoLista(grupos)) {
      for (const h of comoLista(grupo.hooks)) {
        const c = parseHookCommand(h.command);
        salida.push({ evento, matcher: grupo.matcher ?? "*", script: c?.file ?? String(h.command ?? ""), tipo: c?.tipo ?? "ejecutable" });
      }
    }
  }
  return salida;
}

// ── Qué es el proyecto ──────────────────────────────────────────────────────

/** Primer párrafo de prosa de un texto markdown (ni encabezado, ni lista, ni tabla, ni código). */
function primerParrafo(texto) {
  let enCodigo = false;
  for (const bloque of String(texto ?? "").split(/\n\s*\n/)) {
    const b = bloque.trim();
    const cercas = (b.match(/```/g) ?? []).length;
    if (enCodigo || /^```/.test(b)) {
      if (cercas % 2 === 1) enCodigo = !enCodigo;
      continue;
    }
    if (!b || /^(#|[-*|>]|\d+\.|<|!\[|@)/.test(b)) continue;
    return b.replace(/\s*\n\s*/g, " ");
  }
  return "";
}

/**
 * Nombre y descripción: lo que el config declara, si no el manifiesto (si es JSON), si no el
 * README, si no el nombre de la carpeta. La presentación es el primer párrafo de la sección de la
 * guía del agente que dice qué es el repo.
 */
export function leerProyecto({ declarado = {}, manifiesto = null, readme = "", guia = "", carpeta = "" }) {
  const tituloReadme = /^# (.+)$/m.exec(readme)?.[1]?.trim() ?? "";
  let seccion = null;
  try {
    seccion = seccionesDe(guia).secciones.find((s) => new RegExp(declarado.summaryHeading ?? "^(Qué es|What)", "i").test(s.titulo));
  } catch {
    seccion = null;
  }
  return {
    nombre: declarado.name ?? manifiesto?.name ?? (sinMarcas(tituloReadme) || carpeta),
    descripcion: declarado.description ?? manifiesto?.description ?? sinMarcas(primerParrafo(readme.replace(/^# .+$/m, ""))),
    presentacion: seccion ? [primerParrafo(seccion.cuerpo)].filter(Boolean) : [],
  };
}

// ── Citas al gestor de trabajo ──────────────────────────────────────────────

/**
 * Dónde la memoria cita un ítem de trabajo, según `tracker.issuePattern` (o `panel.citations`).
 * El id es el match sin el borde que el patrón consume (`(^|[^A-Za-z0-9_])#123` → `#123`), así
 * sirve igual para `#123`, `AB#123` o `PROJ-123`. Determinista y sin red: acá sólo se EXTRAE; qué
 * dice hoy el gestor de cada una lo pregunta la capa en vivo, que es la que puede caducar.
 */
export function leerCitas(textosPorFuente, patrones = []) {
  const res = patrones.flatMap((p) => {
    try {
      return [new RegExp(p, "g")];
    } catch {
      return [];
    }
  });
  const porId = new Map();
  for (const [fuente, texto] of Object.entries(textosPorFuente)) {
    let enCodigo = false;
    texto.split("\n").forEach((linea, i) => {
      if (/^\s*```/.test(linea)) enCodigo = !enCodigo;
      if (enCodigo) return;
      for (const re of res) {
        for (const m of linea.matchAll(re)) {
          const id = m[0].replace(/^[^A-Za-z0-9#]+/, "").trim();
          if (!id) continue;
          if (!porId.has(id)) porId.set(id, { id, donde: [] });
          porId.get(id).donde.push({ fuente, linea: i + 1, texto: linea.trim().slice(0, 180) });
        }
      }
    });
  }
  const clave = (id) => id.replace(/\d+/g, (d) => d.padStart(12, "0"));
  return [...porId.values()].sort((a, b) => (clave(a.id) < clave(b.id) ? -1 : clave(a.id) > clave(b.id) ? 1 : 0));
}

// ── Ensamble ────────────────────────────────────────────────────────────────

const sha = (texto) => createHash("sha256").update(texto).digest("hex").slice(0, 12);

/** El conjunto de tareas que el manifiesto declara, o `null` si no hay forma de saberlo. */
function tareasDelManifiesto(raiz, tasks) {
  if (!tasks?.manifest || !tasks.key) return null;
  try {
    const m = JSON.parse(readFileSync(path.join(raiz, tasks.manifest), "utf8"));
    return new Set(Object.keys(m[tasks.key] ?? {}));
  } catch {
    return null;
  }
}

/**
 * Marca `existe` sobre cada ruta citada: un mecanismo que apunta a la nada se ve en el panel. Se
 * verifican las raíces que el repo declara propias (`docs.proseRoots`) y los archivos sueltos de la
 * raíz; lo demás queda en `null` — el panel no afirma nada de lo que no puede verificar.
 */
function verificarPunteros(items, raiz, tareas, raicesPropias) {
  const verificable = (ruta) => raicesPropias.includes(ruta.split("/")[0]) || !ruta.includes("/");
  for (const it of items) {
    it.rutas = it.rutas.map((ruta) => ({ ruta, existe: verificable(ruta) ? existsSync(path.join(raiz, ruta)) : null }));
    it.tareas = it.tareas.map((t) => ({ tarea: t, existe: tareas ? tareas.has(t) : null }));
  }
}

/** Qué comando pone en rojo cada advertencia. El BLOCKING sin mecanismo sólo lo juzga el revisor. */
const LINKCHECK = "node scripts/docs-linkcheck.mjs";
const REVIEWER = "subagente reviewer";

function advertenciasDe(gotchas, constituciones) {
  const avisos = [];
  const punteros = (quien, it) => {
    for (const r of it.rutas) if (r.existe === false) avisos.push({ que: `${quien} cita ${r.ruta}, que no existe`, comando: LINKCHECK });
    for (const s of it.tareas) if (s.existe === false) avisos.push({ que: `${quien} cita la tarea ${s.tarea}, que el manifiesto no declara`, comando: LINKCHECK });
  };
  for (const g of gotchas) {
    if (g.faltan.length) avisos.push({ que: `gotcha ${g.n} «${sinMarcas(g.titulo)}» sin ${g.faltan.join(", ")}`, comando: "node scripts/repo-lint.mjs" });
    punteros(`gotcha ${g.n}`, g);
  }
  for (const c of constituciones) {
    for (const p of c.principios) {
      if (p.fuerza === "BLOCKING" && !p.mecanismo) avisos.push({ que: `${p.id} (${c.archivo}) es BLOCKING y no declara su mecanismo`, comando: REVIEWER });
      punteros(p.id, p);
    }
  }
  return avisos;
}

/**
 * Lee las fuentes desde `raiz` y arma el modelo de MEMORIA completo: determinista y sin reloj. El
 * único proceso es un `git log` cuando el plan vive en el repo: la historia versionada es un dato
 * como cualquier archivo, y con el mismo HEAD da la misma serie. `config`, `settings` y `git`
 * pueden venir inyectados (el self-test prueba con cebos sin tocar el árbol, P7).
 */
export function construirModelo(raiz, { config = null, settings = null, git = gitPorDefecto } = {}) {
  const advertencias = [];
  // Una fuente que FALTA no es una alarma: ningún comando del arnés la pone en rojo (un repo
  // recién portado todavía no tiene su guía), y el panel sólo alarma lo que un freno ya frena.
  // Se dice en «Fuentes», con nombre.
  const faltantes = [];
  const leidas = [];
  const leer = (rel, { opcional = false } = {}) => {
    if (!rel) return null;
    try {
      const t = readFileSync(path.join(raiz, rel), "utf8");
      leidas.push({ ruta: rel, hash: sha(t), lineas: t.split("\n").length });
      return t;
    } catch {
      if (!opcional) faltantes.push(rel);
      return null;
    }
  };
  const json = (rel, texto) => {
    if (texto === null) return null;
    try {
      return JSON.parse(texto);
    } catch (e) {
      advertencias.push({ que: `${rel} no es JSON válido (${e.message})`, comando: "node scripts/gate.mjs" });
      return null;
    }
  };

  const rutaConfig = ".claude/harness.config.json";
  const rutaSettings = ".claude/settings.json";
  const cfg = config ?? json(rutaConfig, leer(rutaConfig)) ?? {};
  const set = settings ?? json(rutaSettings, leer(rutaSettings)) ?? {};
  const spec = specDelPanel(cfg);
  const invocacion = spec.tasks?.invocation ?? null;
  const tareas = tareasDelManifiesto(raiz, spec.tasks);
  const raicesPropias = cfg.docs?.proseRoots ?? [];

  const textoGuia = leer(spec.sources.guide) ?? "";
  const textoStatus = leer(spec.sources.status);
  const textoGotchas = spec.sources.incidents ? leer(spec.sources.incidents) : null;
  const textoReadme = leer(spec.sources.readme, { opcional: true }) ?? "";
  const manifiesto = spec.sources.manifest && /\.json$/i.test(spec.sources.manifest) ? json(spec.sources.manifest, leer(spec.sources.manifest)) : null;

  const gotchas = textoGotchas
    ? leerGotchas(textoGotchas, {
        encabezado: spec.sources.incidentHeading,
        marcadorIgnorar: cfg.docs?.ignoreMarker ?? "linkcheck:ignore",
        campos: cfg.incidents?.requiredLines?.length ? cfg.incidents.requiredLines : CAMPOS_GOTCHA,
        invocacion,
      })
    : [];
  verificarPunteros(gotchas, raiz, tareas, raicesPropias);

  const constituciones = [];
  for (const archivo of spec.sources.constitutions) {
    const texto = leer(archivo);
    if (texto === null) continue;
    const c = leerConstitucion(texto, archivo, { marcador: spec.sources.mechanismMarker, invocacion });
    if (!c.principios.length) advertencias.push({ que: `${archivo} no tiene ningún principio con el formato \`## P1 — Título · BLOCKING\``, comando: REVIEWER });
    verificarPunteros(c.principios, raiz, tareas, raicesPropias);
    constituciones.push(c);
  }

  const reglas = { constituciones, ...leerConfig(cfg), hooks: leerHooks(set) };

  // Las etiquetas se derivan al final: necesitan los punteros ya verificados, las señales del gate
  // y los hooks enganchados.
  const contexto = { enElGate: tokensDelGate(reglas.gate, invocacion), hooks: nombresDeHooks(reglas.hooks), ambitos: compilar(spec.scopes), formas: compilar(spec.forms) };
  for (const g of gotchas) g.etiquetas = etiquetasDe(g, contexto);
  for (const c of constituciones) for (const p of c.principios) p.etiquetas = etiquetasDe(p, contexto);

  const textosCitados = {};
  for (const rel of spec.citations.sources) {
    const t = rel === spec.sources.status ? textoStatus : leer(rel, { opcional: true });
    if (t) textosCitados[rel] = t;
  }

  const modelo = {
    fuentes: leidas.filter((f, i) => leidas.findIndex((g) => g.ruta === f.ruta) === i),
    proyecto: leerProyecto({ declarado: spec.project, manifiesto, readme: textoReadme, guia: textoGuia, carpeta: path.basename(raiz) }),
    estado: textoStatus !== null ? leerStatus(textoStatus, spec.status) : leerStatus("", spec.status),
    gotchas,
    reglas,
    citas: leerCitas(textosCitados, spec.citations.patterns),
    citasFuentes: Object.keys(textosCitados),
    arnes: construirArnes(raiz, { config: cfg, settings: set }),
    plan: planDeMemoria(raiz, cfg, spec, git),
    decisiones: (() => {
      const m = specDeMemoria(cfg);
      return leerDecisiones(raiz, m.decisionsDir, m.statusWords, { patron: m.decisionsPattern, tonos: m.statusTones });
    })(),
    // Lo que la plantilla necesita para no nombrar ningún archivo ni ningún ejecutor de tareas.
    rutas: { status: spec.sources.status, incidents: spec.sources.incidents, guide: spec.sources.guide },
    invocacion,
    comando: spec.command,
    faltantes,
    advertencias: [...advertencias, ...advertenciasDe(gotchas, constituciones)],
  };
  // ⚠ LA VERSIÓN ES DEL MODELO, NO DE LOS ARCHIVOS. Hasheando sólo las fuentes, dos paneles con
  // contenido distinto salían con la misma versión: `existe` se lee del disco y no de ningún texto,
  // así que borrar un archivo citado cambiaba el panel sin cambiar ninguna fuente.
  return { version: sha(JSON.stringify(modelo)), ...modelo };
}

/**
 * El plan que la memoria puede leer sola: el del repo. El del gestor lo completa la capa en vivo
 * con la misma respuesta que ya lee (acá queda `pendiente`); sin comando, ya se sabe que se omite.
 */
function planDeMemoria(raiz, cfg, spec, git) {
  const plan = specDelPlan(cfg);
  if (plan.fuente === "repo") return leerPlanDelRepo(raiz, plan, git);
  if (plan.fuente === "tracker") {
    return spec.tracker
      ? { fuente: "tracker", estado: "pendiente", motivo: "se lee en vivo del gestor", serie: [], resumen: null, spec: plan }
      : { fuente: "tracker", estado: "omitido", motivo: "el plan vive en el gestor (`tracker.artifactsIn`) y no hay `panel.tracker.command` que lo lea", serie: [], resumen: null };
  }
  return planSinFuente(plan);
}
