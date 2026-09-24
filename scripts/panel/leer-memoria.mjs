/**
 * La MEMORIA del agente, como llega: no los archivos que el arnés exige, sino lo que el agente lee
 * sin que nadie se lo pida, de dónde sale, quién lo ve y cuánto pesa.
 *
 *   al arrancar   las guías (del usuario, de las carpetas de arriba, del repo, locales) con sus
 *                 `@imports`, el índice de la memoria automática, las DESCRIPCIONES de skills,
 *                 subagentes y comandos, y —si el repo lo permite— lo que imprimen los hooks de
 *                 `SessionStart`. Es lo que AGREGAN el repo y esta máquina: el prompt del sistema,
 *                 las herramientas y lo que traen los plugins o MCP no se ven desde acá.
 *   selectiva     lo que entra sólo cuando algo lo dispara: el cuerpo de skills, subagentes y
 *                 comandos, lo que pueden inyectar los hooks de pedido, los docs que la guía cita,
 *                 las guías de subcarpeta. Con cuánto se USÓ cada cosa, leído de las transcripciones.
 *   personal      la memoria automática de Claude Code en ESTA máquina: la escribe el agente, no
 *                 la ve el equipo ni CI, y nadie verifica que siga apuntando a algo que existe.
 *   versionada    las decisiones (ADR) con su estado: memoria del porqué, en el repo.
 *
 * Lo versionado es determinista y va al modelo de fuentes; lo que depende de la máquina va a la
 * capa en vivo. Todo lo externo —el home, git, el reloj— entra inyectado. Los tokens son una
 * ESTIMACIÓN (caracteres / 4) y así se dicen. Y el panel dice lo que MIDIÓ: no llama «vencida» ni
 * «peso muerto» a lo que no puede saber.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseHookCommand } from "../../.claude/hooks/harness.mjs";

/** Claude Code carga las primeras 200 líneas de `MEMORY.md` en cada sesión; el resto, bajo demanda. */
export const LINEAS_DE_MEMORY_QUE_CARGA = 200;

export const tokensAprox = (texto) => Math.ceil(String(texto ?? "").length / 4);
const tokensDeChars = (n) => Math.ceil((n ?? 0) / 4);

const leer = (abs) => {
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};

const gitPorDefecto = (dir, args) => {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? String(r.stdout ?? "") : "";
};

/**
 * La especificación de la memoria. Nada de acá supone un repo: qué hook lee qué clave del config
 * (`promptSources`), dónde viven los ADR, el umbral de «caro» y la ventana son config.
 * `runSessionHooks` es OPT-IN: ejecutar hooks desde el panel es ejecutar código del repo en cada
 * gate, y de un script tampoco se sabe si escribe estado hasta que alguien lo revisó.
 */
export function specDeMemoria(config = {}) {
  const m = config.panel?.memory ?? {};
  return {
    decisionsDir: m.decisionsDir ?? "docs/decisions",
    injectBudgetTokens: Number.isFinite(m.injectBudgetTokens) ? m.injectBudgetTokens : null,
    personal: m.personal !== false,
    transcripts: m.transcripts !== false,
    runSessionHooks: m.runSessionHooks === true,
    promptSources: Array.isArray(m.promptSources) ? m.promptSources : [],
    costlyTokens: Number.isFinite(m.costlyTokens) ? m.costlyTokens : 1000,
    windowDays: Number.isFinite(m.windowDays) ? m.windowDays : 14,
    statusWords: Array.isArray(m.statusWords) && m.statusWords.length ? m.statusWords : ["Estado", "Status"],
    decisionsPattern: typeof m.decisionsPattern === "string" && m.decisionsPattern ? m.decisionsPattern : "^\\d{3,4}-.*\\.md$",
    statusTones: { ...TONOS_DE_ESTADO, ...(m.statusTones && typeof m.statusTones === "object" ? m.statusTones : {}) },
  };
}

/** Dónde vive la config de Claude Code en esta máquina: `CLAUDE_CONFIG_DIR` o `~/.claude`. */
export const dirDeClaude = (home, env = process.env) => env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");

/** Una ruta para mostrar: relativa al repo si está adentro, con `~` si está en el home. */
export function mostrable(abs, raiz, home) {
  const rel = path.relative(raiz, abs);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
  const deHome = path.relative(home, abs);
  if (deHome && !deHome.startsWith("..") && !path.isAbsolute(deHome)) return `~/${deHome.split(path.sep).join("/")}`;
  return abs;
}

