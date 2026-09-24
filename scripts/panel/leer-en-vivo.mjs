/**
 * Capa EN VIVO del panel: lo que cambia entre dos corridas aunque no cambie ningún archivo
 * versionado —el árbol de git de la raíz y de cada repo declarado, el marcador y el registro del
 * gate, las sondas a los servicios locales, lo que el gestor de trabajo dice hoy y el consumo de
 * tokens de las sesiones del agente.
 *
 * Va aparte de `leer-fuentes.mjs` a propósito: aquello es determinista; esto lleva reloj, procesos
 * (git, el comando del gestor) y red a localhost. Todo lo externo entra inyectado (`ejecutarGit`,
 * `ejecutarComando`, `sonda`, `dirTranscripciones`, `ahora`) para poder probarlo sin máquina.
 *
 * Ninguna lectura acá lanza: lo que no se pudo leer vuelve como `{ ok: false, error }` con nombre,
 * nunca como un cero que parezca un dato. Un gestor vacío y uno inalcanzable no se pueden ver igual.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolverEjecutable } from "../../.claude/hooks/harness.mjs";
import { leerPlanDelGestor } from "./leer-plan.mjs";
import { construirMemoriaEnVivo, dirDeClaude, specDeMemoria } from "./leer-memoria.mjs";

const LINEAS_DE_DIFF = 400;
const DIAS_DE_TOKENS = 14;

// ── git ─────────────────────────────────────────────────────────────────────

/** `git -C dir <args>` → stdout, o "" si falla. */
export function gitPorDefecto(dir, args) {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return r.status === 0 ? (r.stdout ?? "") : "";
}

const primerSegmento = (ruta) => (ruta.includes("/") ? ruta.split("/")[0] + "/" : "(raíz)");
const porCodigo = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** El estado de un repositorio: rama, cambios agrupados por carpeta, numstat, últimos commits y diff acotado. */
export function leerRepo(nombre, dir, base, git) {
  const rama = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() || null;
  const cambios = git(dir, ["status", "--porcelain=v1", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const archivo = l.slice(3).replace(/^"|"$/g, "").replace(/^.* -> /, "");
      return { estado: l.slice(0, 2).trim() || "??", archivo, grupo: primerSegmento(archivo) };
    });
  const porGrupo = [...cambios.reduce((m, c) => m.set(c.grupo, (m.get(c.grupo) ?? 0) + 1), new Map())]
    .map(([grupo, n]) => ({ grupo, n }))
    .sort((a, b) => b.n - a.n || porCodigo(a.grupo, b.grupo));
  const numstat = git(dir, ["diff", "HEAD", "--numstat"])
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [mas, menos, ...resto] = l.split("\t");
      return { archivo: resto.join("\t"), mas: mas === "-" ? null : Number(mas), menos: menos === "-" ? null : Number(menos) };
    });
  const ultimosCommits = git(dir, ["log", "-8", "--date=short", "--format=%h%x09%ad%x09%s"])
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, fecha, ...asunto] = l.split("\t");
      return { sha, fecha, asunto: asunto.join("\t") };
    });
  let adelante = null;
  let atras = null;
  const ref = base ? [`origin/${base}`, base].find((r) => git(dir, ["rev-parse", "--verify", "--quiet", r]).trim()) : null;
  if (ref && rama && rama !== base) {
    const [a, b] = git(dir, ["rev-list", "--left-right", "--count", `HEAD...${ref}`]).trim().split(/\s+/);
    adelante = Number(a);
    atras = Number(b);
  }
  const lineas = git(dir, ["diff", "HEAD"]).split("\n");
  return {
    nombre,
    rama,
    base: ref,
    limpio: cambios.length === 0,
    cambios,
    porGrupo,
    numstat,
    ultimosCommits,
    adelante,
    atras,
    diff: lineas.slice(0, LINEAS_DE_DIFF).join("\n"),
    diffTruncado: lineas.length > LINEAS_DE_DIFF ? lineas.length - LINEAS_DE_DIFF : 0,
  };
}

// ── tokens de las sesiones del agente ───────────────────────────────────────

/**
 * Carpeta donde Claude Code guarda las transcripciones de ESTE repo: `~/.claude/projects/<ruta>`,
 * con todo lo que no es alfanumérico convertido en `-`.
 */
export function carpetaDeTranscripciones(raiz, home = os.homedir(), env = process.env) {
  return path.join(dirDeClaude(home, env), "projects", raiz.replace(/[^A-Za-z0-9]/g, "-"));
}

const cero = () => ({ entrada: 0, salida: 0, cacheLeida: 0, cacheEscrita: 0, mensajes: 0 });
const sumar = (acc, u) => {
  acc.entrada += u.input_tokens ?? 0;
  acc.salida += u.output_tokens ?? 0;
  acc.cacheLeida += u.cache_read_input_tokens ?? 0;
  acc.cacheEscrita += u.cache_creation_input_tokens ?? 0;
  acc.mensajes += 1;
};

/**
 * Suma el `usage` de cada mensaje del asistente, deduplicado por id de mensaje (una respuesta en
 * streaming se escribe en varias líneas con el MISMO usage). Sin carpeta → `null`, no cero.
 *
 * Sólo la VENTANA de `dias`: se saltean las transcripciones que no se tocaron en ella y los
 * mensajes anteriores. Leerlas todas en cada gate crecía sin tope con la vida del repo (lo marcó
 * el reviewer: 31 MB y subiendo) para mostrar catorce barras.
 */
export function leerTokens(dir, { ahora = new Date(), dias = DIAS_DE_TOKENS } = {}) {
  if (!dir || !existsSync(dir)) return null;
  const desde = new Date(ahora.getTime() - (dias - 1) * 86400000).toISOString().slice(0, 10);
  const corte = Date.parse(`${desde}T00:00:00Z`);
  const archivos = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .filter((f) => {
      try {
        return statSync(path.join(dir, f)).mtimeMs >= corte;
      } catch {
        return false;
      }
    })
    .sort();
  const vistos = new Set();
  const porDia = new Map();
  const porModelo = new Map();
  const total = cero();
  let ultimaActividad = null;
  for (const archivo of archivos) {
    let texto;
    try {
      texto = readFileSync(path.join(dir, archivo), "utf8");
    } catch {
      continue;
    }
    for (const linea of texto.split("\n")) {
      if (!linea.includes('"usage"')) continue;
      let j;
      try {
        j = JSON.parse(linea);
      } catch {
        continue;
      }
      const u = j?.message?.usage;
      if (j?.type !== "assistant" || !u) continue;
      const id = j.message.id ?? `${archivo}:${j.uuid ?? linea.length}`;
      if (vistos.has(id)) continue;
      vistos.add(id);
      const dia = (j.timestamp ?? "").slice(0, 10);
      if (dia && dia < desde) continue;
      if (dia && (!ultimaActividad || j.timestamp > ultimaActividad)) ultimaActividad = j.timestamp;
      sumar(total, u);
      if (dia) {
        if (!porDia.has(dia)) porDia.set(dia, cero());
        sumar(porDia.get(dia), u);
      }
      // `<synthetic>` son mensajes que fabrica el cliente (sin costo): no son un modelo.
      const modelo = j.message.model ?? "desconocido";
      if (!modelo.startsWith("<")) {
        if (!porModelo.has(modelo)) porModelo.set(modelo, cero());
        sumar(porModelo.get(modelo), u);
      }
    }
  }
  const ultimosDias = [];
  for (let i = 0; i < dias; i += 1) {
    const dia = new Date(new Date(desde).getTime() + i * 86400000).toISOString().slice(0, 10);
    ultimosDias.push({ dia, ...(porDia.get(dia) ?? cero()) });
  }
  return {
    carpeta: dir,
    sesiones: archivos.length,
    dias,
    total,
    ultimaActividad,
    ultimosDias,
    porModelo: [...porModelo.entries()].map(([modelo, t]) => ({ modelo, ...t })).sort((a, b) => b.salida - a.salida),
    hoy: porDia.get(ahora.toISOString().slice(0, 10)) ?? cero(),
  };
}