// ── @imports de una guía ────────────────────────────────────────────────────

/**
 * `@ruta` fuera de bloques y spans de código, como los resuelve Claude Code: relativo al archivo
 * que importa, o al home con `~/`. Recursivo con tope, y un archivo se cuenta una sola vez.
 */
export function importsDe(texto) {
  const salida = [];
  let enBloque = false;
  for (const linea of String(texto ?? "").split("\n")) {
    if (/^\s*```/.test(linea)) {
      enBloque = !enBloque;
      continue;
    }
    if (enBloque) continue;
    const sinCodigo = linea.replace(/`[^`]*`/g, "");
    for (const m of sinCodigo.matchAll(/(^|\s)@((?:~\/|\.{0,2}\/)?[\w./-]+\.[\w]+)/g)) salida.push(m[2]);
  }
  return salida;
}

export function guiaConImports(abs, { home, via = null, vistos = new Set(), profundidad = 0 } = {}) {
  const real = path.resolve(abs);
  if (vistos.has(real) || profundidad > 5) return [];
  vistos.add(real);
  const texto = leer(real);
  if (texto === null) return via ? [{ abs: real, existe: false, via, lineas: 0, chars: 0 }] : [];
  const piezas = [{ abs: real, existe: true, via, lineas: texto.split("\n").length, chars: texto.length }];
  for (const imp of importsDe(texto)) {
    const destino = imp.startsWith("~/") ? path.join(home, imp.slice(2)) : path.resolve(path.dirname(real), imp);
    piezas.push(...guiaConImports(destino, { home, via: real, vistos, profundidad: profundidad + 1 }));
  }
  return piezas;
}

/**
 * Las guías que Claude Code carga al arrancar en este repo: la del usuario, las de las carpetas de
 * ARRIBA del repo (se leen desde el directorio de trabajo hacia la raíz del disco), la del repo, la
 * de `.claude/` y la local (`CLAUDE.local.md`, que no se versiona). Cada una con sus imports.
 */
export function guiasAlArrancar(raiz, { home, claudeDir, versionados = null }) {
  const guias = [];
  const vistos = new Set();
  const agregar = (abs, capa, quien) => {
    for (const p of guiaConImports(abs, { home, vistos })) guias.push({ ...p, capa: p.via ? "importado por una guía" : capa, quien: p.via ? quienDeRuta(p.abs, raiz, versionados) : quien });
  };
  agregar(path.join(claudeDir, "CLAUDE.md"), "guía del usuario", "sólo esta máquina");
  const ancestros = [];
  for (let d = path.dirname(path.resolve(raiz)); d !== path.dirname(d); d = path.dirname(d)) ancestros.unshift(d);
  for (const d of ancestros) agregar(path.join(d, "CLAUDE.md"), "guía de una carpeta de arriba", "sólo esta máquina");
  agregar(path.join(raiz, "CLAUDE.md"), "guía del repo", quienDeRuta(path.join(raiz, "CLAUDE.md"), raiz, versionados));
  agregar(path.join(raiz, ".claude", "CLAUDE.md"), "guía del repo (.claude/)", quienDeRuta(path.join(raiz, ".claude", "CLAUDE.md"), raiz, versionados));
  agregar(path.join(raiz, "CLAUDE.local.md"), "guía local", "sólo esta máquina");
  return guias;
}

/**
 * Quién ve un archivo: el equipo si git lo VERSIONA, sólo esta máquina si no. Estar adentro del
 * repo no alcanza: un `.tessl/RULES.md` ignorado por git se importa desde la guía y en otra
 * máquina no existe. Sin git a mano, adentro del repo se supone versionado.
 */
function quienDeRuta(abs, raiz, versionados = null) {
  const rel = path.relative(raiz, abs);
  const adentro = rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  if (!adentro) return "sólo esta máquina";
  if (versionados && !versionados.has(rel.split(path.sep).join("/"))) return "sólo esta máquina";
  return "el equipo (versionado)";
}

// ── frontmatter ─────────────────────────────────────────────────────────────

/**
 * Frontmatter `---` mínimo: `clave: valor`, y también el valor en VARIAS líneas (bloques `>` /
 * `|` de YAML, o continuación con sangría). Sin eso, una descripción larga se leía como «>» —un
 * caracter— y el costo fijo de las skills salía corto. `type` también se lee bajo `metadata:`.
 */
export function frontmatterDe(texto) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(texto ?? ""));
  if (!m) return {};
  const datos = {};
  const lineas = m[1].split("\n");
  const sangriaDe = (l) => l.search(/\S/);
  const esClave = (l) => /^\s*[\w-]+:(\s|$)/.test(l);
  for (let i = 0; i < lineas.length; i += 1) {
    const kv = /^(\s*)([\w-]+):\s*(.*)$/.exec(lineas[i]);
    if (!kv) continue;
    const sangria = kv[1].length;
    const bloque = /^[>|][+-]?$/.test(kv[3].trim());
    let valor = bloque ? "" : kv[3];
    // Valor vacío sin bloque = mapa anidado (`metadata:`): sus claves se leen como claves.
    if (bloque || valor.trim() !== "") {
      const siguen = [];
      while (i + 1 < lineas.length) {
        const l = lineas[i + 1];
        if (l.trim() !== "" && sangriaDe(l) <= sangria) break;
        if (!bloque && esClave(l)) break;
        siguen.push(l.trim());
        i += 1;
      }
      valor = [valor, ...siguen].filter(Boolean).join(" ");
    }
    valor = valor.trim().replace(/^["']|["']$/g, "");
    if (valor !== "" && !(kv[2] in datos)) datos[kv[2]] = valor;
  }
  return datos;
}

// ── memoria automática (personal) ───────────────────────────────────────────

/**
 * Rutas del repo citadas entre backticks, relativas a la raíz (sin `../`, sin absolutas): con una
 * carpeta y una extensión, o un archivo suelto de la raíz con extensión. Ninguna lista de
 * extensiones: la primera versión traía `md|json|mjs|js|ts|yml|yaml` y en un repo de Python un
 * `setup.py` citado no se verificaba. Un token con `.` que no es un archivo (`v1.2`, `foo.bar()`)
 * no pasa: la extensión tiene que empezar con letra y el nombre no puede terminar en paréntesis.
 */
export function rutasDelRepo(texto) {
  const rutas = new Set();
  for (const span of String(texto ?? "").matchAll(/`([^`\s]+)`/g)) {
    const r = span[1].replace(/[.,;:)]+$/, "");
    if (/^(https?:|~|\/|\.\.)/.test(r) || r.includes("<") || r.includes("*") || r.includes("(")) continue;
    if (/^[\w.@-][\w./@-]*\.[a-z][a-z0-9]{0,7}$/i.test(r)) rutas.add(r.replace(/^\.\//, ""));
  }
  return [...rutas].sort();
}

/**
 * La memoria automática de este repo en esta máquina. Cada entrada con su tipo, su edad, las rutas
 * del repo que cita —medidas contra lo que git versiona, no contra el disco: un derivado local no
 * cuenta como «existe»— y si el índice la anuncia. Una ruta que no resuelve NO prueba que la
 * memoria esté vencida: puede ser abreviada o de otro repo. El panel dice que no resuelve.
 */
export function leerMemoriaPersonal(raiz, dir, { ahora = new Date(), versionados = null } = {}) {
  if (!dir || !existsSync(dir)) return { dir, existe: false, indice: null, entradas: [], fueraDelIndice: [], conRutasRotas: 0 };
  const indiceTexto = leer(path.join(dir, "MEMORY.md"));
  const archivos = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md").sort();
  const anunciados = new Set([...(indiceTexto ?? "").matchAll(/\]\(([^)\s]+\.md)\)/g)].map((m) => path.posix.normalize(m[1]).replace(/^\.\//, "")));
  const existeEnRepo = (r) => (versionados ? versionados.has(r) || [...versionados].some((v) => v.startsWith(`${r.replace(/\/$/, "")}/`)) : existsSync(path.join(raiz, r)));
  const entradas = archivos.map((f) => {
    const texto = leer(path.join(dir, f)) ?? "";
    const fm = frontmatterDe(texto);
    let dias = null;
    try {
      dias = Math.floor((ahora.getTime() - statSync(path.join(dir, f)).mtimeMs) / 86400000);
    } catch {
      dias = null;
    }
    return {
      archivo: f,
      nombre: fm.name ?? f.replace(/\.md$/, ""),
      descripcion: fm.description ?? "",
      tipo: fm.type ?? fm.node_type ?? null,
      dias,
      lineas: texto.split("\n").length,
      chars: texto.length,
      anunciada: anunciados.has(f),
      rutas: rutasDelRepo(texto.replace(/^---[\s\S]*?\n---/, "")).map((r) => ({ ruta: r, existe: existeEnRepo(r) })),
    };
  });
  const lineas = (indiceTexto ?? "").split("\n");
  return {
    dir,
    existe: true,
    indice: indiceTexto === null ? null : { lineas: lineas.length, chars: indiceTexto.length, cargadas: Math.min(lineas.length, LINEAS_DE_MEMORY_QUE_CARGA), cargadoChars: lineas.slice(0, LINEAS_DE_MEMORY_QUE_CARGA).join("\n").length, recortado: lineas.length > LINEAS_DE_MEMORY_QUE_CARGA },
    entradas,
    fueraDelIndice: entradas.filter((e) => !e.anunciada).map((e) => e.archivo),
    conRutasRotas: entradas.filter((e) => e.rutas.some((r) => !r.existe)).length,
  };
}

// ── lo que imprimen los hooks de arranque (opt-in) ──────────────────────────

/** ¿Un grupo de hooks de SessionStart corre al ARRANCAR (y no sólo al compactar o reanudar)? */
const correAlArrancar = (matcher) => {
  if (!matcher || matcher === "*") return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test("startup");
  } catch {
    return false;
  }
};

/**
 * Corre los hooks de `SessionStart` que corren al arrancar, como los corre Claude Code (stdin JSON
 * del evento, cwd en la raíz, `CLAUDE_PROJECT_DIR`), y se queda con lo que entra al contexto: el
 * `additionalContext` si la salida es JSON, si no el stdout. Sólo `node <script>` del repo —de un
 * binario externo no se sabe nada—, y sólo si el config lo pidió (`runSessionHooks: true`).
 * `HARNESS_PANEL=1` en el entorno le permite al hook saber que lo está midiendo el panel.
 */
export function salidaDeSesion(raiz, settings, { timeoutMs = 15000, ejecutar = null } = {}) {
  const salida = [];
  const correr =
    ejecutar ??
    ((archivo) =>
      spawnSync(process.execPath, [archivo], {
        cwd: raiz,
        input: JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd: raiz, session_id: "harness-panel" }),
        encoding: "utf8",
        timeout: timeoutMs,
        windowsHide: true,
        env: { ...process.env, CLAUDE_PROJECT_DIR: raiz, HARNESS_PANEL: "1" },
      }));
  for (const grupo of settings?.hooks?.SessionStart ?? []) {
    if (!correAlArrancar(grupo?.matcher)) continue;
    for (const h of grupo?.hooks ?? []) {
      const c = parseHookCommand(h.command);
      if (!c || c.tipo !== "script") {
        salida.push({ hook: c?.etiqueta ?? String(h.command), corrido: false, motivo: "no es un script del repo: no se ejecuta a ciegas" });
        continue;
      }
      const t0 = Date.now();
      const r = correr(path.join(raiz, c.file));
      let texto = String(r.stdout ?? "");
      try {
        const j = JSON.parse(texto);
        if (typeof j?.hookSpecificOutput?.additionalContext === "string") texto = j.hookSpecificOutput.additionalContext;
      } catch {
        /* texto plano: es lo que entra */
      }
      salida.push({ hook: c.file, corrido: true, status: r.status, ms: Date.now() - t0, texto, lineas: texto ? texto.split("\n").length : 0, chars: texto.length });
    }
  }
  return salida;
}

// ── decisiones (versionado, determinista) ───────────────────────────────────

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Qué palabras del estado de un ADR se pintan de qué color. Default en dos idiomas; el repo lo cambia. */
export const TONOS_DE_ESTADO = {
  verde: ["aceptad", "accepted", "vigente", "approved"],
  info: ["propuest", "proposed", "borrador", "draft"],
  neutro: ["reemplaz", "supersed", "obsolet", "deprecad", "deprecated", "rechazad", "rejected"],
};

/**
 * Los ADR con título y estado. El estado es una LÍNEA propia (`- **Estado:** aceptado`): así un
 * título que contiene la palabra no engaña. Las palabras que valen (`Estado`, `Status`) son config.
 */
export function leerDecisiones(raiz, dir, palabras = ["Estado", "Status"], { patron = "^\\d{3,4}-.*\\.md$", tonos = TONOS_DE_ESTADO } = {}) {
  const abs = path.join(raiz, dir);
  if (!existsSync(abs)) return { dir, existe: false, adr: [] };
  const reEstado = new RegExp(`^\\s*[-*]?\\s*\\**(?:${palabras.map(escaparRegex).join("|")})\\**\\s*:\\s*\\**\\s*(.+)$`, "im");
  let reArchivo;
  try {
    reArchivo = new RegExp(patron);
  } catch {
    reArchivo = /^\d{3,4}-.*\.md$/;
  }
  const tonoDe = (estado) => {
    const bajo = estado.toLowerCase();
    for (const [tono, palabrasDelTono] of Object.entries(tonos)) if ((palabrasDelTono ?? []).some((w) => bajo.includes(String(w).toLowerCase()))) return tono;
    return "advertencia";
  };
  const adr = readdirSync(abs)
    .filter((f) => reArchivo.test(f))
    .sort()
    .map((f) => {
      const t = leer(path.join(abs, f)) ?? "";
      const estado = reEstado.exec(t)?.[1]?.replace(/\*+/g, "").trim() || "sin estado";
      const tono = tonoDe(estado);
      return { archivo: `${dir}/${f}`, titulo: (/^#\s+(.+)$/m.exec(t)?.[1] ?? f).trim(), estado, tono };
    });
  return { dir, existe: true, adr };
}

// ── selectiva: lo que entra sólo cuando algo lo dispara ─────────────────────

/** El cuerpo de un markdown sin su frontmatter. */
const cuerpoDe = (texto) => String(texto ?? "").replace(/^---\n[\s\S]*?\n---\n?/, "");

/** Los `.md` de una carpeta, también en subcarpetas (`ns/cmd.md` → `ns:cmd`, como los nombra Claude Code). */
function mdsRecursivos(dir, prefijo = "") {
  if (!existsSync(dir)) return [];
  const salida = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.isDirectory()) salida.push(...mdsRecursivos(path.join(dir, e.name), `${prefijo}${e.name}:`));
    else if (e.name.endsWith(".md")) salida.push({ abs: path.join(dir, e.name), nombre: `${prefijo}${e.name.replace(/\.md$/, "")}` });
  }
  return salida;
}

/**
 * Skills, subagentes y comandos, del repo y del usuario. Cada uno cuesta DOS veces: su descripción
 * entra en cada sesión (el agente la necesita para elegir) y su cuerpo sólo cuando se dispara. Una
 * skill con `disable-model-invocation: true` no anuncia su descripción: sólo la dispara el humano.
 */
export function leerInvocables(raiz, claudeDir) {
  const salida = [];
  const fuentes = [
    ["repo", path.join(raiz, ".claude"), "el equipo (versionado)"],
    ["usuario", claudeDir, "sólo esta máquina"],
  ];
  for (const [origen, dirClaude, quien] of fuentes) {
    const skills = path.join(dirClaude, "skills");
    if (existsSync(skills))
      for (const d of readdirSync(skills).sort()) {
        const f = path.join(skills, d, "SKILL.md");
        const t = leer(f);
        if (t === null) continue;
        const fm = frontmatterDe(t);
        const oculta = String(fm["disable-model-invocation"] ?? "") === "true";
        salida.push({ tipo: "skill", nombre: fm.name ?? d, origen, quien, abs: f, anuncia: !oculta, descChars: oculta ? 0 : (fm.description ?? "").length, cuerpoChars: cuerpoDe(t).length });
      }
    for (const [tipo, sub] of [["subagente", "agents"], ["comando", "commands"]]) {
      for (const { abs, nombre } of mdsRecursivos(path.join(dirClaude, sub))) {
        const t = leer(abs) ?? "";
        const fm = frontmatterDe(t);
        salida.push({ tipo, nombre: tipo === "comando" ? nombre : (fm.name ?? nombre), origen, quien, abs, anuncia: true, descChars: (fm.description ?? "").length, cuerpoChars: cuerpoDe(t).length });
      }
    }
  }
  return salida;
}

const valorEn = (obj, ruta) => String(ruta).split(".").reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), obj);

/**
 * Lo que los hooks de pedido pueden inyectar. Qué hook lee qué clave del config lo declara
 * `panel.memory.promptSources` (`[{ hook, key }]`, con `key` apuntando a una lista de
 * `{ route, patterns, message }`): así se mide sin ejecutar nada. Un hook sin fuente declarada
 * figura como NO medido —correr un hook de pedido puede cambiar estado de la sesión—.
 */
export function rutasDelPrompt(config, settings, fuentes = []) {
  const salida = [];
  for (const grupo of settings?.hooks?.UserPromptSubmit ?? []) {
    for (const h of grupo?.hooks ?? []) {
      const c = parseHookCommand(h.command);
      const hook = c?.file ?? String(h.command);
      const fuente = fuentes.find((f) => {
        try {
          return f?.hook && new RegExp(f.hook).test(hook);
        } catch {
          return false;
        }
      });
      const rutas = fuente ? valorEn(config, fuente.key) : null;
      if (Array.isArray(rutas) && rutas.length)
        for (const r of rutas) salida.push({ hook, ruta: r.route ?? r.name ?? "?", patrones: (r.patterns ?? []).length, chars: String(r.message ?? "").length, medido: true });
      else salida.push({ hook, ruta: null, patrones: null, chars: null, medido: false });
    }
  }
  return salida;
}

/** Documentos que las guías citan: el agente los lee siguiendo el puntero, no en cada sesión. */
export function docsCitados(raiz, textos, yaCargados = new Set()) {
  const rutas = new Set();
  for (const t of textos) {
    for (const m of String(t).matchAll(/`([^`\s]+\.md)`|\]\(([^)\s#]+\.md)/g)) {
      const r = path.posix.normalize((m[1] ?? m[2]).replace(/^\.\//, ""));
      // Lo que ya entra por @import es memoria FIJA: contarlo acá sería contarlo dos veces.
      if (!/^(https?:|~|\/|\.\.)/.test(r) && !r.includes("<") && !yaCargados.has(r)) rutas.add(r);
    }
  }
  return [...rutas].sort().map((r) => {
    const t = leer(path.join(raiz, r));
    return { ruta: r, existe: t !== null, chars: t?.length ?? 0 };
  });
}

/** Un comando de shell que ESCRIBE en el archivo no es una lectura. */
const escribe = (comando, ruta) => new RegExp(`(>>?\\s*['"]?\\S*${escaparRegex(ruta)}|\\btee\\b[^|;&]*${escaparRegex(ruta)}|\\bgit\\s+(add|commit|rm|mv)\\b|\\bsed\\s+-i\\b|\\b(cp|mv)\\b[^|;&]*${escaparRegex(ruta)}\\s*$)`).test(comando);
const nombra = (texto, ruta) => new RegExp(`(^|[\\s'"=/(])${escaparRegex(ruta)}($|[\\s'"\`;|&)])`).test(texto);

/** Las transcripciones de la ventana: las de cada sesión y las de sus subagentes. */
function transcripciones(dir, desdeMs) {
  const salida = [];
  const recorrer = (d, profundidad) => {
    let entradas;
    try {
      entradas = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      const abs = path.join(d, e.name);
      if (e.isDirectory() && profundidad < 2 && e.name !== "memory") recorrer(abs, profundidad + 1);
      else if (e.name.endsWith(".jsonl")) {
        try {
          if (statSync(abs).mtimeMs >= desdeMs) salida.push({ abs, subagente: profundidad > 0 });
        } catch {
          /* se borró mientras se leía */
        }
      }
    }
  };
  recorrer(dir, 0);
  return salida.sort((a, b) => (a.abs < b.abs ? -1 : 1));
}

/**
 * Cuántas veces se USÓ cada pieza selectiva en la ventana, leído de las transcripciones de este
 * repo en esta máquina (también las de los subagentes). La ventana son días CALENDARIO (UTC), la
 * misma que usa el consumo de tokens. Las lecturas de un doc se cuentan por `Read` y por un
 * comando de shell que lo NOMBRA y no escribe en él: es una aproximación y así se dice.
 */
export function leerUsos(dir, { ahora = new Date(), dias = 14, rutas = [] } = {}) {
  if (!dir || !existsSync(dir)) return null;
  const desde = new Date(ahora.getTime() - (dias - 1) * 86400000).toISOString().slice(0, 10);
  const cuenta = { skill: {}, subagente: {}, comando: {}, lectura: {} };
  const sumar = (tipo, nombre) => (cuenta[tipo][nombre] = (cuenta[tipo][nombre] ?? 0) + 1);
  const archivos = transcripciones(dir, Date.parse(`${desde}T00:00:00Z`));
  const vistos = new Set();
  for (const { abs } of archivos) {
    const texto = leer(abs) ?? "";
    for (const linea of texto.split("\n")) {
      if (!linea) continue;
      const tieneUso = linea.includes('"tool_use"');
      const tieneComando = linea.includes("<command-name>");
      if (!tieneUso && !tieneComando) continue;
      let j;
      try {
        j = JSON.parse(linea);
      } catch {
        continue;
      }
      if (j.timestamp && String(j.timestamp).slice(0, 10) < desde) continue;
      if (tieneComando && j.type === "user") {
        const contenido = typeof j.message?.content === "string" ? j.message.content : JSON.stringify(j.message?.content ?? "");
        for (const m of contenido.matchAll(/<command-name>\/?([^<]+)<\/command-name>/g)) sumar("comando", m[1].trim());
      }
      if (!tieneUso) continue;
      for (const c of j.message?.content ?? []) {
        if (c?.type !== "tool_use") continue;
        if (c.id && vistos.has(c.id)) continue;
        if (c.id) vistos.add(c.id);
        if (c.name === "Skill" && c.input?.skill) sumar("skill", String(c.input.skill));
        else if ((c.name === "Agent" || c.name === "Task") && c.input?.subagent_type) sumar("subagente", String(c.input.subagent_type));
        if (c.name === "Read") {
          const donde = String(c.input?.file_path ?? "");
          for (const r of rutas) if (donde.endsWith(`/${r}`) || donde === r) sumar("lectura", r);
        } else if (c.name === "Bash") {
          const cmd = String(c.input?.command ?? "");
          for (const r of rutas) if (nombra(cmd, r) && !escribe(cmd, r)) sumar("lectura", r);
        }
      }
    }
  }
  return { dias, desde, sesiones: archivos.filter((a) => !a.subagente).length, subagentes: archivos.filter((a) => a.subagente).length, ...cuenta };
}

/** Las guías de subcarpeta: Claude Code las carga cuando el agente toca archivos de esa carpeta. */
export function guiasDeSubcarpeta(raiz, git = gitPorDefecto) {
  return String(git(raiz, ["ls-files", "--", ":(glob)**/CLAUDE.md"]))
    .split("\n")
    .filter((x) => x && x.includes("/"))
    .sort()
    .map((ruta) => ({ ruta, carpeta: path.posix.dirname(ruta), chars: leer(path.join(raiz, ruta))?.length ?? 0 }));
}

// ── ensamble en vivo ────────────────────────────────────────────────────────

/**
 * Lo que el agente lee al arrancar, lo que entra sólo cuando algo lo dispara y la memoria personal.
 * `home`, `env`, `git`, `dirTranscripciones` y `ejecutarHook` se inyectan para probar sin máquina.
 */
export function construirMemoriaEnVivo(raiz, { settings = {}, config = {}, spec, dirTranscripciones = null, home = os.homedir(), env = process.env, git = gitPorDefecto, ejecutarHook = null, ahora = new Date() }) {
  const claudeDir = dirDeClaude(home, env);
  const dirMemoria = dirTranscripciones ? path.join(dirTranscripciones, "memory") : null;
  const ruta = (abs) => mostrable(abs, raiz, home);
  const piezas = [];

  const versionados = new Set(String(git(raiz, ["ls-files"])).split("\n").filter(Boolean));
  const guias = guiasAlArrancar(raiz, { home, claudeDir, versionados: versionados.size ? versionados : null });
  for (const g of guias) piezas.push({ capa: g.capa, quien: g.quien, ruta: ruta(g.abs), via: g.via ? ruta(g.via) : null, existe: g.existe, lineas: g.lineas, chars: g.chars, tokens: tokensDeChars(g.chars) });

  const personal = spec.personal ? leerMemoriaPersonal(raiz, dirMemoria, { ahora, versionados: versionados.size ? versionados : null }) : null;
  if (personal?.indice) piezas.push({ capa: "índice de la memoria automática", quien: "sólo esta máquina", ruta: ruta(path.join(dirMemoria, "MEMORY.md")), via: null, existe: true, lineas: personal.indice.cargadas, chars: personal.indice.cargadoChars, tokens: tokensDeChars(personal.indice.cargadoChars) });

  // Las DESCRIPCIONES de skills, subagentes y comandos entran en cada sesión: el agente las
  // necesita para elegir. Faltaban en la primera versión y el costo fijo salía corto.
  const invocables = leerInvocables(raiz, claudeDir);
  for (const origen of ["repo", "usuario"]) {
    const deAca = invocables.filter((x) => x.origen === origen && x.anuncia);
    if (!deAca.length) continue;
    const chars = deAca.reduce((n, x) => n + x.descChars + x.nombre.length, 0);
    piezas.push({ capa: "descripciones de skills, subagentes y comandos", quien: deAca[0].quien, ruta: `${deAca.length} en ${origen === "repo" ? ".claude/" : ruta(claudeDir) + "/"}`, via: null, existe: true, lineas: deAca.length, chars, tokens: tokensDeChars(chars) });
  }

  const sesion = spec.runSessionHooks ? salidaDeSesion(raiz, settings, { ejecutar: ejecutarHook }) : [];
  for (const x of sesion.filter((y) => y.corrido)) piezas.push({ capa: "hook SessionStart", quien: "se calcula al arrancar", ruta: x.hook, via: null, existe: x.status === 0, lineas: x.lineas, chars: x.chars, tokens: tokensAprox(x.texto) });
  const hooksDeSesion = (settings?.hooks?.SessionStart ?? []).flatMap((g) => g?.hooks ?? []).length;

  const total = piezas.reduce((n, x) => n + (x.existe ? x.tokens : 0), 0);

  // Selectiva: el costo cuando algo la dispara, y cuántas veces algo la disparó.
  const yaCargados = new Set(guias.filter((g) => g.existe).map((g) => ruta(g.abs)));
  const docs = docsCitados(raiz, guias.filter((g) => g.existe).map((g) => leer(g.abs) ?? ""), yaCargados);
  const usos = spec.transcripts ? leerUsos(dirTranscripciones, { ahora, dias: spec.windowDays, rutas: [...docs.map((d) => d.ruta), ...(personal?.entradas ?? []).map((e) => e.archivo)] }) : null;
  const usosDe = (tipo, nombre) => (usos ? (usos[tipo][nombre] ?? 0) : null);
  // Una skill también se dispara escribiendo `/nombre`: queda como comando en la transcripción.
  const usosDeInvocable = (x) => (usos === null ? null : x.tipo === "skill" ? usosDe("skill", x.nombre) + usosDe("comando", x.nombre) : usosDe(x.tipo, x.nombre));
  const inventariadas = new Set(invocables.filter((x) => x.tipo === "skill").map((x) => x.nombre));
  const selectiva = {
    invocables: invocables.map((x) => ({ tipo: x.tipo, nombre: x.nombre, origen: x.origen, quien: x.quien, anuncia: x.anuncia, ruta: ruta(x.abs), descTokens: tokensDeChars(x.descChars), cuerpoTokens: tokensDeChars(x.cuerpoChars), usos: usosDeInvocable(x) })),
    // Skills que se usaron y no están en el repo ni en el home: vienen de un plugin o son del
    // cliente. Su costo no se ve desde acá, y eso se dice.
    usadasSinInventario: usos ? Object.entries(usos.skill).filter(([n]) => !inventariadas.has(n)).map(([nombre, veces]) => ({ nombre, veces })).sort((a, b) => b.veces - a.veces) : [],
    prompt: rutasDelPrompt(config, settings, spec.promptSources).map((r) => ({ ...r, tokens: r.chars === null ? null : tokensDeChars(r.chars) })),
    docs: docs.map((d) => ({ ...d, tokens: tokensDeChars(d.chars), lecturas: usosDe("lectura", d.ruta) })),
    subcarpetas: guiasDeSubcarpeta(raiz, git).map((g) => ({ ...g, tokens: tokensDeChars(g.chars) })),
    usos: usos ? { dias: usos.dias, desde: usos.desde, sesiones: usos.sesiones, subagentes: usos.subagentes } : null,
    costlyTokens: spec.costlyTokens,
  };
  if (personal?.existe) for (const e of personal.entradas) e.lecturas = usosDe("lectura", e.archivo);

  return {
    alArrancar: { piezas, total, presupuesto: spec.injectBudgetTokens, excede: spec.injectBudgetTokens ? total > spec.injectBudgetTokens : false, hooksDeSesion, hooksCorridos: spec.runSessionHooks },
    sesion,
    selectiva,
    personal: personal ? { ...personal, dir: personal.dir ? ruta(personal.dir) : null } : null,
  };
}