// ── el gestor de trabajo, por el comando que el repo declara ────────────────

/** `argv` con el CWD en la raíz → { status, stdout, stderr }. */
export function comandoPorDefecto(raiz, argv, timeoutMs = 20000) {
  // Sin shell: ningún dato del config ni ningún id citado se interpola en una línea de comandos.
  const r = spawnSync(resolverEjecutable(argv[0]), argv.slice(1), { cwd: raiz, encoding: "utf8", timeout: timeoutMs, windowsHide: true, shell: false });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.error ? String(r.error.message) : (r.stderr ?? "") };
}

/**
 * El panel no habla con ninguna forja: corre el comando de `panel.tracker.command` con los ids que
 * la memoria cita como argumentos al final, y espera por stdout JSON con esta forma:
 *
 *   { "items": [ { "id": "#12", "title": "…", "state": "open", "url": "…", "type": "issue" } ],
 *     "summary": { "total": 40, "closed": 31 } }       ← `summary` es opcional
 *
 * El adaptador a GitHub, GitLab, Azure o Jira lo escribe el repo (docs/panel.md trae ejemplos):
 * así ningún script del arnés conoce una forja.
 */
export function leerGestor(raiz, spec, ids, ejecutar = comandoPorDefecto) {
  if (!spec) return null;
  const argv = [...spec.command, ...ids];
  const comando = spec.command.join(" ");
  const falla = (error) => ({ ok: false, comando, error: String(error).trim().split("\n").filter(Boolean).slice(0, 3).join(" · ") || "sin detalle" });
  const r = ejecutar(raiz, argv, spec.timeoutMs);
  if (r.status !== 0) return falla(r.stderr || r.stdout || `salió con ${r.status}`);
  try {
    const datos = JSON.parse(r.stdout);
    if (!Array.isArray(datos?.items)) return falla("la salida no trae `items`");
    const cerrados = new Set(spec.closedStates.map((s) => s.toLowerCase()));
    const items = datos.items.map((i) => ({
      id: String(i.id ?? ""),
      titulo: String(i.title ?? i.titulo ?? ""),
      estado: String(i.state ?? i.estado ?? ""),
      url: i.url ?? null,
      tipo: i.type ?? i.tipo ?? null,
      cerrado: cerrados.has(String(i.state ?? i.estado ?? "").toLowerCase()),
      // Para el burn-down: las fechas que el gestor YA tiene. Sin ellas, el ítem no entra a la serie.
      createdAt: i.createdAt ?? null,
      closedAt: i.closedAt ?? null,
      // Qué ítems son del PLAN y cuáles sólo se citan: la misma respuesta sirve a las dos cosas.
      inPlan: i.inPlan !== false,
    }));
    const s = datos.summary;
    const resumen = s && Number.isFinite(s.total) && Number.isFinite(s.closed) ? { total: s.total, cerrados: s.closed, pct: s.total ? Math.round((s.closed / s.total) * 100) : 0 } : null;
    return { ok: true, comando, items, resumen };
  } catch (e) {
    return falla(`salida ilegible: ${e.message}`);
  }
}

// ── sondas a servicios locales ──────────────────────────────────────────────

/** GET con tiempo límite. Sólo sondea lo que el config declara; responde = cualquier status < 500. */
export async function sondaPorDefecto(url, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "manual" });
    return { viva: r.status < 500, status: r.status };
  } catch (e) {
    return { viva: false, error: e.name === "AbortError" ? `sin respuesta en ${timeoutMs} ms` : String(e.cause?.code ?? e.message) };
  } finally {
    clearTimeout(t);
  }
}

// ── ensamble ────────────────────────────────────────────────────────────────

const leerJson = (ruta) => {
  try {
    return JSON.parse(readFileSync(ruta, "utf8"));
  } catch {
    return null;
  }
};

/**
 * Devuelve el estado de la máquina en este instante; lleva `generadoEn` porque lo que describe
 * caduca. `spec` es `specDelPanel(config)`.
 */
export async function construirEnVivo(raiz, memoria, spec, opciones = {}) {
  const {
    ejecutarGit = gitPorDefecto,
    ejecutarComando = comandoPorDefecto,
    sonda = sondaPorDefecto,
    home = os.homedir(),
    env = process.env,
    ahora = new Date(),
  } = opciones;
  // Las transcripciones se guardan por la carpeta del repo PRINCIPAL: desde un worktree, la ruta de
  // este árbol daría una carpeta que no existe y el panel diría «sin transcripciones».
  const comun = ejecutarGit(raiz, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  const raizPrincipal = comun && path.basename(comun) === ".git" ? path.dirname(comun) : raiz;
  const dirTranscripciones = opciones.dirTranscripciones ?? carpetaDeTranscripciones(raizPrincipal, home, env);
  const reglas = memoria.reglas;

  const repos = [];
  if (ejecutarGit(raiz, ["rev-parse", "--git-dir"]).trim()) repos.push(leerRepo("(raíz)", raiz, reglas.workflow?.baseBranch ?? null, ejecutarGit));
  for (const r of spec.repos) {
    const dir = path.resolve(raiz, r.path ?? "");
    if (!r.path || !existsSync(dir)) {
      repos.push({ nombre: r.name ?? r.path ?? "?", ausente: true, ruta: r.path ?? "" });
      continue;
    }
    repos.push({ ...leerRepo(r.name ?? r.path, dir, r.base ?? null, ejecutarGit), rol: r.role ?? null });
  }

  const marcador = reglas.gate.marker;
  const rutaMarcador = marcador ? path.join(raiz, marcador) : null;
  const pendiente = Boolean(rutaMarcador && existsSync(rutaMarcador));
  const gate = { marcador, pendiente, desde: pendiente ? statSync(rutaMarcador).mtime.toISOString() : null, registro: leerJson(path.join(raiz, reglas.gate.registry)), rutaRegistro: reglas.gate.registry };

  // Una sola lectura del gestor: la usan las citas y, si el plan vive ahí, el burn-down.
  const gestor = leerGestor(raiz, spec.tracker, (memoria.citas ?? []).map((c) => c.id), ejecutarComando);

  const sondas = [];
  for (const p of spec.probes) {
    if (!p?.url) continue;
    sondas.push({ nombre: p.name ?? p.url, url: p.url, ...(await sonda(p.url, p.timeoutMs ?? 1500)) });
  }

  return {
    generadoEn: ahora.toISOString(),
    maquina: os.hostname(),
    repos,
    gate,
    sondas,
    gestor,
    plan: memoria.plan?.fuente === "tracker" && memoria.plan.estado === "pendiente" ? leerPlanDelGestor(memoria.plan.spec, gestor) : null,
    tokens: spec.tokens ? leerTokens(dirTranscripciones, { ahora }) : null,
    // La memoria del agente como LLEGA: lo que lee al arrancar y la memoria automática de esta
    // máquina. Vive al lado de las transcripciones, en la misma carpeta de Claude Code.
    // Falla abierto como todo lo de acá: si la memoria no se puede leer, la pestaña lo dice y el
    // resto del panel sale igual.
    memoria: (() => {
      try {
        return construirMemoriaEnVivo(raiz, { settings: opciones.settings ?? {}, config: opciones.config ?? {}, spec: specDeMemoria(opciones.config ?? {}), dirTranscripciones, home, env, git: ejecutarGit, ahora });
      } catch (e) {
        return { error: String(e?.message ?? e) };
      }
    })(),
  };
}
