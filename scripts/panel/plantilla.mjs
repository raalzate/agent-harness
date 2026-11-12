/**
 * Plantilla del panel: modelo → HTML. Una sola página autocontenida: CSS y JS adentro, ninguna
 * carga externa (nada de CDN, fuentes ni telemetría). Lo interactivo —pestañas, búsqueda,
 * filtros, plegado— es JS plano sobre atributos `data-*` que se emiten acá, en Node.
 *
 * Con el modelo de MEMORIA solo es determinista (mismo modelo, mismos bytes). Si el modelo trae
 * `enVivo`, se suma la pestaña «Ahora» y los indicadores de máquina, que sí llevan reloj.
 *
 * Genérica: no nombra ningún archivo del repo. Las rutas que muestra vienen en el modelo
 * (`modelo.rutas`), y la invocación de tareas (`npm run`, `make`…) también.
 */
import {
  accionesPorPestana,
  construirBandeja,
  construirResumen,
  deudaAccionable,
  etapasDelPipeline,
  promptDeAccion,
  promptDeDeuda,
  promptDePendientes,
  promptDeSenal,
  saludDelArnes,
  senalesRojas,
} from "./leer-resumen.mjs";

/** El botón que copia la instrucción para el agente. El texto viaja en el atributo, escapado. */
const botonPrompt = (texto, etiqueta = "Prompt") =>
  texto ? `<button type="button" class="prompt" data-prompt="${escapar(texto)}" title="Copia una instrucción lista para pegarle al agente del arnés">🤖 ${escapar(etiqueta)}</button>` : "";

// ── Markdown inline → HTML ──────────────────────────────────────────────────

export function escapar(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `**negrita**`, `*cursiva*`, `~~tachado~~`, `` `código` `` y los enlaces de markdown; los comentarios HTML se descartan. */
export function inline(texto, rutaRaiz = ".") {
  const enlace = (destino) => (/^https?:/.test(destino) ? destino : `${rutaRaiz}/${destino}`);
  return escapar(String(texto ?? "").replace(/<!--.*?-->/g, ""))
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, d) => `<a href="${escapar(enlace(d))}">${t}</a>`)
    .trim();
}

const MARCA_ITEM = /^\s*(-|\d+\.)\s+/;

/** Párrafos separados por línea en blanco; un bloque que arranca con `- ` o `1. ` es una lista (con continuaciones). */
function parrafos(texto, rutaRaiz) {
  return String(texto ?? "")
    .split(/\n\s*\n/)
    .map((bloque) => bloque.trim())
    .filter(Boolean)
    .map((bloque) => {
      const lineas = bloque.split("\n");
      if (!MARCA_ITEM.test(lineas[0])) return `<p>${inline(lineas.join(" "), rutaRaiz)}</p>`;
      const items = [];
      for (const l of lineas) {
        if (MARCA_ITEM.test(l)) items.push(l.replace(MARCA_ITEM, ""));
        else if (items.length) items[items.length - 1] += " " + l.trim();
      }
      const etiqueta = /^\s*\d+\./.test(lineas[0]) ? "ol" : "ul";
      return `<${etiqueta}>${items.map((it) => `<li>${inline(it, rutaRaiz)}</li>`).join("")}</${etiqueta}>`;
    })
    .join("");
}

// ── Piezas ──────────────────────────────────────────────────────────────────

const TONO_ETIQUETA = { verde: "verde", rojo: "rojo", omitido: "omitida", advertencia: "atención", neutro: "—", info: "diseño" };

const punto = (tono) => `<span class="punto punto--${tono}" title="${TONO_ETIQUETA[tono] ?? tono}"></span>`;

// El espacio final NO es decorativo: dos `inline-block` pegados no dejan dónde cortar la línea, y
// una lista larga de chips estiraba la tabla a 3.469 px (lo mostró la memoria personal).
const chip = (texto, clase = "") => `<span class="chip ${clase}">${texto}</span> `;

// ── Etiquetas ───────────────────────────────────────────────────────────────

/**
 * Las etiquetas vienen DERIVADAS en el modelo (`etiquetasDe`): acá sólo se pintan y se vuelven
 * filtro. Cada chip es un botón, y al portarlas la tarjeta las lleva en `data-etiquetas` rodeadas
 * de `|` para poder preguntar por una sin que «test» matchee dentro de «self-test».
 */
const CLASE_ETIQUETA = { BLOCKING: "etiqueta--fuerte", "sin freno": "etiqueta--mal", "puntero muerto": "etiqueta--mal", gate: "etiqueta--gate" };

const botonEtiqueta = (nombre, cuenta = null) =>
  `<button type="button" class="etiqueta ${CLASE_ETIQUETA[nombre] ?? ""}" data-etiqueta="${escapar(nombre)}">${escapar(nombre)}${
    cuenta === null ? "" : ` <small>${cuenta}</small>`
  }</button>`;

const etiquetasDeTarjeta = (lista) => (lista?.length ? `<span class="etiquetas">${lista.map((t) => botonEtiqueta(t)).join("")}</span>` : "");

/** El atributo por el que filtra el JS. Una tarjeta sin etiquetas igual lo lleva: es un dato, no un hueco. */
const datosEtiquetas = (lista) => `data-etiquetas="|${(lista ?? []).map((t) => escapar(t)).join("|")}|"`;

/** Barra de etiquetas de una pestaña, ordenada por frecuencia y —a igual frecuencia— por nombre. */
function barraDeEtiquetas(items) {
  const cuenta = new Map();
  for (const it of items) for (const t of it.etiquetas ?? []) cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
  if (!cuenta.size) return "";
  // Nunca `localeCompare`: su orden depende del ICU de node y el panel tiene que salir byte a byte igual.
  const orden = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return `<div class="etiquetas etiquetas--barra">
    <span class="etiquetas__titulo">etiquetas</span>
    ${orden.map(([nombre, n]) => botonEtiqueta(nombre, n)).join("")}
    <button type="button" class="etiqueta etiqueta--limpiar" data-etiqueta="">limpiar</button>
  </div>`;
}

/** 1234 → «1,2k», 3400000 → «3,4M». Para los indicadores; las tablas llevan el número entero. */
export function abreviar(n) {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1).replace(".", ",")}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1).replace(".", ",")}k`;
  return String(n);
}

/** Ruta citada con su veredicto: existe · no existe · fuera de las raíces propias (no se afirma). */
function chipRuta(r, rutaRaiz) {
  if (r.existe === true) return `<a class="chip chip--ok" href="${escapar(`${rutaRaiz}/${r.ruta}`)}">${escapar(r.ruta)}</a>`;
  if (r.existe === false) return chip(`${escapar(r.ruta)} · no existe`, "chip--mal");
  return chip(`${escapar(r.ruta)} · no verificable`, "chip--gris");
}

const chipTarea = (s, invocacion) =>
  chip(`${escapar(invocacion ?? "")} ${escapar(s.tarea)}${s.existe === false ? " · no existe" : ""}`, s.existe === false ? "chip--mal" : s.existe ? "chip--ok" : "chip--gris");

function punteros(it, rutaRaiz, invocacion) {
  const todos = [...it.rutas.map((r) => chipRuta(r, rutaRaiz)), ...(it.tareas ?? []).map((s) => chipTarea(s, invocacion))];
  return todos.length ? `<div class="punteros">${todos.join("")}</div>` : "";
}

const vineta = (v, rutaRaiz) =>
  `<li data-buscar><div>${inline(v.texto, rutaRaiz)}</div>${
    v.hijos.length ? `<ul class="hijos">${v.hijos.map((h) => `<li>${inline(h, rutaRaiz)}</li>`).join("")}</ul>` : ""
  }</li>`;

const listaVinetas = (items, rutaRaiz) => (items.length ? `<ul class="vinetas">${items.map((v) => vineta(v, rutaRaiz)).join("")}</ul>` : '<p class="vacio">— nada —</p>');

/** Un bloque plegable de primer nivel. Lo clave nace abierto; el resto, cerrado pero a un clic. */
function seccion(id, titulo, cuerpo, { extra = "", abierta = false, resumen = "" } = {}) {
  return `<details class="bloque" id="${id}" ${abierta ? "open" : ""}><summary><h2>${titulo} ${extra}</h2>${
    resumen ? `<span class="resumen">${resumen}</span>` : ""
  }</summary><div class="bloque__cuerpo">${cuerpo}</div></details>`;
}

const detalles = (resumen, cuerpo, abierto = false, atributos = "") =>
  `<details ${abierto ? "open" : ""} ${atributos}><summary>${resumen}</summary><div class="cuerpo">${cuerpo}</div></details>`;

function tabla(cabeceras, filas, clase = "") {
  if (!filas.length) return '<p class="vacio">— nada —</p>';
  return `<table class="${clase}"><thead><tr>${cabeceras.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${filas
    .map((f) => `<tr data-buscar>${f.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

/** Indicador de tablero: valor grande, etiqueta, tono y adónde lleva. */
const indicador = (valor, etiqueta, { tono = "neutro", href = "", detalle = "" } = {}) =>
  `<a class="indicador indicador--${tono}" href="${href}"><span class="indicador__valor">${valor}</span><span class="indicador__etiqueta">${etiqueta}</span>${
    detalle ? `<span class="indicador__detalle">${detalle}</span>` : ""
  }</a>`;

const ICONO = `<svg class="logo" viewBox="0 0 64 64" width="52" height="52" aria-hidden="true">
<circle cx="32" cy="32" r="30" fill="var(--acento)" opacity=".12"/>
<path d="M14 50h36" stroke="var(--acento)" stroke-width="3" stroke-linecap="round"/>
<path d="M32 46V22" stroke="var(--acento)" stroke-width="4" stroke-linecap="round"/>
<path d="M32 22c-6-6-6-12-2-15M32 22c6-6 6-12 2-15M32 24c-9 0-13-5-13-9M32 24c9 0 13-5 13-9" fill="none" stroke="var(--acento)" stroke-width="3" stroke-linecap="round"/>
<circle cx="24" cy="44" r="2.5" fill="var(--acento)"/><circle cx="41" cy="42" r="2" fill="var(--acento)"/>
</svg>`;


// ── Tiempo ──────────────────────────────────────────────────────────────────

const fecha = (iso) => (iso ? escapar(String(iso).replace("T", " ").slice(0, 16)) : "—");
const segundos = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : "—");

// ── Salud del arnés ─────────────────────────────────────────────────────────

const TONO_DIRECCION = { guía: "info", freno: "rojo", sensor: "verde" };

/** Las alarmas de la salud, más las advertencias de las fuentes: todo lo que un comando ya pone en rojo. */
function alarmasDe(m) {
  return [...(m.arnes?.alarmas ?? []), ...m.advertencias];
}

function seccionMapa(mapa) {
  if (!mapa) {
    return seccion("mapa", "Mapa del arnés", '<p class="vacio">El config no declara <code>taxonomy</code>: no hay forma de ubicar cada pieza en su etapa. Es la clave que lee <code>scripts/harness-map.mjs</code>.</p>', { resumen: "sin taxonomía" });
  }
  const t = mapa.totales;
  const filas = mapa.etapas.map((etapa) => {
    const aca = mapa.piezas.filter((p) => p.etapas.includes(etapa));
    const piezas = aca.length
      ? aca.map((p) => `<span class="pieza" data-buscar>${punto(TONO_DIRECCION[p.dir] ?? "neutro")} <code>${escapar(p.nombre)}</code> <small>${escapar(p.dir)} · ${escapar(p.tipo)}</small></span>`).join("")
      : chip("ningún control", "chip--mal");
    return [`<strong>${escapar(etapa)}</strong>`, `<div class="piezas">${piezas}</div>`];
  });
  return seccion(
    "mapa",
    "Mapa del arnés: qué actúa en cada etapa",
    `<div class="indicadores indicadores--compactos">
      ${indicador(String(t.guia), "guías", { tono: "info", detalle: "antes de decidir" })}
      ${indicador(String(t.freno), "frenos", { tono: "rojo", detalle: "decidido, no ejecutado" })}
      ${indicador(String(t.sensor), "sensores", { tono: "verde", detalle: "después de actuar" })}
      ${indicador(`${t.computacional}/${t.piezas}`, "computacionales", { detalle: `${t.inferencial} inferenciales` })}
      ${indicador(String(mapa.huecos.length), "etapas sin control", { tono: mapa.huecos.length ? "advertencia" : "verde", detalle: mapa.huecos.join(" · ") || "ninguna" })}
    </div>
    ${tabla(["Etapa", "Piezas"], filas, "mapa")}
    <p class="nota">Sale de <code>taxonomy</code> en el config, con la misma función que <code>node scripts/harness-map.mjs</code>. Una etapa vacía es un hueco que decide un humano; una pieza sin clasificar es rojo.</p>`,
    // Plegado: 68 piezas en texto eran la portada de la pestaña y tapaban lo accionable.
    { abierta: false, extra: `<small>${t.piezas}</small>`, resumen: `${t.guia} guías · ${t.freno} frenos · ${t.sensor} sensores${mapa.huecos.length ? ` · ${mapa.huecos.length} etapa(s) sin control` : ""}` },
  );
}

const TONO_ACTIVADOR = { activo: "verde", "instalado y muerto": "rojo", "no instalado": "neutro" };

/**
 * El indicador de la salud: estado en una frase, puntaje (piezas sanas / piezas medidas) y una
 * tarjeta por dimensión con su barra, qué mide, qué está mal y cómo se remedia (con su prompt).
 */
function tableroDeSalud(m) {
  const s = saludDelArnes(m);
  const e = s.estado;
  const tarjeta = (d) => {
    const malos = d.malos.length ? `<ul class="dim__malos">${d.malos.slice(0, 6).map((x) => `<li>${inline(x)}</li>`).join("")}${d.malos.length > 6 ? `<li class="tenue">y ${d.malos.length - 6} más</li>` : ""}</ul>` : "";
    const remedio =
      d.tono === "rojo" || d.tono === "advertencia"
        ? `<div class="dim__remedio"><strong>Cómo se remedia:</strong> ${inline(d.remedio)}${d.comando ? ` <code>${escapar(d.comando)}</code>` : ""}<div class="dim__acciones">${chip(d.dueno === "humano" ? "👤 humano" : "🤖 agente", d.dueno === "humano" ? "chip--atencion" : "chip--info")}${botonPrompt(promptDeAccion({ dueno: d.dueno, texto: `${d.nombre} está en ${d.ok}/${d.total}. Falta: ${d.malos.join("; ")}. ${d.remedio}`, comando: d.comando }, "Salud"))}</div></div>`
        : "";
    return `<article class="dim dim--${d.tono}" id="dim-${d.clave}">
      <div class="dim__cabecera"><span class="pendiente__marca pendiente__marca--${d.tono}" aria-label="${escapar(NOMBRE_TONO[d.tono] ?? d.tono)}">${ICONO_TONO[d.tono] ?? "·"}</span><strong data-buscar>${escapar(d.nombre)}</strong><span class="dim__cifra">${d.total ? `${d.ok}/${d.total}` : "sin dato"}</span></div>
      <span class="kpi__barra" aria-hidden="true"><span class="kpi__lleno kpi__lleno--${d.tono}" style="width:${d.total ? d.pct : 0}%"></span></span>
      <p class="dim__mide">${inline(d.mide)}</p>${d.tono === "omitido" ? '<p class="tenue">Sin dato todavía: aparece después de correr el gate en esta máquina.</p>' : ""}${malos}${remedio}
    </article>`;
  };
  // Primero lo que falla, después lo incompleto, al final lo sano: se lee de arriba hacia abajo.
  const orden = { rojo: 0, advertencia: 1, omitido: 2, verde: 3 };
  const dims = [...s.dimensiones].sort((x, y) => orden[x.tono] - orden[y.tono]);
  return {
    // El estado va ANTES del «Qué hacer»: primero cómo está, después qué hacer.
    previo: `<section class="hero hero--${e.tono}">
      <span class="hero__icono" aria-hidden="true">${ICONO_TONO[e.tono]}</span>
      <div class="hero__texto"><p class="hero__rotulo">Salud del arnés</p><h2>${escapar(e.titular)}</h2><p>${escapar(e.detalle)}</p></div>
      <div class="salud__puntaje">${dona(
        [
          { nombre: "sanas", valor: s.sanas, tono: "verde" },
          { nombre: "con huecos", valor: s.medidas - s.sanas, tono: e.tono === "rojo" ? "rojo" : "advertencia" },
        ],
        { centro: `${s.sanas}/${s.medidas}`, sub: "dimensiones", etiqueta: `${s.sanas} de ${s.medidas} dimensiones sanas` },
      )}<p class="tenue">${s.puntaje} % de las piezas medidas están bien</p></div>
    </section>`,
    cuerpo: `<div class="dims">${dims.map(tarjeta).join("")}</div>
    <p class="nota">Las dimensiones con huecos ponen la salud en atención; si fallan los hooks, los frenos o el self-test, en rojo: con eso roto, el arnés deja de frenar sin avisar. El detalle de cada pieza está en las secciones de abajo.</p>`,
  };
}

function pestanaSalud(m, rutaRaiz) {
  const a = m.arnes;
  const alarmas = alarmasDe(m);
  const cabecera = alarmas.length
    ? `<div class="veredicto veredicto--rojo" data-buscar><div class="veredicto__cabecera">${punto("rojo")} ${alarmas.length} alarma(s) del arnés</div>
        <ul class="vinetas advertencias">${alarmas.map((x) => `<li data-buscar>${inline(x.que, rutaRaiz)} <span class="tenue">— lo pone en rojo <code>${escapar(x.comando)}</code></span></li>`).join("")}</ul></div>`
    : `<div class="veredicto veredicto--verde" data-buscar><div class="veredicto__cabecera">${punto("verde")} Sin alarmas</div>
        <p>Cada hook declarado existe, cada freno instalado tiene su clave, cada señal declara su <code>why</code>, cada control fuera del gate tiene quien lo corra y las fuentes no apuntan a la nada.</p></div>`;

  const activadores = a.activadores.length
    ? tabla(
        ["", "Pieza", "Clave que la activa", "Estado"],
        a.activadores.map((x) => [punto(TONO_ACTIVADOR[x.estado]), `<code>${escapar(x.archivo)}</code>`, `<code>${escapar(x.clave)}</code>`, chip(escapar(x.estado), x.estado === "activo" ? "chip--ok" : x.estado === "instalado y muerto" ? "chip--mal" : "chip--gris")]),
      )
    : '<p class="vacio">El config no declara <code>install.activators</code>.</p>';

  const hooks = tabla(
    ["Evento", "Herramientas", "Hook", "Lanza procesos", "Presupuesto"],
    a.hooks.map((h) => [
      `<code>${escapar(h.evento)}</code>`,
      `<code>${escapar(h.matcher)}</code>`,
      `${punto(h.existe ? "verde" : "rojo")} ${h.tipo === "script" && h.existe ? `<a href="${escapar(`${rutaRaiz}/${h.archivo}`)}"><code>${escapar(h.archivo)}</code></a>` : `<code>${escapar(h.archivo)}</code>`}${h.existe ? "" : " " + chip("no existe", "chip--mal")}`,
      h.lanzaProcesos ? chip("sí · excepción declarada", "chip--info") : "—",
      h.presupuestoMs ? `${h.presupuestoMs} ms` : "—",
    ]),
  );

  const runners = a.runners.length
    ? tabla(["Control", "Lo corre", ""], a.runners.map((r) => [`<code>${escapar(r.clave)}</code>`, `<code>${escapar(r.runner)}</code>`, r.existe ? chip("existe", "chip--ok") : chip("no existe: nadie lo corre", "chip--mal")]))
    : '<p class="vacio">Ningún control declara <code>runner</code>: todo lo que se verifica, se verifica en el gate.</p>';

  const lista = (titulo, items, dir) =>
    `<p data-buscar><strong>${titulo}</strong> ${items.length ? items.map((x) => `<a class="chip" href="${escapar(`${rutaRaiz}/${dir}/${x}${dir.endsWith("skills") ? "/SKILL.md" : ".md"}`)}">${escapar(x)}</a>`).join("") : '<span class="tenue">ninguno</span>'}</p>`;

  const muertos = a.activadores.filter((x) => x.estado === "instalado y muerto").length;
  return [
    tableroDeSalud(m).cuerpo,
    seccion("salud-alarmas", "Alarmas del arnés", cabecera, { abierta: alarmas.length > 0, extra: `<small>${alarmas.length}</small>`, resumen: alarmas.length ? `${alarmas.length} alarma(s)` : "sin alarmas" }),
    seccionMapa(a.mapa),
    seccion("activadores", "Frenos instalados y su clave", `${activadores}<p class="nota">Un freno copiado sin la clave del config que lo enciende queda «instalado y muerto»: el archivo está, no frena nada y ninguna señal se pone roja. La tabla sale de <code>install.activators</code>.</p>`, {
      extra: `<small>${a.activadores.length}</small>`,
      resumen: muertos ? `${muertos} instalado(s) y muerto(s)` : `${a.activadores.filter((x) => x.estado === "activo").length} activos`,
    }),
    seccion("hooks-vivos", "Hooks del agente", `${hooks}<p class="nota">Un hook que lanza procesos cuesta latencia en cada prompt o en cada edición: sólo lo hacen los que <code>purity.except</code> declara, y su precio es el presupuesto de <code>observability</code>.</p>`, { extra: `<small>${a.hooks.length}</small>` }),
    seccion("fuera-del-gate", "Controles fuera del gate", `${runners}<p class="nota">Lo caro o lo que depende del reloj vive en un pipeline programado. Encendido y sin nadie que lo corra es «instalado y muerto».</p>`, { extra: `<small>${a.runners.length}</small>` }),
    seccion("invocables", "Lo que el agente puede invocar", `${lista("Subagentes", a.agentes, ".claude/agents")}${lista("Comandos", a.comandos, ".claude/commands")}${lista("Skills", a.skills, ".claude/skills")}`, {
      resumen: `${a.agentes.length} subagentes · ${a.comandos.length} comandos · ${a.skills.length} skills`,
    }),
  ].join("");
}

// ── «Qué hacer»: lo accionable de cada pestaña, arriba de todo ──────────────

/**
 * La primera cosa de cada pestaña: qué hay que hacer para mejorar lo que la pestaña muestra, con
 * dueño y comando. Si no hay nada, lo dice en verde: también es información.
 */
function bloqueQueHacer(acciones, { vacio = "Nada que hacer en esta vista.", vista = "" } = {}) {
  if (!acciones?.length) return `<section class="que-hacer que-hacer--ok"><h3><span class="pendiente__marca pendiente__marca--verde" aria-hidden="true">✓</span> Qué hacer</h3><p>${escapar(vacio)}</p></section>`;
  const humano = acciones.filter((a) => a.dueno === "humano").length;
  return `<section class="que-hacer"><h3>Qué hacer para mejorar <small>${acciones.length} · 👤 ${humano} · 🤖 ${acciones.length - humano}</small></h3>
    <ol class="acciones">${acciones
      .map(
        (a) => `<li class="accion accion--${a.tono}"><span class="pendiente__marca pendiente__marca--${a.tono === "info" ? "info" : a.tono}" aria-label="${escapar(NOMBRE_TONO[a.tono] ?? a.tono)}">${ICONO_TONO[a.tono] ?? "·"}</span>
          <div>${a.seccion ? `${chip(escapar(a.seccion), "chip--gris")}` : ""}<span data-buscar>${inline(a.texto)}</span>${a.comando ? ` <code>${escapar(a.comando)}</code>` : ""}</div>
          <span class="accion__lado">${chip(a.dueno === "humano" ? "👤 humano" : "🤖 agente", a.dueno === "humano" ? "chip--atencion" : "chip--info")}${botonPrompt(promptDeAccion(a, vista))}</span></li>`,
      )
      .join("")}</ol></section>`;
}

function tarjetaDeuda(d) {
  return `<article class="deuda deuda--${d.dueno}" data-buscar>
    <div class="deuda__cabecera"><strong>${escapar(d.titulo)}</strong>${d.n ? ` <span class="tenue">#${d.n}</span>` : ""} ${chip(d.dueno === "humano" ? "👤 humano" : "🤖 agente", d.dueno === "humano" ? "chip--atencion" : "chip--info")}${d.senales.map((s) => chip(`deja roja «${escapar(s)}»`, "chip--mal")).join("")}<span class="empuje"></span>${botonPrompt(promptDeDeuda(d))}</div>
    ${d.detalle ? `<p class="deuda__detalle">${inline(d.detalle)}</p>` : ""}
    <p class="deuda__remedio ${d.remedio ? "" : "deuda__remedio--falta"}"><strong>Cómo se cierra:</strong> ${d.remedio ? inline(d.remedio) : "no está escrito: hay que definirlo (y registrarlo con <code>node scripts/status.mjs record</code>)."}</p>
    <p class="tenue deuda__pie">${d.fecha ? `abierta el ${escapar(d.fecha)}` : ""}${d.evidencia ? ` · se verifica con <code>${escapar(d.evidencia)}</code>` : ""}</p>
  </article>`;
}

const idDeSenal = (nombre) => `roja-${String(nombre).toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
const NOMBRE_ESTADO = { verde: "pasó", rojo: "falló", omitido: "omitida (no es verde)" };

/**
 * La última corrida como un pipeline: etapas en columnas (como en una forja), cada señal un job
 * con su caja de estado. El tooltip dice qué verifica, cuánto tardó y cuándo fue su último verde:
 * lo que está bien se entiende sin abrir nada. Un job rojo enlaza a su detalle de abajo.
 */
function pipelineDelGate(m) {
  const etapas = etapasDelPipeline(m);
  if (!etapas.length) return "";
  const job = (j) => {
    const tip = `<span class="tip" role="tooltip"><strong>${escapar(j.nombre)}</strong><span>${ICONO_TONO[j.estado]} ${escapar(NOMBRE_ESTADO[j.estado])}${j.ms != null ? ` · ${segundos(j.ms)}` : ""}${j.motivo ? ` · ${escapar(j.motivo)}` : ""}</span>${j.porque ? `<span class="tip__porque">Verifica: ${escapar(j.porque)}</span>` : ""}<span class="tip__pie">${j.ultimoVerde ? `último verde ${fecha(j.ultimoVerde)}` : "sin verde registrado"}${j.comando ? ` · ${escapar(j.comando)}` : ""}</span></span>`;
    const cuerpo = `<span class="job__caja job__caja--${j.estado}" aria-hidden="true">${ICONO_TONO[j.estado]}</span><span class="job__nombre">${escapar(j.nombre)}</span><span class="job__ms">${j.ms != null ? segundos(j.ms) : "—"}</span>${tip}`;
    return j.estado === "rojo"
      ? `<li><a class="job job--${j.estado}" href="#${idDeSenal(j.nombre)}" aria-label="${escapar(j.nombre)}: ${NOMBRE_ESTADO[j.estado]}">${cuerpo}</a></li>`
      : `<li><span class="job job--${j.estado}" tabindex="0" aria-label="${escapar(j.nombre)}: ${NOMBRE_ESTADO[j.estado]}">${cuerpo}</span></li>`;
  };
  return `<ol class="pipeline">${etapas
    .map(
      (e) => `<li class="etapa etapa--${e.estado}"><div class="etapa__cabecera"><span class="job__caja job__caja--${e.estado}" aria-hidden="true">${ICONO_TONO[e.estado]}</span><strong>${escapar(e.nombre)}</strong><small>${e.verdes}/${e.jobs.length} · ${segundos(e.ms)}</small></div><ul class="etapa__jobs">${e.jobs.map(job).join("")}</ul></li>`,
    )
    .join("")}</ol>`;
}

function seccionRojas(m) {
  const rojas = senalesRojas(m);
  const cuerpo = rojas.length
    ? rojas
        .map(
          (r) => `<article class="roja" id="${idDeSenal(r.nombre)}">
          <div class="problema__cabecera"><span class="pendiente__marca pendiente__marca--rojo" aria-label="rojo">✕</span> <strong data-buscar>${escapar(r.nombre)}</strong> <span class="tenue">${escapar(r.motivo)}${r.ultimoVerde ? ` · verde por última vez ${cuando(r.ultimoVerde)}` : " · sin verde registrado en esta máquina"}</span><span class="empuje"></span>${botonPrompt(promptDeSenal(r), "Prompt para arreglarla")}</div>
          <div class="roja__cuerpo">
            <div><h4>Qué falló</h4>${
              r.error.length
                ? `<pre class="error">${r.error.map(escapar).join("\n")}</pre>`
                : `<p class="tenue">El registro sólo guardó «${escapar(r.motivo)}»: la próxima corrida del gate guarda las líneas del error. Para verlo ya: <code>${escapar(r.reproducir ?? "")}</code></p>`
            }</div>
            <div><h4>Cómo se arregla</h4>${
              r.deudas.length
                ? r.deudas.map((d) => `<p>${chip(d.dueno === "humano" ? "👤 humano" : "🤖 agente", d.dueno === "humano" ? "chip--atencion" : "chip--info")} <strong>#${d.n} ${escapar(d.titulo)}</strong></p><p>${inline(d.remedio ?? d.detalle)}</p>`).join("")
                : `<p>Ninguna deuda registrada la explica: leer el error, arreglarlo y volver a correr <code>${escapar(r.reproducir ?? "")}</code>. Si no es nuestra, registrarla como deuda con su remedio.</p>`
            }${r.porque ? `<p class="tenue"><strong>Por qué importa:</strong> ${inline(r.porque)}</p>` : ""}</div>
          </div></article>`,
        )
        .join("")
    : '<p class="ok">✓ Ninguna señal en rojo en la última corrida.</p>';
  return seccion("rojas", "Lo que está en rojo, y cómo se arregla", cuerpo, { abierta: true, extra: `<small>${rojas.length}</small>`, resumen: rojas.length ? rojas.map((r) => r.nombre).join(" · ") : "nada en rojo" });
}

// ── Estado (la prosa verificada) ────────────────────────────────────────────

function tarjetaProyecto(m, rutaRaiz) {
  const p = m.proyecto;
  return `<div class="proyecto" data-buscar>
    ${ICONO}
    <div>
      <h2>${escapar(p.nombre || "Proyecto")}</h2>
      ${p.descripcion ? `<p class="tenue">${inline(p.descripcion, rutaRaiz)}</p>` : ""}
      ${p.presentacion.map((t) => `<p>${inline(t, rutaRaiz)}</p>`).join("")}
    </div>
  </div>`;
}

function pestanaEstado(m, rutaRaiz) {
  const e = m.estado;
  const archivo = m.rutas.status;
  const veredicto = e.veredicto
    ? `<div class="veredicto veredicto--${e.veredicto.tono}" data-buscar>
        <div class="veredicto__cabecera">${punto(e.veredicto.tono)} <span>Veredicto del último gate completo</span>
          <span class="meta">${escapar(e.fechaGate ?? "sin fecha")} · rama <code>${escapar(e.rama ?? "?")}</code></span></div>
        <p>${inline(e.veredicto.texto, rutaRaiz)}</p>
        ${e.veredicto.notas.length ? `<ul class="hijos">${e.veredicto.notas.map((n) => `<li>${inline(n, rutaRaiz)}</li>`).join("")}</ul>` : ""}
      </div>`
    : `<p class="vacio"><code>${escapar(archivo)}</code> no declara veredicto.</p>`;

  const filtros = ["verde", "advertencia", "omitido", "rojo", "neutro"]
    .filter((t) => e.senales.some((s) => s.tono === t))
    .map((t) => `<button class="filtro" data-filtro-grupo="senales" data-filtro="${t}">${punto(t)} ${TONO_ETIQUETA[t]} <small>${e.senales.filter((s) => s.tono === t).length}</small></button>`)
    .join("");
  const senales = e.senales.length
    ? `<div class="filtros" data-filtros="senales"><button class="filtro activo" data-filtro-grupo="senales" data-filtro="">todas <small>${e.senales.length}</small></button>${filtros}</div>
       <table class="senales"><thead><tr><th></th><th>Señal</th><th>Comando</th><th>Resultado</th></tr></thead><tbody>${e.senales
         .map((s) => `<tr data-buscar data-senales="${s.tono}"><td>${punto(s.tono)}</td><td>${inline(s.senal, rutaRaiz)}</td><td><code>${escapar(s.comando)}</code></td><td>${inline(s.resultado, rutaRaiz)}</td></tr>`)
         .join("")}</tbody></table>${e.senalesNota ? detalles("Notas", `<div class="nota">${parrafos(e.senalesNota, rutaRaiz)}</div>`) : ""}`
    : '<p class="vacio">Sin tabla de señales.</p>';

  // La deuda, accionable: cada ítem con su detalle y cómo se cierra (de la bitácora), separada por
  // dueño. Antes eran veinte títulos plegados y ninguna acción.
  const accionable = deudaAccionable(m);
  const humanas = accionable.filter((d) => d.dueno === "humano");
  const agente = accionable.filter((d) => d.dueno === "agente");
  const sinRemedio = accionable.filter((d) => !d.remedio).length;
  const columnaDeuda = (titulo, icono, lista) => `<div><h3>${icono} ${titulo} <small>${lista.length}</small></h3>${lista.length ? lista.map(tarjetaDeuda).join("") : '<p class="vacio">Nada.</p>'}</div>`;
  const deuda = accionable.length
    ? `<div class="kpis kpis--compactos">
        ${tarjetaKpi(String(accionable.length), "deudas abiertas", { tono: "advertencia", detalle: "en la bitácora" })}
        ${tarjetaKpi(String(humanas.length), "las destraba el humano", { tono: humanas.length ? "advertencia" : "verde", detalle: "decisión, cliente o autorización" })}
        ${tarjetaKpi(String(agente.length), "las cierra el agente", { tono: agente.length ? "info" : "verde", detalle: "código o arnés" })}
        ${tarjetaKpi(String(sinRemedio), "sin remedio escrito", { tono: sinRemedio ? "rojo" : "verde", detalle: sinRemedio ? "nadie sabe cómo cerrarlas" : "todas dicen cómo" })}
      </div><div class="dos-columnas dos-columnas--plano">${columnaDeuda("Las destraba el humano", "👤", humanas)}${columnaDeuda("Las cierra el agente", "🤖", agente)}</div>`
    : '<p class="vacio">— nada declarado —</p>';

  const verdes = e.senales.filter((s) => s.tono === "verde").length;
  return [
    seccion("veredicto", "Estado verificado (bitácora)", `${veredicto}<p class="nota">Es lo que <a href="${escapar(`${rutaRaiz}/${archivo}`)}"><code>${escapar(archivo)}</code></a> afirma, con su fecha. Lo que corrió en esta máquina está en «Ahora».</p>`, { abierta: true }),
    seccion("deuda", "Deuda técnica: qué es y cómo se cierra", deuda, { abierta: true, extra: `<small>${accionable.length}</small>`, resumen: `${humanas.length} del humano · ${agente.length} del agente` }),
    e.abiertos.items.length ? seccion("abierto", inline(e.abiertos.titulo, rutaRaiz), listaVinetas(e.abiertos.items, rutaRaiz), { extra: `<small>${e.abiertos.items.length}</small>`, abierta: true }) : "",
    e.bloqueos.length ? seccion("bloqueos", "Bloqueos", listaVinetas(e.bloqueos, rutaRaiz), { extra: `<small>${e.bloqueos.length}</small>`, abierta: true }) : "",
    seccion("senales", "Señales (según la prosa)", senales, { extra: `<small>${e.senales.length}</small>`, resumen: `${verdes} verdes de ${e.senales.length}` }),
  ].join("");
}

// ── Gotchas ─────────────────────────────────────────────────────────────────

function tarjetaGotcha(g, rutaRaiz, invocacion) {
  const fila = (etiqueta, texto) => (texto ? `<div class="campo"><dt>${escapar(etiqueta)}</dt><dd>${inline(texto, rutaRaiz)}</dd></div>` : "");
  const estado = g.ejecutable ? chip("freno ejecutable", "chip--ok") : chip("sin freno ejecutable", "chip--mal");
  return `<article class="tarjeta gotcha" id="gotcha-${g.n}" data-buscar data-gotchas="${g.ejecutable ? "ejecutable" : "sin-freno"}" ${datosEtiquetas(g.etiquetas)}>
    ${detalles(
      `<span class="num">#${g.n}</span> ${inline(g.titulo, rutaRaiz)} ${estado}${etiquetasDeTarjeta(g.etiquetas)}`,
      `<dl>${g.campos.map((c) => fila(c.nombre, c.texto)).join("")}${fila("Mecanismo", g.mecanismo)}</dl>${punteros(g, rutaRaiz, invocacion)}`,
    )}
  </article>`;
}

function pestanaGotchas(m, rutaRaiz) {
  const gotchas = m.gotchas;
  if (!m.rutas.incidents) return seccion("gotchas-lista", "Gotchas", '<p class="vacio">El config no declara <code>incidents.file</code>: el repo no tiene registro de incidentes que leer.</p>', { abierta: true });
  const ejecutables = gotchas.filter((g) => g.ejecutable).length;
  const filtros = `<div class="filtros" data-filtros="gotchas">
    <button class="filtro activo" data-filtro-grupo="gotchas" data-filtro="">todos <small>${gotchas.length}</small></button>
    <button class="filtro" data-filtro-grupo="gotchas" data-filtro="ejecutable">con freno ejecutable <small>${ejecutables}</small></button>
    <button class="filtro" data-filtro-grupo="gotchas" data-filtro="sin-freno">sin freno ejecutable <small>${gotchas.length - ejecutables}</small></button>
    <button class="filtro filtro--accion" data-plegar="#gotchas">plegar / desplegar todo</button>
  </div>`;
  return seccion(
    "gotchas-lista",
    "Gotchas — lo que ya costó horas",
    `<p class="nota">Leído de <a href="${escapar(`${rutaRaiz}/${m.rutas.incidents}`)}"><code>${escapar(m.rutas.incidents)}</code></a>, en el orden en que se pagaron. Un puntero en rojo es un mecanismo que apunta a un archivo que ya no existe. Las <em>etiquetas</em> no se escriben: se derivan del mecanismo (dónde vive el freno y qué forma tiene), y al pulsarlas se acumulan como filtro.</p>${filtros}${barraDeEtiquetas(gotchas)}${
      gotchas.map((g) => tarjetaGotcha(g, rutaRaiz, m.invocacion)).join("") || '<p class="vacio">— ningún incidente registrado —</p>'
    }`,
    { extra: `<small>${gotchas.length}</small>`, abierta: true },
  );
}

// ── Reglas ──────────────────────────────────────────────────────────────────

function tarjetaPrincipio(p, rutaRaiz, invocacion) {
  const fuerza = chip(escapar(p.fuerza), p.fuerza === "BLOCKING" ? "chip--fuerte" : p.fuerza === "REVIEW" ? "chip--gris" : "chip--mal");
  return `<article class="tarjeta principio" id="principio-${escapar(p.id)}" data-buscar data-principios="${escapar(p.fuerza)}" ${datosEtiquetas(p.etiquetas)}>
    ${detalles(
      `<span class="num">${escapar(p.id)}</span> ${inline(p.titulo, rutaRaiz)} ${fuerza}${etiquetasDeTarjeta((p.etiquetas ?? []).filter((t) => t !== p.fuerza))}`,
      `${parrafos(p.enunciado, rutaRaiz)}${p.mecanismo ? `<div class="mecanismo"><strong>Mecanismo:</strong> ${parrafos(p.mecanismo, rutaRaiz)}</div>` : '<p class="vacio">sin mecanismo declarado</p>'}${punteros(p, rutaRaiz, invocacion)}`,
    )}
  </article>`;
}

const codigos = (lista) => lista.map((x) => `<code>${escapar(x)}</code>`).join(" ");

function pestanaReglas(m, rutaRaiz) {
  const r = m.reglas;
  const constituciones = r.constituciones.length
    ? r.constituciones
        .map(
          (c) => `<div class="columna">
        <h3>${inline(c.titulo, rutaRaiz)} <small>v${escapar(c.version ?? "?")}${c.fecha ? ` · ${escapar(c.fecha)}` : ""} · <a href="${escapar(`${rutaRaiz}/${c.archivo}`)}">${escapar(c.archivo)}</a></small></h3>
        ${c.principios.map((p) => tarjetaPrincipio(p, rutaRaiz, m.invocacion)).join("")}
      </div>`,
        )
        .join("")
    : '<p class="vacio">El repo no tiene constitución (<code>panel.sources.constitutions</code>).</p>';
  const filtrosPrincipios = `<div class="filtros" data-filtros="principios">
    <button class="filtro activo" data-filtro-grupo="principios" data-filtro="">todos</button>
    <button class="filtro" data-filtro-grupo="principios" data-filtro="BLOCKING">BLOCKING</button>
    <button class="filtro" data-filtro-grupo="principios" data-filtro="REVIEW">REVIEW</button>
    <button class="filtro filtro--accion" data-plegar="#constituciones">plegar / desplegar todo</button>
  </div>${barraDeEtiquetas(r.constituciones.flatMap((c) => c.principios))}`;

  const omitidaHoy = new Map((m.arnes?.senales ?? []).map((s) => [s.nombre, s.omitidaHoy]));
  const gate = tabla(
    ["Señal", "Comando", "Por qué esta señal", "Modo fast", "Se omite si falta"],
    r.gate.signals.map((s) => [
      escapar(s.name),
      `<code>${escapar(s.command)}</code>`,
      s.why ? inline(s.why, rutaRaiz) : chip("sin why (P6)", "chip--mal"),
      s.fastSkip ? chip("se omite", "chip--gris") : chip("corre", "chip--ok"),
      s.skipIfMissing ? `<code>${escapar(s.skipIfMissing)}</code>${omitidaHoy.get(s.name) ? " " + chip("falta hoy: OMITIDA", "chip--mal") : ""}` : "—",
    ]),
  );

  const f = r.frenos;
  const patron = (p) => `<code class="regex">${escapar(p)}</code>`;
  const bloques = [
    [`Rutas protegidas`, f.protectedPaths, () => tabla(["Patrón", "Sólo agente", "Por qué"], f.protectedPaths.map((p) => [patron(p.pattern), p.agentOnly ? "sí" : "—", inline(p.reason, rutaRaiz)]))],
    [`Comandos denegados en el shell`, f.bashDeny, () => tabla(["Patrón", "Por qué"], f.bashDeny.map((d) => [patron(d.pattern), inline(d.reason, rutaRaiz)]))],
    [`Patrones prohibidos en el código`, f.patterns, () => tabla(["Id", "Patrón", "Ámbito", "Mensaje"], f.patterns.map((p) => [`<strong>${escapar(p.id)}</strong>`, patron(p.pattern), patron(p.appliesTo), inline(p.message, rutaRaiz)]))],
    [`Invariantes de archivo`, f.invariants, () => tabla(["Archivo", "Debe tener", "No puede tener", "Por qué"], f.invariants.map((i) => [`<code>${escapar(i.file)}</code>`, codigos(i.required), codigos(i.forbidden), inline(i.reason, rutaRaiz)]))],
    [`Fuente única de literales`, f.singleSource, () => tabla(["Id", "Fuente", "Literales", "Ámbito", "Por qué"], f.singleSource.map((s) => [`<strong>${escapar(s.id)}</strong>`, `<code>${escapar(s.source)}</code>`, codigos(s.literals), patron(s.appliesTo), inline(s.reason, rutaRaiz)]))],
    [`Pureza de capas`, f.purity, () => tabla(["Capa", "No importa", "Excepciones", "Por qué"], f.purity.map((p) => [`<code>${escapar(p.dir)}</code>`, codigos(p.forbiddenImports), p.except.map((x) => `<code>${escapar(x)}</code>`).join("<br>"), inline(p.reason, rutaRaiz)]))],
    [`Reuso obligatorio`, f.reuse, () => tabla(["Patrón", "Ámbito", "Usar en cambio", "Por qué"], f.reuse.map((x) => [patron(x.pattern), patron(x.appliesTo), `<code>${escapar(x.see)}</code>`, inline(x.reason, rutaRaiz)]))],
    [`Dependencias prohibidas`, f.forbiddenDeps, () => tabla(["Manifiesto", "Paquetes", "Por qué"], f.forbiddenDeps.map((d) => [`<code>${escapar(d.manifest)}</code>`, codigos(d.packages), inline(d.reason, rutaRaiz)]))],
  ];
  const frenos =
    bloques.map(([titulo, items, render]) => (items.length ? detalles(`${titulo} <small>${items.length}</small>`, render()) : "")).join("") +
    (r.incidents ? detalles("Formato de incidentes", `<p>Todo incidente de <code>${escapar(r.incidents.file)}</code> declara: ${codigos(r.incidents.requiredLines)}</p>`) : "");

  const ciclo = [
    r.workflow
      ? `<p data-buscar><strong>Modelo de ramas:</strong> ${inline(r.workflow.model || "—", rutaRaiz)} · base <code>${escapar(r.workflow.baseBranch ?? "—")}</code> · edad máxima de una rama: ${escapar(String(r.workflow.maxAgeDays ?? "—"))} días</p>
         ${r.workflow.branchPattern ? `<p data-buscar><strong>Nombre de rama:</strong> <code class="regex">${escapar(r.workflow.branchPattern)}</code></p>` : ""}
         ${r.workflow.reason ? `<p class="nota" data-buscar>${inline(r.workflow.reason, rutaRaiz)}</p>` : ""}`
      : "",
    r.xp.length
      ? tabla(["Práctica", "Estado", "Fuga declarada", "Por qué"], r.xp.map((x) => [`<code>${escapar(x.practica)}</code>`, x.enabled ? chip("encendida", "chip--ok") : chip("apagada", "chip--gris"), x.escapeLine ? `<code>${escapar(x.escapeLine)}</code>` : "—", inline(x.reason, rutaRaiz)]))
      : "",
    r.tracker ? `<p data-buscar><strong>Gestor de trabajo:</strong> ${escapar(r.tracker.kind || "—")} · referencia <code class="regex">${escapar(r.tracker.issuePattern)}</code>${r.tracker.example ? ` · p. ej. <code>${escapar(r.tracker.example)}</code>` : ""}</p>` : "",
  ].join("");

  const totalFrenos = bloques.reduce((n, [, items]) => n + items.length, 0);
  const blocking = r.constituciones.flatMap((c) => c.principios).filter((p) => p.fuerza === "BLOCKING").length;
  return [
    seccion("constituciones", r.constituciones.length > 1 ? "Constituciones" : "Constitución", `${filtrosPrincipios}<div class="columnas">${constituciones}</div>`, { abierta: true, resumen: `${blocking} BLOCKING` }),
    seccion("gate", "Señales declaradas del gate", `<p class="nota">La única definición de «entregable»: <code>${escapar(r.gate.command ?? "node scripts/gate.mjs")}</code>. Una señal omitida no es verde${r.gate.fastCommand ? `; <code>${escapar(r.gate.fastCommand)}</code> es señal de desarrollo` : ""}.</p>${gate}`, { extra: `<small>${r.gate.signals.length}</small>` }),
    seccion("frenos", "Frenos declarados en el config", frenos || '<p class="vacio">— ninguno —</p>', { extra: `<small>${totalFrenos}</small>`, resumen: `${f.protectedPaths.length} rutas protegidas · ${f.bashDeny.length} comandos denegados · ${f.patterns.length} patrones` }),
    ciclo ? seccion("ciclo", "Ciclo de desarrollo", ciclo, { resumen: r.workflow?.model ?? "" }) : "",
  ].join("");
}

// ── Ahora (en vivo) ─────────────────────────────────────────────────────────

function tarjetaRepo(r) {
  if (r.ausente) return `<article class="tarjeta repo" data-buscar><p>${punto("advertencia")} <code>${escapar(r.nombre)}</code> ${chip(`no está en ${escapar(r.ruta)}`, "chip--mal")}</p></article>`;
  const posicion = r.adelante === null ? chip(r.base ? "en su base" : "sin base que comparar", "chip--gris") : `${chip(`${r.adelante} adelante`, r.adelante ? "chip--ok" : "chip--gris")}${chip(`${r.atras} detrás de ${escapar(r.base)}`, r.atras ? "chip--mal" : "chip--ok")}`;
  const grupos = r.porGrupo.map((g) => chip(`${escapar(g.grupo)} <b>${g.n}</b>`, "chip--gris")).join("");
  const estado = { M: "modificado", A: "agregado", D: "borrado", R: "renombrado", "??": "nuevo (sin seguimiento)", MM: "modificado (índice y árbol)", AM: "agregado y modificado" };
  const cambios = tabla(
    ["Estado", "Archivo", "+", "−"],
    r.cambios.map((c) => {
      const n = r.numstat.find((x) => x.archivo === c.archivo);
      return [chip(estado[c.estado] ?? escapar(c.estado), c.estado === "??" ? "chip--info" : "chip--gris"), `<code>${escapar(c.archivo)}</code>`, n ? `<span class="mas">+${n.mas ?? "bin"}</span>` : "", n ? `<span class="menos">−${n.menos ?? "bin"}</span>` : ""];
    }),
    "cambios",
  );
  const commits = tabla(["Sha", "Fecha", "Asunto"], r.ultimosCommits.map((c) => [`<code>${escapar(c.sha)}</code>`, escapar(c.fecha), escapar(c.asunto)]));
  const diff = r.diff.trim()
    ? `${r.diffTruncado ? `<p>${chip(`recortado: faltan ${r.diffTruncado} líneas`, "chip--gris")}</p>` : ""}<pre class="diff">${r.diff
        .split("\n")
        .map((l) => `<span class="${l.startsWith("+") ? "d-mas" : l.startsWith("-") ? "d-menos" : l.startsWith("@@") ? "d-hunk" : /^(diff|index) /.test(l) ? "d-meta" : ""}">${escapar(l)}</span>`)
        .join("\n")}</pre>`
    : '<p class="vacio">Sin diff contra HEAD.</p>';
  // Pestañas internas: archivos, diff, commits y carpetas eran cuatro bloques apilados que había
  // que recorrer para encontrar uno. Ahora se elige el concepto.
  const id = `repo-${String(r.nombre).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "raiz"}`;
  const sub = [
    { clave: "archivos", nombre: `Archivos <small>${r.cambios.length}</small>`, html: r.cambios.length ? cambios : '<p class="ok">✓ Árbol limpio: nada sin commitear.</p>' },
    { clave: "diff", nombre: "Diff", html: diff },
    { clave: "commits", nombre: `Commits <small>${r.ultimosCommits.length}</small>`, html: commits },
    { clave: "carpetas", nombre: "Por carpeta", html: grupos ? `<p>${grupos}</p>` : '<p class="vacio">Sin cambios.</p>' },
  ];
  const pestanasInternas = `<div class="subpestanas" data-subpestanas>
    <div class="subpestanas__tira" role="tablist" aria-label="Código de ${escapar(r.nombre)}">${sub
      .map((s, i) => `<button type="button" role="tab" class="${i === 0 ? "activo" : ""}" aria-selected="${i === 0}" data-subpestana="${id}-${s.clave}">${s.nombre}</button>`)
      .join("")}</div>
    ${sub.map((s, i) => `<div class="subpestana" role="tabpanel" id="${id}-${s.clave}"${i === 0 ? "" : " hidden"}>${s.html}</div>`).join("")}
  </div>`;
  return `<article class="tarjeta repo" data-buscar>${detalles(
    `${punto(r.limpio ? "verde" : "advertencia")} <code>${escapar(r.nombre)}</code> <code>${escapar(r.rama ?? "?")}</code> ${r.limpio ? chip("árbol limpio", "chip--ok") : chip(`${r.cambios.length} archivo(s) cambiados`, "chip--mal")} ${r.rol ? chip(escapar(r.rol), "chip--gris") : ""} ${posicion}`,
    pestanasInternas,
    !r.limpio,
  )}</article>`;
}

function barrasDeTokens(t) {
  const max = Math.max(1, ...t.ultimosDias.map((d) => d.salida + d.entrada + d.cacheEscrita));
  return `<div class="barras" aria-label="tokens por día">${t.ultimosDias
    .map((d) => {
      const total = d.salida + d.entrada + d.cacheEscrita;
      const alto = Math.round((total / max) * 100);
      return `<div class="barra" title="${escapar(d.dia)} · salida ${abreviar(d.salida)} · caché escrita ${abreviar(d.cacheEscrita)} · caché leída ${abreviar(d.cacheLeida)} · ${d.mensajes} mensajes"><div class="barra__col" style="height:${alto}%"><div class="barra__salida" style="height:${total ? Math.round((d.salida / total) * 100) : 0}%"></div></div><span>${escapar(d.dia.slice(5))}</span></div>`;
    })
    .join("")}</div>`;
}

const TONO_CORRIDA = { verde: "verde", rojo: "rojo", omitida: "omitido" };

/**
 * Lo que corrió EN ESTA MÁQUINA, del registro que el gate escribe en cada corrida. Una señal sin
 * registro no se pinta verde: que no corrió acá es un dato distinto de que pasó.
 */
function seccionRegistro(v, m, rutaRaiz) {
  const reg = v.gate.registro;
  const scripts = new Map((m.arnes?.senales ?? []).map((s) => [s.nombre, s.script]));
  const nombres = [...new Set([...m.reglas.gate.signals.map((s) => s.name), ...Object.keys(reg?.senales ?? {})])];
  const filas = nombres.map((nombre) => {
    const s = reg?.senales?.[nombre];
    const declarada = m.reglas.gate.signals.some((x) => x.name === nombre);
    const script = scripts.get(nombre);
    return [
      `${punto(TONO_CORRIDA[s?.estado] ?? "neutro")} <span data-buscar>${escapar(nombre)}</span>${declarada ? "" : " " + chip("ya no está declarada", "chip--gris")}`,
      s ? `${chip(escapar(s.estado), s.estado === "verde" ? "chip--ok" : s.estado === "rojo" ? "chip--mal" : "chip--gris")} <span class="tenue">${fecha(s.fecha)} · ${segundos(s.ms)}</span>${s.motivo ? `<br><span class="tenue">${escapar(s.motivo)}</span>` : ""}` : chip("no corrió en esta máquina", "chip--gris"),
      s?.ultimoVerde ? `${fecha(s.ultimoVerde.fecha)}${s.ultimoVerde.head ? ` · <code>${escapar(s.ultimoVerde.head)}</code>` : ""}` : '<span class="tenue">nunca</span>',
      script ? `<a href="${escapar(`${rutaRaiz}/${script}`)}"><code>${escapar(script)}</code></a>` : "—",
    ];
  });
  const cab = reg
    ? `<p>${chip(`gate ${escapar(reg.veredicto)}`, reg.veredicto === "verde" ? "chip--ok" : reg.veredicto === "rojo" ? "chip--mal" : "chip--info")} modo <code>${escapar(reg.modo)}</code> · ${fecha(reg.fecha)} · ${segundos(reg.ms)}${reg.head ? ` · HEAD <code>${escapar(reg.head)}</code>` : ""}${reg.rama ? ` · rama <code>${escapar(reg.rama)}</code>` : ""}</p>`
    : `<p>${chip("el gate no corrió en esta máquina", "chip--mal")} Corré <code>${escapar(m.reglas.gate.command ?? "node scripts/gate.mjs")}</code>.</p>`;
  // La cuenta es de las señales DECLARADAS: la tabla muestra también las que ya no lo están (con
  // su etiqueta), pero sumarlas al total decía «12/13» de un gate con todo verde.
  const declaradas = m.reglas.gate.signals.map((s) => s.name);
  const verdes = declaradas.filter((n) => reg?.senales?.[n]?.estado === "verde").length;
  // El pipeline es la vista; la tabla queda plegada para quien quiera el script o el HEAD exacto.
  return seccion(
    "registro",
    "Última corrida del gate (pipeline)",
    `${cab}${pipelineDelGate(m)}${detalles(`Ver como tabla <small>${nombres.length} señales</small>`, tabla(["Señal", "Última corrida", "Último verde", "Script"], filas, "verificacion"))}
     <p class="nota">Pasá el mouse (o el foco) por cada caja para ver qué verifica, cuánto tardó y su último verde; un job rojo lleva a su detalle. Sale de <code>${escapar(v.gate.rutaRegistro)}</code>, que el gate escribe en cada corrida: es de ESTA máquina y no se versiona.</p>`,
    { abierta: true, extra: `<small>${verdes}/${declaradas.length}</small>`, resumen: reg ? `${reg.veredicto} · ${fecha(reg.fecha)} · ${verdes} de ${declaradas.length} en verde` : "sin registro" },
  );
}

function seccionGestor(v, m) {
  const citas = m.citas ?? [];
  const g = v.gestor;
  if (!g && !citas.length) return "";
  const porId = new Map((g?.ok ? g.items : []).map((i) => [i.id, i]));
  const filas = citas.map((c) => {
    const it = porId.get(c.id);
    const estado = !g ? '<span class="tenue">sin gestor configurado</span>' : !g.ok ? chip("sin dato", "chip--mal") : it ? `${punto(it.cerrado ? "neutro" : "verde")} ${escapar(it.estado)}${it.tipo ? ` <span class="tenue">${escapar(it.tipo)}</span>` : ""}` : `${punto("advertencia")} el gestor no conoce este id`;
    return [
      it?.url ? `<a href="${escapar(it.url)}">${escapar(c.id)}</a>` : escapar(c.id),
      estado,
      `<span data-buscar>${escapar(it?.titulo ?? "—")}</span>`,
      c.donde.map((d) => `<code>${escapar(d.fuente)}:${d.linea}</code>`).join(" "),
    ];
  });
  const cerradas = citas.filter((c) => porId.get(c.id)?.cerrado).length;
  const r = g?.ok ? g.resumen : null;
  const cuerpo = [
    g && !g.ok ? `<p>${chip("no se pudo leer el gestor", "chip--mal")} <code>${escapar(g.error)}</code></p>` : "",
    r ? `<div class="indicadores indicadores--compactos">${indicador(`${r.pct}%`, "cerrado", { tono: "info", detalle: `${r.cerrados} de ${r.total} ítems · conteo, no esfuerzo` })}</div>` : "",
    citas.length ? tabla(["Ítem", "Estado hoy", "Título", "Citado en"], filas, "citas") : '<p class="vacio">La memoria no cita ningún ítem de trabajo.</p>',
    cerradas ? `<p>${chip(`${cerradas} de ${citas.length} ya están cerrados`, "chip--mal")} La memoria los nombra como vigentes: conviene releer esas líneas.</p>` : "",
    `<p class="nota">Las citas se extraen con el patrón de referencia del gestor (<code>tracker.issuePattern</code>) sobre ${m.citasFuentes.map((f) => `<code>${escapar(f)}</code>`).join(", ")}. ${
      g ? `Su estado se LEE al generar con <code>${escapar(g.comando)}</code>.` : "Para ver su estado de hoy, declará <code>panel.tracker.command</code> (ver <code>docs/panel.md</code>)."
    }</p>`,
  ].join("");
  return seccion("gestor", "Ítems de trabajo citados", cuerpo, { abierta: true, extra: `<small>${citas.length}</small>`, resumen: g?.ok ? `${cerradas} cerrados de ${citas.length}` : g ? "sin dato" : `${citas.length} citas` });
}

function pestanaAhora(v, m, rutaRaiz) {
  const gate = v.gate.marcador
    ? v.gate.pendiente
      ? `<p>${chip("gate pendiente", "chip--mal")} Hay código editado sin gate verde (marcador <code>${escapar(v.gate.marcador)}</code> desde ${fecha(v.gate.desde)}). El hook <code>Stop</code> no deja cerrar el turno hasta que el gate salga verde.</p>`
      : `<p>${chip("al día", "chip--ok")} No hay marcador <code>${escapar(v.gate.marcador)}</code>: lo último editado pasó el gate, o no se editó código.</p>`
    : '<p class="vacio">El config no declara <code>gate.marker</code>: nada vigila que el código editado pase el gate.</p>';

  const sondas = v.sondas.length
    ? tabla(["Servicio", "URL", "Responde"], v.sondas.map((s) => [`<code>${escapar(s.nombre)}</code>`, `<a href="${escapar(s.url)}">${escapar(s.url)}</a>`, s.viva ? chip(`sí · ${s.status}`, "chip--ok") : chip(`no · ${escapar(s.error ?? s.status ?? "")}`, "chip--mal")]))
    : "";

  const t = v.tokens;
  const tokens = t
    ? `<div class="indicadores indicadores--compactos">
        ${indicador(abreviar(t.hoy.salida), "salida hoy", { tono: "info", detalle: `${t.hoy.mensajes} mensajes` })}
        ${indicador(abreviar(t.total.salida), `salida en ${t.dias} días`, { detalle: `${t.total.mensajes} mensajes · ${t.sesiones} sesiones` })}
        ${indicador(abreviar(t.total.cacheEscrita), "caché escrita", { detalle: "contexto nuevo enviado" })}
        ${indicador(abreviar(t.total.cacheLeida), "caché leída", { detalle: "contexto reutilizado" })}
        ${indicador(fecha(t.ultimaActividad), "última actividad", {})}
      </div>
      <h3>Últimos ${t.ultimosDias.length} días <small>alto = entrada + salida + caché escrita; la parte oscura es la salida</small></h3>
      ${barrasDeTokens(t)}
      ${detalles(
        `Por modelo <small>${t.porModelo.length}</small>`,
        tabla(["Modelo", "Salida", "Entrada", "Caché escrita", "Caché leída", "Mensajes"], t.porModelo.map((x) => [`<code>${escapar(x.modelo)}</code>`, String(x.salida), String(x.entrada), String(x.cacheEscrita), String(x.cacheLeida), String(x.mensajes)])),
      )}
      <p class="nota">Sumado de las transcripciones locales de Claude Code de este repositorio (<code>${escapar(t.carpeta)}</code>), deduplicando por id de mensaje. Es el consumo de ESTA máquina, no del equipo.</p>`
    : '<p class="tenue">No hay transcripciones de Claude Code para este repositorio en esta máquina (o <code>panel.tokens</code> está apagado).</p>';

  const sucios = v.repos.filter((r) => !r.ausente && !r.limpio);
  return [
    `<p class="nota">Estado de <strong>esta máquina</strong> (${escapar(v.maquina)}) al ${fecha(v.generadoEn)}. Caduca: se regenera en cada corrida del gate o con <code>${escapar(m.comando)}</code>.</p>`,
    seccionRegistro(v, m, rutaRaiz),
    seccionRojas(m),
    seccion("gate-vivo", "Gate de esta sesión", gate, { abierta: v.gate.pendiente, resumen: v.gate.pendiente ? "pendiente" : "al día" }),
    v.repos.length
      ? seccion("repos", "Código", v.repos.map(tarjetaRepo).join(""), { abierta: true, extra: `<small>${v.repos.length}</small>`, resumen: sucios.length ? `${sucios.length} con cambios: ${sucios.map((r) => r.nombre).join(", ")}` : "todo limpio" })
      : "",
    sondas ? seccion("sondas", "Servicios locales", sondas, { abierta: true, extra: `<small>${v.sondas.length}</small>`, resumen: `${v.sondas.filter((s) => s.viva).length}/${v.sondas.length} responden` }) : "",
    seccionGestor(v, m),
    seccion("tokens", "Consumo de tokens (esta máquina)", tokens, { resumen: t ? `${abreviar(t.hoy.salida)} de salida hoy` : "sin datos" }),
  ].join("");
}

// ── Plan (burn-down) ────────────────────────────────────────────────────────

const diaNum = (f) => Math.round(Date.parse(`${f}T00:00:00Z`) / 86400000);

/**
 * El gráfico se dibuja con la serie y nada más: sin reloj ni aleatoriedad, las coordenadas salen
 * de las fechas y los conteos, así que los mismos datos dan los mismos bytes. Alcance y hecho son
 * dos líneas (burn-up): un alcance que crece se VE crecer, en vez de esconderse como avance que baja.
 */
function graficoDePlan(plan) {
  const puntos = plan.serie.filter((x) => x.fecha);
  const r = plan.resumen;
  if (puntos.length < 1 || !r) return "";
  const x0 = diaNum(puntos[0].fecha);
  const x1 = Math.max(diaNum(puntos[puntos.length - 1].fecha), r.ideal ? diaNum(r.ideal[1].fecha) : 0, x0 + 1);
  const maxY = Math.max(1, ...plan.serie.map((x) => x.total));
  const A = 720;
  const H = 220;
  const M = { i: 44, d: 12, a: 12, b: 28 };
  const X = (d) => (M.i + ((d - x0) / (x1 - x0)) * (A - M.i - M.d)).toFixed(1);
  const Y = (v) => (H - M.b - (v / maxY) * (H - M.a - M.b)).toFixed(1);
  // Escalonada: el valor de un día vale hasta el siguiente cambio.
  const linea = (campo) => {
    const pts = [];
    puntos.forEach((q, i) => {
      if (i) pts.push(`${X(diaNum(q.fecha))},${Y(puntos[i - 1][campo])}`);
      pts.push(`${X(diaNum(q.fecha))},${Y(q[campo])}`);
    });
    return pts.join(" ");
  };
  const ideal = r.ideal ? `<polyline class="g-ideal" points="${X(diaNum(r.ideal[0].fecha))},${Y(r.ideal[0].pendientes)} ${X(diaNum(r.ideal[1].fecha))},${Y(0)}"/>` : "";
  const pendientes = puntos.map((q) => ({ ...q, pend: q.total - q.hechas }));
  const lineaPend = pendientes.map((q, i) => (i ? `${X(diaNum(q.fecha))},${Y(pendientes[i - 1].pend)} ` : "") + `${X(diaNum(q.fecha))},${Y(q.pend)}`).join(" ");
  const ejeY = [0, Math.round(maxY / 2), maxY].map((v) => `<text x="${M.i - 6}" y="${Y(v)}" class="g-eje" text-anchor="end" dominant-baseline="middle">${v}</text><line x1="${M.i}" x2="${A - M.d}" y1="${Y(v)}" y2="${Y(v)}" class="g-rejilla"/>`).join("");
  const fechaFin = r.ideal && r.ideal[1].fecha > puntos[puntos.length - 1].fecha ? r.ideal[1].fecha : puntos[puntos.length - 1].fecha;
  const ejeX = `<text x="${M.i}" y="${H - 8}" class="g-eje">${escapar(puntos[0].fecha)}</text><text x="${A - M.d}" y="${H - 8}" class="g-eje" text-anchor="end">${escapar(fechaFin)}</text>`;
  return `<svg class="grafico" viewBox="0 0 ${A} ${H}" role="img" aria-label="burn-up del plan: alcance ${r.total}, hecho ${r.hechas}">
    ${ejeY}${ejeX}${ideal}
    <polyline class="g-alcance" points="${linea("total")}"/>
    <polyline class="g-hecho" points="${linea("hechas")}"/>
    <polyline class="g-pend" points="${lineaPend}"/>
  </svg>
  <p class="leyenda"><span class="l-alcance">alcance</span> <span class="l-hecho">hecho</span> <span class="l-pend">pendiente (burn-down)</span>${r.ideal ? ' <span class="l-ideal">ideal hasta la fecha objetivo</span>' : ""}</p>`;
}

const NOMBRE_FUENTE = { repo: "casillas del plan en el repo (historia de git)", tracker: "ítems del gestor (createdAt / closedAt)", none: "sin fuente" };

function pestanaPlan(plan) {
  if (!plan || plan.estado !== "ok") {
    return seccion(
      "plan-burndown",
      "Plan — burn-down",
      `<p>${chip("OMITIDO", "chip--gris")} ${inline(plan?.motivo ?? "sin datos del plan")}</p>
       <p class="nota">Omitido no es 0 %: no hay de dónde leer el plan, y un plan vacío y uno que no existe no se pueden ver igual. Dónde vive el plan lo dice <code>tracker.artifactsIn</code> (o <code>panel.plan.source</code>): en el repo, se cuentan las casillas de <code>panel.plan.files</code> por la historia de git; en el gestor, se usan las fechas de alta y cierre que devuelve <code>panel.tracker.command</code>.</p>`,
      { abierta: true, resumen: "omitido" },
    );
  }
  const r = plan.resumen;
  const conFecha = plan.serie.filter((x) => x.fecha);
  const tablaSerie = tabla(
    ["Fecha", "Alcance", "Hecho", "Pendiente"],
    plan.serie.map((q) => [q.fecha ? escapar(q.fecha) : chip("sin commitear", "chip--info"), String(q.total), `<span class="mas">${q.hechas}</span>`, String(q.total - q.hechas)]),
  );
  const crecio = r.total - r.alcanceInicial;
  const actual = plan.serie[plan.serie.length - 1];
  return seccion(
    "plan-burndown",
    "Plan — burn-down",
    `<div class="indicadores indicadores--compactos">
      ${indicador(`${r.pct}%`, "hecho", { tono: r.pct === 100 ? "verde" : "info", detalle: `${r.hechas} de ${r.total} · conteo, no esfuerzo` })}
      ${indicador(String(r.pendientes), "pendientes", { tono: r.pendientes ? "advertencia" : "verde", detalle: `al ${escapar(r.hasta)}` })}
      ${indicador(`${crecio >= 0 ? "+" : ""}${crecio}`, "cambio de alcance", { tono: crecio > 0 ? "advertencia" : "neutro", detalle: `de ${r.alcanceInicial} a ${r.total} desde ${escapar(r.desde)}` })}
      ${r.dueDate ? indicador(escapar(r.dueDate), "fecha objetivo", { tono: "info", detalle: "panel.plan.dueDate" }) : ""}
      ${actual?.sinCommitear ? indicador(`${actual.hechas}/${actual.total}`, "en el árbol, sin commitear", { tono: "info", detalle: "no entra a la serie con fecha" }) : ""}
    </div>
    ${graficoDePlan(plan)}
    ${detalles(`La serie <small>${conFecha.length} punto(s)</small>`, tablaSerie)}
    ${plan.archivos?.length ? detalles(`Archivos del plan <small>${plan.archivos.length}</small>`, `<ul class="vinetas">${plan.archivos.map((a) => `<li data-buscar><code>${escapar(a)}</code></li>`).join("")}</ul>`) : ""}
    ${plan.sinFecha ? `<p>${chip(`${plan.sinFecha} ítem(s) sin createdAt`, "chip--gris")} no entran a la serie: no se les inventa fecha.</p>` : ""}
    <h3>Qué NO afirma este número</h3>
    <ul class="vinetas no-afirma"><li>Es conteo de ítems, no esfuerzo: una tarea de una hora y una de una semana pesan igual.</li><li>Hecho no es entregado: se cuenta lo que el plan marca cerrado.</li><li>Un alcance que crece se ve crecer; no se esconde como avance que baja.</li>${r.ideal ? "" : "<li>Sin fecha objetivo (<code>panel.plan.dueDate</code>) no hay línea ideal: no se inventa ritmo.</li>"}</ul>
    <p class="nota">Fuente: ${escapar(NOMBRE_FUENTE[plan.fuente] ?? plan.fuente)}${plan.rama ? `, rama <code>${escapar(plan.rama)}</code>` : ""}. La serie usa las fechas de los datos, nunca la de hoy: con los mismos datos sale el mismo burn-down.</p>`,
    { abierta: true, extra: `<small>${r.pct}%</small>`, resumen: `${r.hechas}/${r.total}` },
  );
}

// ── Memoria: lo que el agente lee, no lo que el repo tiene ──────────────────

const TONO_QUIEN = { "el equipo (versionado)": "verde", "sólo esta máquina": "advertencia", "se calcula al arrancar": "info" };

function barra(valor, maximo) {
  const pct = maximo ? Math.max(2, Math.round((valor / maximo) * 100)) : 0;
  return `<div class="avance avance--ancho" title="${valor}"><div class="avance__lleno avance__lleno--info" style="width:${pct}%"></div></div>`;
}

function pestanaMemoria(m, rutaRaiz) {
  const v = m.enVivo;
  const dec = m.decisiones;
  const decisiones = dec?.existe
    ? tabla(
        ["", "Decisión", "Estado"],
        dec.adr.map((a) => [punto(a.tono), `<a href="${escapar(`${rutaRaiz}/${a.archivo}`)}" data-buscar>${inline(a.titulo)}</a>`, chip(escapar(a.estado), a.tono === "verde" ? "chip--ok" : a.tono === "info" ? "chip--info" : "chip--gris")]),
      )
    : `<p class="vacio">No hay <code>${escapar(dec?.dir ?? "docs/decisions")}</code>: el porqué de las decisiones no está escrito en el repo.</p>`;
  const seccionDecisiones = seccion("decisiones", "Versionada: las decisiones (el porqué)", `${decisiones}<p class="nota">La memoria del porqué: un ADR no se inyecta en cada sesión, se lee cuando hace falta. Su estado dice si todavía manda.</p>`, { extra: `<small>${dec?.adr?.length ?? 0}</small>` });

  if (v?.memoria?.error) return [`<p>${chip("no se pudo leer la memoria", "chip--mal")} <code>${escapar(v.memoria.error)}</code></p><p class="nota">El resto del panel salió igual: la memoria falla abierta.</p>`, seccionDecisiones].join("");
  if (!v?.memoria) return [`<p class="nota">Sin la capa en vivo no se sabe qué lee el agente al arrancar: eso depende de esta máquina. Regenerá sin <code>--sin-vivo</code>.</p>`, seccionDecisiones].join("");

  const a = v.memoria.alArrancar;
  const maxT = Math.max(1, ...a.piezas.map((x) => x.tokens));
  const filas = a.piezas.map((x) => [
    escapar(x.capa) + (x.via ? ` <span class="tenue">(vía ${escapar(x.via)})</span>` : ""),
    `<code data-buscar>${escapar(x.ruta)}</code>${x.existe ? "" : " " + chip("no existe", "chip--mal")}`,
    `${punto(TONO_QUIEN[x.quien] ?? "neutro")} ${escapar(x.quien)}`,
    String(x.lineas),
    `≈${abreviar(x.tokens)}`,
    barra(x.tokens, maxT),
  ]);
  const presupuesto = a.presupuesto
    ? `<p>${a.excede ? chip(`excede el presupuesto: ≈${abreviar(a.total)} de ${abreviar(a.presupuesto)}`, "chip--mal") : chip(`dentro del presupuesto: ≈${abreviar(a.total)} de ${abreviar(a.presupuesto)}`, "chip--ok")}</p>`
    : `<p class="tenue">Sin presupuesto declarado (<code>panel.memory.injectBudgetTokens</code>): el número se muestra, no se juzga.</p>`;
  const salidas = v.memoria.sesion
    .map((x) => (x.corrido ? detalles(`Lo que imprime <code>${escapar(x.hook)}</code> <small>${x.lineas} líneas · ≈${abreviar(tokensDe(x.chars))} tokens · ${x.ms} ms</small>`, `<pre class="diff">${escapar(x.texto)}</pre>`) : `<p class="tenue"><code>${escapar(x.hook)}</code>: ${escapar(x.motivo)}</p>`))
    .join("");
  const alArrancar = seccion(
    "al-arrancar",
    "Lo que el agente lee al arrancar",
    `<div class="indicadores indicadores--compactos">
      ${indicador(`≥ ≈${abreviar(a.total)}`, "tokens que agregan el repo y esta máquina", { tono: a.excede ? "rojo" : "info", detalle: "en cada sesión, antes del primer pedido" })}
      ${indicador(String(a.piezas.length), "piezas", { detalle: `${a.piezas.filter((x) => x.quien === "sólo esta máquina").length} sólo de esta máquina` })}
    </div>
    ${tabla(["Capa", "Archivo", "Quién la ve", "Líneas", "Tokens", ""], filas, "memoria")}
    ${presupuesto}
    ${!a.hooksCorridos && a.hooksDeSesion ? `<p>${chip(`${a.hooksDeSesion} hook(s) de SessionStart sin medir`, "chip--gris")} El panel no los ejecuta si el config no lo pide (<code>panel.memory.runSessionHooks: true</code>): ejecutar un hook es ejecutar código del repo, y hay que saber antes que no escribe estado. Lo que imprimen falta en el total.</p>` : ""}
    ${salidas}
    <p class="nota">Esto entra al contexto en CADA sesión, antes de que el humano escriba nada: es el costo fijo de la memoria, y lo que compite con el pedido por la atención del agente. Es un PISO («≥»): no incluye el prompt del sistema, las herramientas, las instrucciones de los servidores MCP ni lo que traen los plugins, que no se ven desde el repo. Lo que es «sólo de esta máquina» no lo ve el equipo ni CI: si una regla importante vive ahí, en otra máquina no existe. Los tokens son una estimación (caracteres / 4).</p>`,
    { abierta: true, extra: `<small>≈${abreviar(a.total)}</small>`, resumen: `≈${abreviar(a.total)} tokens en ${a.piezas.length} piezas` },
  );

  const selectiva = seccionSelectiva(v.memoria.selectiva, rutaRaiz);

  const p = v.memoria.personal;
  let personal;
  if (!p?.existe) {
    personal = seccion("personal", "Personal: la memoria automática de esta máquina", `<p class="vacio">No hay memoria automática de este repo en esta máquina (<code>${escapar(p?.dir ?? "—")}</code>).</p>`, {});
  } else {
    const filasP = p.entradas.map((e) => {
      const rotas = e.rutas.filter((r) => !r.existe);
      return [
        `<strong data-buscar>${escapar(e.nombre)}</strong>${e.anunciada ? "" : " " + chip("el índice no la anuncia", "chip--atencion")}<br><span class="tenue">${escapar(e.descripcion.slice(0, 160))}</span>`,
        e.tipo ? chip(escapar(e.tipo), "chip--gris") : "—",
        e.dias === null ? "—" : `${e.dias} d`,
        e.lecturas === null || e.lecturas === undefined ? '<span class="tenue">—</span>' : e.lecturas ? chip(`≈${e.lecturas}`, "chip--ok") : chip("nunca abierta", "chip--gris"),
        e.rutas.length ? e.rutas.map((r) => chip(`${escapar(r.ruta)}${r.existe ? "" : " · no resuelve"}`, r.existe ? "chip--ok" : "chip--mal")).join("") : '<span class="tenue">no cita rutas</span>',
        rotas.length ? punto("advertencia") : punto("verde"),
      ];
    });
    personal = seccion(
      "personal",
      "Personal: la memoria automática de esta máquina",
      `<div class="indicadores indicadores--compactos">
        ${indicador(String(p.entradas.length), "entradas", { detalle: p.indice ? `índice de ${p.indice.lineas} líneas` : "sin índice MEMORY.md" })}
        ${indicador(String(p.conRutasRotas), "con rutas que no resuelven", { tono: p.conRutasRotas ? "advertencia" : "verde", detalle: "¿vencida, abreviada o de otro repo?" })}
        ${indicador(String(p.fueraDelIndice.length), "no anunciadas en el índice", { tono: p.fueraDelIndice.length ? "advertencia" : "verde", detalle: "el agente no sabe que existen" })}
      </div>
      ${tabla(["Memoria", "Tipo", "Edad", "Lecturas", "Rutas del repo que cita", ""], filasP, "memoria")}
      <p class="nota">La escribe el agente, en <code>${escapar(p.dir)}</code>: la ve SÓLO esta máquina. Las rutas se miden contra lo que git versiona: una que no resuelve puede ser memoria vencida (el archivo se movió), una ruta abreviada o una de otro repo; el panel no afirma cuál, dice que el agente no la puede abrir tal como está escrita. Al arrancar se carga el ÍNDICE, no las entradas: cada una se lee cuando el agente la necesita, y una que el índice no anuncia es una que el agente no sabe que existe.${p.indice?.recortado ? ` El índice pasa de ${p.indice.cargadas} líneas: lo que sigue no se carga.` : ""}</p>`,
      { abierta: true, extra: `<small>${p.entradas.length}</small>`, resumen: `${p.conRutasRotas} con rutas que no resuelven` },
    );
  }
  return [alArrancar, selectiva, personal, seccionDecisiones].join("");
}

const NOMBRE_TIPO = { skill: "skill", subagente: "subagente", comando: "comando" };
const DISPARADOR = { skill: "el pedido casa con su descripción", subagente: "el agente lo invoca", comando: "el humano escribe /…" };

// «Sin uso ACÁ» y no «peso muerto»: sólo se leen las transcripciones de este repo en esta máquina,
// y una skill del usuario se usa en otros repos, o una del repo la consume otro cliente (un agente
// externo por MCP). El panel dice lo que midió, no lo que no puede saber.
// «Cara» es política del equipo, no del panel: el umbral es `panel.memory.costlyTokens`.
const usosChip = (n, usos, cuerpo, cara) =>
  n === null ? '<span class="tenue">sin transcripciones</span>' : n ? chip(`${n} en ${usos.dias} d`, "chip--ok") : chip(cuerpo >= cara ? `sin uso acá en ${usos.dias} d · cara` : `sin uso acá en ${usos.dias} d`, cuerpo >= cara ? "chip--atencion" : "chip--gris");

function seccionSelectiva(sel, rutaRaiz) {
  if (!sel) return "";
  const u = sel.usos;
  const inv = [...sel.invocables].sort((a, b) => (a.origen < b.origen ? -1 : a.origen > b.origen ? 1 : b.cuerpoTokens - a.cuerpoTokens));
  const filasInv = inv.map((x) => [
    `${chip(NOMBRE_TIPO[x.tipo], "chip--gris")} <strong data-buscar>${escapar(x.nombre)}</strong>`,
    `${punto(TONO_QUIEN[x.quien] ?? "neutro")} ${escapar(x.origen === "repo" ? "repo" : "usuario")}`,
    `≈${abreviar(x.descTokens)}`,
    `≈${abreviar(x.cuerpoTokens)}`,
    `<span class="tenue">${escapar(DISPARADOR[x.tipo])}</span>`,
    usosChip(x.usos, u ?? {}, x.cuerpoTokens, sel.costlyTokens),
  ]);
  const filasPrompt = sel.prompt.map((r) => [
    `<code>${escapar(r.hook)}</code>`,
    r.medido ? `<strong>${escapar(r.ruta)}</strong> <span class="tenue">${r.patrones} patrón(es)</span>` : '<span class="tenue">el texto lo arma el hook</span>',
    r.medido ? `≈${abreviar(r.tokens)}` : chip("no medido", "chip--gris"),
  ]);
  const filasDocs = sel.docs.map((d) => [
    d.existe ? `<a href="${escapar(`${rutaRaiz}/${d.ruta}`)}"><code data-buscar>${escapar(d.ruta)}</code></a>` : `<code>${escapar(d.ruta)}</code> ${chip("no existe", "chip--mal")}`,
    `≈${abreviar(d.tokens)}`,
    d.lecturas === null ? '<span class="tenue">—</span>' : d.lecturas ? chip(`≈${d.lecturas} en ${u.dias} d`, "chip--ok") : chip("sin lecturas", "chip--gris"),
  ]);
  const muertos = inv.filter((x) => x.usos === 0 && x.cuerpoTokens >= sel.costlyTokens);
  const disponibles = inv.reduce((n, x) => n + x.cuerpoTokens, 0) + sel.docs.reduce((n, d) => n + d.tokens, 0);
  return seccion(
    "selectiva",
    "Selectiva: lo que entra sólo cuando algo lo dispara",
    `<div class="indicadores indicadores--compactos">
      ${indicador(`≈${abreviar(disponibles)}`, "tokens disponibles bajo demanda", { tono: "info", detalle: "cuerpos de skills, subagentes, comandos y docs citados" })}
      ${indicador(String(inv.length), "piezas invocables", { detalle: `${inv.filter((x) => x.origen === "repo").length} del repo · ${inv.filter((x) => x.origen !== "repo").length} del usuario` })}
      ${indicador(String(muertos.length), "caras y sin uso acá", { tono: muertos.length ? "advertencia" : "verde", detalle: u ? `en ${u.dias} días · ${u.sesiones} sesiones + ${u.subagentes} de subagentes` : "sin transcripciones" })}
    </div>
    <h3>Skills, subagentes y comandos <small>la descripción cuesta siempre; el cuerpo, al dispararse</small></h3>
    ${tabla(["Pieza", "Origen", "Siempre", "Al dispararse", "Disparador", "Uso"], filasInv, "memoria")}
    ${sel.usadasSinInventario?.length ? `<p>${chip(`${sel.usadasSinInventario.length} skill(s) usadas que no están en el repo ni en el home`, "chip--gris")} ${sel.usadasSinInventario.map((x) => `<code>${escapar(x.nombre)}</code> ×${x.veces}`).join(" · ")} — vienen de un plugin o del cliente: su costo no se ve desde acá.</p>` : ""}
    <h3>Lo que pueden inyectar los hooks de cada pedido</h3>
    ${tabla(["Hook", "Ruta", "Al casar"], filasPrompt, "memoria")}
    <h3>Documentos que la guía cita <small>el agente los lee siguiendo el puntero</small></h3>
    ${tabla(["Documento", "Tamaño", "Lecturas"], filasDocs, "memoria")}
    ${sel.subcarpetas.length ? `<h3>Guías de subcarpeta</h3>${tabla(["Guía", "Se carga al tocar", "Tamaño"], sel.subcarpetas.map((g) => [`<code>${escapar(g.ruta)}</code>`, `<code>${escapar(g.carpeta)}/</code>`, `≈${abreviar(g.tokens)}`]))}` : '<p class="tenue">No hay guías de subcarpeta (<code>*/CLAUDE.md</code>): toda la guía del repo es memoria fija.</p>'}
    <p class="nota">Lo selectivo no cuesta hasta que algo lo dispara, pero su DESCRIPCIÓN sí: por eso figura también en «al arrancar». El uso sale de las transcripciones de este repo en esta máquina (${u ? `${u.sesiones} sesiones en ${u.dias} días` : "no hay"}): una pieza cara que nadie disparó ACÁ merece una revisión —puede servir en otros repos (las del usuario) o a otro cliente (una skill que consume un agente externo)—, y una que se dispara siempre quizás es memoria fija disfrazada. Las lecturas de un documento son una APROXIMACIÓN: se cuentan por la herramienta de lectura y por los comandos de shell que lo nombran. Lo que arma un hook en su código no se mide sin ejecutarlo, y ejecutar un hook de pedido puede cambiar el estado de la sesión: por eso figura «no medido».</p>`,
    { abierta: true, extra: `<small>${inv.length}</small>`, resumen: `≈${abreviar(disponibles)} bajo demanda · ${muertos.length} caras y sin uso acá` },
  );
}

const tokensDe = (chars) => Math.ceil(chars / 4);

// ── Fuentes ─────────────────────────────────────────────────────────────────

function pestanaFuentes(m, rutaRaiz) {
  // La ficha del proyecto vive acá: en Salud tapaba el estado del arnés con una descripción.
  return tarjetaProyecto(m, rutaRaiz) + seccion(
    "fuentes-lista",
    "Fuentes y regeneración",
    `<p class="nota">La memoria del panel se DERIVA de los archivos de abajo, sin ningún modelo de lenguaje ni red: leerlo es leerlos. Se regenera con <code>${escapar(m.comando)}</code> y en cada corrida del gate. Su versión es el hash del modelo: si cambia algo que el panel muestra, cambia la versión. La pestaña «Ahora» es aparte: lee git, el registro del gate, las sondas y el gestor, y por eso lleva hora.</p>
     ${tabla(["Archivo", "Hash", "Líneas"], m.fuentes.map((f) => [`<a href="${escapar(`${rutaRaiz}/${f.ruta}`)}"><code>${escapar(f.ruta)}</code></a>`, `<code>${escapar(f.hash)}</code>`, String(f.lineas)]))}
     ${m.faltantes?.length ? `<h3>Fuentes que no están <small>${m.faltantes.length}</small></h3><p class="nota">El config las nombra (o son el default) y no existen en este repo. No es una alarma: el panel sale igual, sin esa parte.</p><ul class="vinetas">${m.faltantes.map((f) => `<li data-buscar><code>${escapar(f)}</code></li>`).join("")}</ul>` : ""}
     ${m.advertencias.length ? `<h3>Advertencias de las fuentes <small>${m.advertencias.length}</small></h3><ul class="vinetas advertencias">${m.advertencias.map((a) => `<li data-buscar>${escapar(a.que)} <span class="tenue">— <code>${escapar(a.comando)}</code></span></li>`).join("")}</ul>` : '<p class="ok">Las fuentes están bien formadas y todo puntero verificable existe.</p>'}`,
    { abierta: true },
  );
}

// ── Resumen (la portada ejecutiva) ──────────────────────────────────────────
//
// Contesta en orden: ¿cómo estamos?, ¿qué falla y por qué?, ¿qué hace cada uno?, ¿cómo vamos? y
// ¿la máquina está bien configurada? El diagnóstico lo arma `leer-resumen.mjs`; acá sólo se dibuja.

const ICONO_TONO = { verde: "✓", rojo: "✕", advertencia: "!", omitido: "–", info: "i", neutro: "·" };
const NOMBRE_TONO = { verde: "verde", rojo: "rojo", advertencia: "atención", omitido: "omitida", info: "info", neutro: "sin dato" };

/** Fecha absoluta en el HTML (determinista); el JS la reescribe como «hace X min» en vivo. */
const cuando = (iso) => (iso ? `<time datetime="${escapar(iso)}" data-relativo>${fecha(iso)}</time>` : "—");

/**
 * Dona de estados. Una sola serie partida en estados: cada arco lleva su `<title>` (tooltip) y la
 * leyenda repite conteo y nombre, así que el color nunca es lo único que dice el estado.
 */
function dona(partes, { centro = "", sub = "", etiqueta = "" } = {}) {
  const total = partes.reduce((n, p) => n + p.valor, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let acumulado = 0;
  const arcos = total
    ? partes
        .filter((p) => p.valor > 0)
        .map((p) => {
          const largo = (p.valor / total) * C;
          // 2px de separación entre segmentos (el «espaciador» de superficie) salvo con un solo segmento.
          const hueco = partes.filter((x) => x.valor > 0).length > 1 ? 2 : 0;
          const arco = `<circle class="dona__arco dona__arco--${p.tono}" r="${R}" cx="70" cy="70" stroke-dasharray="${Math.max(0, largo - hueco).toFixed(2)} ${(C - Math.max(0, largo - hueco)).toFixed(2)}" stroke-dashoffset="${(-acumulado).toFixed(2)}"><title>${escapar(p.nombre)}: ${p.valor} de ${total}</title></circle>`;
          acumulado += largo;
          return arco;
        })
        .join("")
    : `<circle class="dona__fondo" r="${R}" cx="70" cy="70"></circle>`;
  return `<div class="dona"><svg viewBox="0 0 140 140" role="img" aria-label="${escapar(etiqueta)}"><circle class="dona__fondo" r="${R}" cx="70" cy="70"></circle><g transform="rotate(-90 70 70)">${arcos}</g><text x="70" y="68" text-anchor="middle" class="dona__centro">${escapar(centro)}</text><text x="70" y="88" text-anchor="middle" class="dona__sub">${escapar(sub)}</text></svg>
    <ul class="dona__leyenda">${partes.map((p) => `<li>${punto(p.tono)} <strong>${p.valor}</strong> ${escapar(p.nombre)}</li>`).join("")}</ul></div>`;
}

/** Historial del gate: una columna por corrida, apilada verde/rojo/omitida. */
function tendenciaDelGate(historial) {
  if (!historial.length) return '<p class="vacio">Se arma sola con cada corrida del gate en esta máquina.</p>';
  const max = Math.max(1, ...historial.map((h) => h.verdes + h.rojas + h.omitidas));
  const cols = historial
    .map((h) => {
      const total = h.verdes + h.rojas + h.omitidas;
      const alto = (n) => `${((n / max) * 100).toFixed(1)}%`;
      const tip = `${fecha(h.fecha)} · ${h.veredicto}${h.modo ? ` (${h.modo})` : ""} · ${h.verdes} verdes, ${h.rojas} rojas, ${h.omitidas} omitidas${h.head ? ` · ${h.head}` : ""}`;
      return `<div class="pila" title="${escapar(tip)}" tabindex="0" aria-label="${escapar(tip)}"><div class="pila__col" style="height:${alto(total)}">${h.rojas ? `<i class="pila__rojo" style="flex:${h.rojas}"></i>` : ""}${h.omitidas ? `<i class="pila__omitido" style="flex:${h.omitidas}"></i>` : ""}${h.verdes ? `<i class="pila__verde" style="flex:${h.verdes}"></i>` : ""}</div><span class="pila__marca pila__marca--${h.veredicto === "verde" ? "verde" : h.veredicto === "rojo" ? "rojo" : "info"}">${ICONO_TONO[h.veredicto === "verde" ? "verde" : h.veredicto === "rojo" ? "rojo" : "info"]}</span><span>${escapar(String(h.fecha).slice(5, 10))}</span></div>`;
    })
    .join("");
  const extra = historial.length < 3 ? `<p class="nota">${historial.length} corrida(s) registrada(s): la tendencia se completa con las próximas.</p>` : "";
  return `<div class="pilas">${cols}</div><p class="leyenda leyenda--cuadros"><span class="c-verde">verdes</span><span class="c-rojo">rojas</span><span class="c-omitido">omitidas</span><span>✓/✕ = veredicto de la corrida</span></p>${extra}`;
}

/** Actividad del agente por día (mensajes): una sola serie, sin leyenda; el título la nombra. */
function actividad(dias) {
  if (!dias.length) return '<p class="vacio">Sin transcripciones de Claude Code en esta máquina.</p>';
  const max = Math.max(1, ...dias.map((d) => d.mensajes));
  return `<div class="barras barras--actividad">${dias
    .map((d) => `<div class="barra" title="${escapar(d.dia)} · ${d.mensajes} mensajes · ${abreviar(d.salida)} tokens de salida" tabindex="0"><div class="barra__col barra__col--llena" style="height:${Math.round((d.mensajes / max) * 100)}%"></div><span>${escapar(d.dia.slice(8))}</span></div>`)
    .join("")}</div>`;
}

function tarjetaKpi(valor, etiqueta, { tono = "neutro", detalle = "", href = "", progreso = null } = {}) {
  const barra = progreso == null ? "" : `<span class="kpi__barra" aria-hidden="true"><span class="kpi__lleno kpi__lleno--${tono}" style="width:${Math.max(0, Math.min(100, progreso))}%"></span></span>`;
  return `<a class="kpi kpi--${tono}"${href ? ` href="${href}"` : ""}><span class="kpi__etiqueta">${etiqueta}</span><span class="kpi__valor"><span class="kpi__icono" aria-hidden="true">${ICONO_TONO[tono] ?? ""}</span>${valor}</span>${barra}<span class="kpi__detalle">${detalle}</span></a>`;
}


// ── «Qué hacer»: la bandeja de cada uno ─────────────────────────────────────
//
// La portada del panel. Contesta dos preguntas y nada más: «¿qué me toca?» y «¿qué hace el
// agente?». El Resumen mezclaba estado, pendientes, gráficos y configuración, repetía ítems en las
// dos columnas y no mostraba los PR a votar (2026-11-10: «me pierdo en ese panel»).

// Los comandos del gestor salen de `panel.triage.commands` (`take`, `show`); el que el repo no
// declaró no se nombra: un prompt con un comando inventado manda al agente a correr algo que no existe.
const promptDeTarea = (it) =>
  [
    `Tomá #${it.id} «${it.titulo}»${it.url ? ` (${it.url})` : ""}.`,
    it.tomar ? `Corré \`${it.tomar}\`.` : null,
    it.ver ? `Leé su descripción y criterios con \`${it.ver}\`.` : "Leé su descripción y criterios en el gestor.",
    "Ejecutalo con el gate y cerralo cuando el gate esté verde. Si algo depende de una decisión mía, preguntame en vez de adivinar.",
  ]
    .filter(Boolean)
    .join(" ");

function tarjetaQueHacer(it, quien) {
  const titulo = it.url ? `<a href="${escapar(it.url)}" target="_blank" rel="noopener">${inline(it.titulo)}</a>` : inline(it.titulo);
  const espera = (it.esperaA ?? []).length
    ? `<p class="qh-espera">Espera a ${it.esperaA.map((p) => `<a href="${escapar(p.url ?? "")}" target="_blank" rel="noopener">#${p.id}</a> <span class="tenue">${escapar(breveTitulo(p.titulo))} · ${escapar(DE_QUIEN[p.dueno]?.(p) ?? "sin dueño")}</span>`).join(" · ")}</p>`
    : "";
  const prompt = quien === "agente" ? botonPrompt(Number.isFinite(Number(it.id)) ? promptDeTarea(it) : promptDeAccion({ texto: `${it.titulo}${it.porque ? ` — ${it.porque}` : ""}`, comando: it.comando, dueno: "agente", tono: "advertencia" }, "Qué hacer"), "Hacelo") : "";
  return `<li class="qh-tarjeta">
    <div class="qh-tarjeta__titulo" data-buscar>${titulo}</div>
    ${it.porque ? `<p class="qh-tarjeta__porque">${inline(it.porque)}</p>` : ""}
    ${espera}
    ${it.accion ? `<p class="qh-tarjeta__accion"><strong>Qué hacer:</strong> ${inline(it.accion)}</p>` : ""}
    <div class="qh-tarjeta__pie">${chip(escapar(it.origen ?? ""), "chip--gris")}${it.comando ? `<code>${escapar(it.comando)}</code>` : ""}${prompt}</div>
  </li>`;
}

const DE_QUIEN = { agente: () => "del agente", humano: () => "tuya", otro: (p) => `de ${p.asignado ?? "otra persona"}`, "sin-dueno": () => "sin dueño declarado" };

/** Arriba lo del foco y lo que no es del gestor (gate, PR, máquina); abajo, un plegable por frente (el contenedor). */
function porFrente(lista, quien) {
  const sueltos = lista.filter((it) => !it.frente || it.delFoco);
  const frentes = new Map();
  for (const it of lista.filter((x) => x.frente && !x.delFoco)) {
    if (!frentes.has(it.frente.id)) frentes.set(it.frente.id, { ...it.frente, items: [] });
    frentes.get(it.frente.id).items.push(it);
  }
  const ordenados = [...frentes.values()].sort((a, b) => b.items.length - a.items.length);
  const items = (l) => `<ul class="qh-lista">${l.map((it) => tarjetaQueHacer(it, quien)).join("")}</ul>`;
  return `${sueltos.length ? items(sueltos) : ""}${ordenados
    .map((fr) => `<details class="qh-frente"><summary><span class="qh-frente__nombre">${escapar(fr.titulo)}</span> <span class="qh-cuenta">${fr.items.length}</span></summary>${items(fr.items)}</details>`)
    .join("")}`;
}

const breveTitulo = (t) => {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  return s.length > 70 ? `${s.slice(0, 69)}…` : s;
};

/** Un grupo de la bandeja. `plegado` para lo que se consulta, no se actúa; vacío y sin `vacio`, no se muestra. */
function grupoQueHacer({ titulo, ayuda, lista, quien, plegado = false, vacio = null, max = Infinity }) {
  if (!lista.length) return vacio ? `<section class="qh-grupo qh-grupo--vacio"><h3>${titulo}</h3><p class="ok">✓ ${vacio}</p></section>` : "";
  const visibles = lista.slice(0, max);
  const resto = lista.slice(max);
  const items = (l) => `<ul class="qh-lista">${l.map((it) => tarjetaQueHacer(it, quien)).join("")}</ul>`;
  const cuerpo = `${items(visibles)}${resto.length ? `<details class="qh-mas"><summary>Ver ${resto.length} más</summary>${items(resto)}</details>` : ""}`;
  const cabecera = `${titulo} <span class="qh-cuenta">${lista.length}</span>`;
  return plegado
    ? `<section class="qh-grupo"><details><summary><h3>${cabecera}</h3></summary>${ayuda ? `<p class="qh-ayuda">${ayuda}</p>` : ""}${cuerpo}</details></section>`
    : `<section class="qh-grupo"><h3>${cabecera}</h3>${ayuda ? `<p class="qh-ayuda">${ayuda}</p>` : ""}${cuerpo}</section>`;
}

function pestanaQueHacer(modelo) {
  const b = construirBandeja(modelo);
  const { humano: h, agente: a } = b;
  const g = b.gate;
  const tono = b.estado.tono;
  const estado = `<section class="qh-estado qh-estado--${tono}" aria-live="polite">
      <span class="qh-estado__icono" aria-hidden="true">${ICONO_TONO[tono] ?? "·"}</span>
      <div><strong>${escapar(b.estado.titular)}</strong><span class="tenue"> · ${escapar(b.estado.detalle)}</span></div>
      <span class="qh-estado__meta tenue">${g ? `último gate ${cuando(g.fecha)}` : "el gate no corrió acá"}${b.leidoEn ? ` · gestor leído ${cuando(b.leidoEn)}` : ""}</span>
    </section>`;
  const aviso = b.error ? `<p class="qh-aviso">⚠ Sin datos del gestor:${escapar(b.error)}. Lo de abajo muestra sólo el gate y la máquina.</p>` : "";
  const paraVos = h.decidir.length + h.hacer.length;
  const tuyo = `<section class="qh-col qh-col--humano" aria-labelledby="qh-humano">
      <h2 id="qh-humano"><span aria-hidden="true">👤</span> Lo tuyo <small>${paraVos ? `${paraVos} para hacer` : "nada urgente"}</small></h2>
      ${grupoQueHacer({ titulo: "Decidir", ayuda: "Elegí una opción: el agente espera tu respuesta para seguir.", lista: h.decidir, quien: "humano", vacio: "Nada para decidir." })}
      <section class="qh-grupo"><h3>Hacer <span class="qh-cuenta">${h.hacer.length}</span></h3>
        <p class="qh-ayuda">Acciones que sólo vos podés hacer (votar, confirmar, configurar). Arriba lo urgente y lo del foco; abajo, por frente.</p>
        ${h.hacer.length ? porFrente(h.hacer, "humano") : '<p class="ok">✓ Nada para hacer.</p>'}</section>
      ${grupoQueHacer({ titulo: `Esperando respuesta de ${escapar(b.etiquetaExterna)}`, ayuda: "No se resuelven acá, se siguen. Cuando llegue la respuesta, anotala en el ítem y el agente sigue.", lista: h.esperando, quien: "humano", plegado: true })}
      ${grupoQueHacer({ titulo: "Frentes a tu nombre", ayuda: "Los contenedores del gestor: el contexto de las tareas, no acciones.", lista: h.frentes, quien: "humano", plegado: true })}
    </section>`;
  const listos = a.ya;
  const delAgente = `<section class="qh-col qh-col--agente" aria-labelledby="qh-agente">
      <h2 id="qh-agente"><span aria-hidden="true">🤖</span> Lo del agente <small>${listos.length ? `${listos.length} listas para hacer` : "nada listo"}</small><span class="empuje"></span>${listos.length ? botonPrompt(promptDePendientes(listos.map((it) => ({ tono: "info", texto: Number.isFinite(Number(it.id)) ? `#${it.id} ${it.titulo}` : it.titulo, comando: it.comando ?? it.tomar ?? null }))), "Hacé lo listo") : ""}</h2>
      <section class="qh-grupo"><h3>Puede hacer ya <span class="qh-cuenta">${listos.length}</span></h3>
        <p class="qh-ayuda">Nada que esperar. Arriba lo del foco y del gate; abajo, por frente. Pedí un frente entero o una tarea con «Hacelo».</p>
        ${listos.length ? porFrente(listos, "agente") : '<p class="ok">✓ Nada listo: todo espera algo.</p>'}</section>
      ${grupoQueHacer({ titulo: "Espera algo tuyo", ayuda: "Se destraban cuando cerrás lo que dice «espera a».", lista: a.esperaTuyo, quien: "agente" })}
      ${grupoQueHacer({ titulo: "Espera a otra persona", ayuda: "El predecesor es de alguien más o no tiene dueño: se sigue con esa persona (o se le declara dueño en el gestor).", lista: a.esperaOtros, quien: "agente", plegado: true })}
      ${grupoQueHacer({ titulo: "Después", ayuda: "Esperan otra tarea del agente: es el orden de trabajo, no un bloqueo.", lista: a.despues, quien: "agente", plegado: true })}
    </section>`;
  return `${estado}${aviso}<div class="qh-columnas">${tuyo}${delAgente}</div>
    <p class="nota">Sale del gestor (<code>panel.inbox</code>: el dueño y los predecesores de cada ítem, y los PR activos), del gate y de la máquina.${b.comandoDueno ? ` Para cambiar de quién es algo: <code>${escapar(b.comandoDueno)}</code>.` : ""}</p>`;
}


/**
 * Las secciones del diagnóstico que el repo quiere PRIMERO (`panel.doctor.highlight`, un regex sobre
 * el título): lo que, si falta, deja sin sentido al resto. Sin declarar, el orden del doctor.
 */
const destacadorDe = (fuente) => {
  if (!fuente) return () => false;
  try {
    const re = new RegExp(fuente, "i");
    return (titulo) => re.test(titulo);
  } catch {
    return () => false;
  }
};

function configuracion(doc) {
  const esArquitectura = destacadorDe(doc?.destacar);
  if (!doc) return '<p class="vacio">El repo no declara un diagnóstico de la máquina (<code>panel.doctor.command</code>).</p>';
  if (!doc.ok) return `<p>${chip("no se pudo leer el diagnóstico", "chip--mal")} <code>${escapar(doc.comando ?? "")}</code> ${escapar(doc.error ?? "")}</p>`;
  const secciones = [...doc.secciones].sort((a, b) => Number(esArquitectura(b.titulo)) - Number(esArquitectura(a.titulo)));
  const tonoDe = (s) => (s.chequeos.some((c) => c.tono === "rojo") ? "rojo" : s.chequeos.some((c) => c.tono === "advertencia") ? "advertencia" : "verde");
  return `<ul class="config">${secciones
    .map((s) => {
      const tono = tonoDe(s);
      const malos = s.chequeos.filter((c) => c.tono !== "verde");
      return `<li class="config__item config__item--${tono}${esArquitectura(s.titulo) ? " config__item--destacado" : ""}">
        <details${malos.length ? " open" : ""}><summary><span class="pendiente__marca pendiente__marca--${tono}" aria-label="${NOMBRE_TONO[tono]}">${ICONO_TONO[tono]}</span> <span data-buscar>${escapar(s.titulo)}</span> <small>${s.chequeos.length - malos.length}/${s.chequeos.length}</small></summary>
        <ul class="config__chequeos">${s.chequeos.map((c) => `<li>${punto(c.tono)} ${escapar(c.texto)}${c.arreglo ? `<br><span class="tenue">→ <code>${escapar(c.arreglo)}</code></span>` : ""}</li>`).join("")}</ul></details></li>`;
    })
    .join("")}</ul><p class="nota">Sale de <code>${escapar(doc.comando)}</code> al generar el panel.</p>`;
}

function tarjetaFoco(f) {
  if (!f) return '<p class="vacio">Sin foco fijado.</p>';
  if (f.error) return `<p>${chip("foco ilegible", "chip--mal")} ${escapar(f.error)}</p>`;
  const r = f.resumen;
  const humano = f.tareas.filter((t) => t.dueno === "humano");
  const agente = f.tareas.filter((t) => t.dueno === "agente");
  return `<p class="foco__titulo">${f.url ? `<a href="${escapar(f.url)}">#${escapar(String(f.id))}</a>` : `#${escapar(String(f.id))}`} <span data-buscar>${escapar(f.titulo)}</span></p>
    <p>${chip(escapar(f.estado || "?"), "chip--info")}${f.asignado ? ` asignado a <strong>${escapar(f.asignado)}</strong>` : ""}${f.leidoEn ? ` · leído del gestor ${cuando(f.leidoEn)}` : ""}</p>
    ${
      r && r.total
        ? `<div class="foco__avance"><span class="kpi__barra"><span class="kpi__lleno kpi__lleno--verde" style="width:${r.pct}%"></span></span> <strong>${r.pct}%</strong> <span class="tenue">${r.cerradas}/${r.total} tareas · humano ${humano.filter((t) => !t.cerrada).length} abiertas · agente ${agente.filter((t) => !t.cerrada).length} abiertas</span></div>`
        : `<p>${chip("sin desglose en el gestor", "chip--atencion")} El objetivo todavía no tiene tareas hijas: ver los pendientes de arriba.</p>`
    }`;
}

function pestanaResumen(m) {
  const r = construirResumen(m);
  const e = r.estado;
  const g = r.gate;
  // Los pendientes viven en UN solo lugar, «Qué hacer»: el Resumen sólo los cuenta y enlaza allá.
  // Tenía su propia lista en dos columnas, y eran dos listas distintas de lo mismo (2026-11-10).
  const b = construirBandeja(m);
  const h = [...b.humano.decidir, ...b.humano.hacer];
  const a = b.agente.ya;
  const doc = r.configuracion?.ok ? r.configuracion : null;
  const tonoConfig = !doc ? "neutro" : doc.bloqueantes ? "rojo" : doc.avisos ? "advertencia" : "verde";

  const hero = `<section class="hero hero--${e.tono}" aria-live="polite">
      <span class="hero__icono" aria-hidden="true">${ICONO_TONO[e.tono] ?? "·"}</span>
      <div class="hero__texto"><p class="hero__rotulo">Estado actual</p><h2>${escapar(e.titular)}</h2><p>${escapar(e.detalle)}</p></div>
      <dl class="hero__meta">
        ${g ? `<div><dt>Último gate</dt><dd>${cuando(g.fecha)} · ${escapar(g.modo ?? "")}${g.head ? ` · <code>${escapar(g.head)}</code>` : ""}</dd></div>` : ""}
        ${r.foco && !r.foco.error ? `<div><dt>Foco</dt><dd>${r.foco.url ? `<a href="${escapar(r.foco.url)}">#${escapar(String(r.foco.id))}</a>` : `#${escapar(String(r.foco.id))}`} · ${escapar(r.foco.estado)}</dd></div>` : ""}
      </dl>
    </section>`;

  const kpis = `<div class="kpis">
      ${g ? tarjetaKpi(`${g.verdes}/${g.total}`, "señales del gate en verde", { tono: g.rojas ? "rojo" : g.omitidas ? "advertencia" : "verde", progreso: g.total ? (g.verdes / g.total) * 100 : 0, detalle: g.rojas ? `${g.rojas} roja(s)${g.omitidas ? ` · ${g.omitidas} omitida(s)` : ""}` : g.omitidas ? `${g.omitidas} omitida(s)` : "todas pasaron", href: "#r-problemas" }) : tarjetaKpi("—", "señales del gate", { tono: "advertencia", detalle: "el gate no corrió acá" })}
      ${tarjetaKpi(String(h.length), "te toca a vos", { tono: b.humano.decidir.length ? "rojo" : h.length ? "advertencia" : "verde", detalle: h.length ? `${b.humano.decidir.length} para decidir · ${b.humano.hacer.length} para hacer` : "nada que hacer", href: "#que-hacer" })}
      ${tarjetaKpi(String(a.length), "el agente puede hacer ya", { tono: a.length ? "advertencia" : "verde", detalle: a.length ? "sin nada que esperar" : "nada listo", href: "#que-hacer" })}
      ${tarjetaKpi(doc ? `${doc.ok}/${doc.ok + doc.avisos + doc.bloqueantes}` : "—", "configuración de la máquina", { tono: tonoConfig, progreso: doc ? (doc.ok / Math.max(1, doc.ok + doc.avisos + doc.bloqueantes)) * 100 : null, detalle: !doc ? "sin diagnóstico" : doc.bloqueantes ? `${doc.bloqueantes} bloqueante(s)` : doc.avisos ? `${doc.avisos} aviso(s)` : "todo en orden", href: "#r-config" })}
    </div>`;

  const problemas = r.problemas.length
    ? `<section class="panel-bloque" id="r-problemas"><h3>Qué está fallando y por qué <small>${r.problemas.length}</small></h3>
        <div class="problemas">${r.problemas
          .map(
            (p) => `<article class="problema problema--${p.tono}">
              <div class="problema__cabecera"><span class="pendiente__marca pendiente__marca--${p.tono}" aria-label="${NOMBRE_TONO[p.tono]}">${ICONO_TONO[p.tono]}</span> <strong data-buscar>${escapar(p.titulo)}</strong> ${chip(p.dueno === "humano" ? "👤 humano" : "🤖 agente", p.dueno === "humano" ? "chip--atencion" : "chip--info")}</div>
              <p class="problema__que">${escapar(p.que)}</p>
              ${p.remedio ? `<p class="problema__remedio"><strong>Cómo se arregla:</strong> ${inline(p.remedio)}</p>` : ""}
              ${p.porque ? `<p class="problema__porque"><span class="tenue">Por qué importa:</span> ${inline(p.porque)}</p>` : ""}
              <p class="tenue problema__pie">${p.desde ? `verde por última vez ${cuando(p.desde)}` : p.dueno === "agente" ? "sin verde registrado en esta máquina" : ""}${p.reproducir ? `${p.desde || p.dueno === "agente" ? " · " : ""}<code>${escapar(p.reproducir)}</code>` : ""}</p>
            </article>`,
          )
          .join("")}</div></section>`
    : `<section class="panel-bloque" id="r-problemas"><h3>Qué está fallando</h3><p class="ok">✓ Nada: no hay señales rojas, alarmas ni configuración bloqueante.</p></section>`;


  const graficas = `<section class="panel-bloque"><h3>Cómo vamos</h3><div class="graficas">
      <figure><figcaption>Señales del gate (última corrida)</figcaption>${
        g
          ? dona(
              [
                { nombre: "verdes", valor: g.verdes, tono: "verde" },
                { nombre: "rojas", valor: g.rojas, tono: "rojo" },
                { nombre: "omitidas", valor: g.omitidas, tono: "omitido" },
              ],
              { centro: `${g.total ? Math.round((g.verdes / g.total) * 100) : 0}%`, sub: "en verde", etiqueta: `${g.verdes} de ${g.total} señales en verde` },
            )
          : '<p class="vacio">El gate no corrió en esta máquina.</p>'
      }</figure>
      <figure><figcaption>Tendencia del gate (corridas en esta máquina)</figcaption>${tendenciaDelGate(r.historial)}</figure>
      <figure><figcaption>Actividad del agente · mensajes por día</figcaption>${actividad(r.actividad)}</figure>
    </div></section>`;

  const abajo = `<div class="dos-columnas">
      <section class="panel-bloque" id="r-foco"><h3>Foco de la sesión</h3>${tarjetaFoco(r.foco)}</section>
      <section class="panel-bloque" id="r-config"><h3>Configuración de esta máquina <small>${doc ? `${doc.ok} ok · ${doc.avisos} aviso(s) · ${doc.bloqueantes} bloqueante(s)` : ""}</small></h3>${configuracion(r.configuracion)}</section>
    </div>`;

  return [hero, kpis, problemas, graficas, abajo, `<p class="nota">El detalle está en las otras pestañas: <a href="#registro">pipeline del gate → Ahora</a>, <a href="#repos">código → Ahora</a>, <a href="#mapa">mapa del arnés → Salud</a>.</p>`].join("");
}

// ── Indicadores por pestaña ─────────────────────────────────────────────────

/**
 * Cada pestaña muestra SÓLO sus indicadores. Antes eran once cajas idénticas arriba de todas las
 * pestañas —piezas del mapa y principios junto al estado del gate—: ruido que tapaba lo que
 * importaba en cada vista. El Resumen trae los suyos (ejecutivos) dentro de la pestaña.
 */
function indicadores(m) {
  const v = m.enVivo ?? null;
  const principios = m.reglas.constituciones.flatMap((c) => c.principios);
  const sinFreno = m.gotchas.filter((g) => !g.ejecutable).length;
  const reg = v?.gate.registro ?? null;
  const raiz = v?.repos.find((r) => !r.ausente) ?? null;
  const plan = v?.plan ?? m.plan;
  return {
    // Salud trae su propio tablero (dimensiones con puntaje). Las cajas sueltas de antes enlazaban
    // a otras pestañas —«señales del gate» saltaba a Reglas— y no decían nada del estado.
    salud: [],
    ahora: v
      ? [
          indicador(reg ? escapar(reg.veredicto) : "sin dato", "último gate (esta máquina)", { tono: reg ? (reg.veredicto === "verde" ? "verde" : reg.veredicto === "rojo" ? "rojo" : "info") : "advertencia", href: "#registro", detalle: reg ? fecha(reg.fecha) : "nunca corrió acá" }),
          indicador(v.gate.pendiente ? "pendiente" : "al día", "gate de la sesión", { tono: v.gate.pendiente ? "advertencia" : "verde", href: "#gate-vivo", detalle: v.gate.pendiente ? "código editado sin gate" : "nada sin verificar" }),
          raiz ? indicador(String(raiz.cambios.length), "archivos cambiados", { tono: raiz.limpio ? "verde" : "advertencia", href: "#repos", detalle: `rama ${escapar(raiz.rama ?? "?")}` }) : "",
          v.tokens ? indicador(abreviar(v.tokens.hoy.salida), "tokens de salida hoy", { tono: "info", href: "#tokens", detalle: `${abreviar(v.tokens.total.salida)} en ${v.tokens.dias} días` }) : "",
        ]
      : [],
    plan: [
      plan?.estado === "ok"
        ? indicador(`${plan.resumen.pct}%`, "plan hecho", { tono: plan.resumen.pct === 100 ? "verde" : "info", detalle: `${plan.resumen.hechas}/${plan.resumen.total} · ${plan.resumen.pendientes} pendientes` })
        : "",
    ],
    estado: [],
    gotchas: [indicador(String(m.gotchas.length), "gotchas pagados", { tono: sinFreno ? "advertencia" : "verde", detalle: `${sinFreno} sin freno ejecutable` })],
    reglas: [indicador(String(principios.length), "principios", { href: "#constituciones", detalle: `${principios.filter((p) => p.fuerza === "BLOCKING").length} BLOCKING · ${principios.filter((p) => p.fuerza === "REVIEW").length} REVIEW` })],
  };
}

// ── Página ──────────────────────────────────────────────────────────────────

const CSS = `
:root{--fondo:#f4f6f9;--papel:#fff;--tinta:#1c1f23;--tenue:#5b6470;--borde:#dde1e6;--acento:#0b5cad;--verde:#1a7f37;--rojo:#c62828;--ambar:#b26a00;--gris:#8a94a0;--info:#5b4bb5;--codigo:#eef1f5;--sombra:0 1px 2px rgba(16,24,40,.06);--lienzo:1240px;--margen:24px}
@media (prefers-color-scheme:dark){:root{--fondo:#12161b;--papel:#1a2027;--tinta:#e6e9ee;--tenue:#9aa4b1;--borde:#2c343e;--acento:#6cb0ff;--verde:#4cc26a;--rojo:#ff6b6b;--ambar:#f0b04a;--gris:#7c8794;--info:#a89bff;--codigo:#232b35;--sombra:none}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--fondo);color:var(--tinta);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--acento)}code{font:.9em ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--codigo);padding:.05em .35em;border-radius:4px;word-break:break-word}
code.regex{white-space:pre-wrap}
/* El encabezado sangra a todo lo ancho (la barra pegajosa es de la página), pero SU CONTENIDO va
   en el mismo lienzo y con el mismo margen que el del contenido: si no, el título y las pestañas
   arrancan 20 px antes que las tarjetas y nada alinea. Un solo par de tokens manda en los dos. */
header{position:sticky;top:0;z-index:2;background:var(--papel);border-bottom:1px solid var(--borde);padding:10px 0}
header>.titulo,header>.barra-superior,header>.veredicto{max-width:var(--lienzo);margin-left:auto;margin-right:auto;padding-left:var(--margen);padding-right:var(--margen)}
/* La tira y la búsqueda comparten FILA: la búsqueda ocupa el hueco que dejan las pestañas a la
   derecha, que antes era media pantalla vacía y una fila entera de alto. La línea base es de la
   fila, no de la tira, para que corra de margen a margen. */
header>.barra-superior{display:flex;align-items:flex-end;gap:16px;margin-top:10px;border-bottom:1px solid var(--borde)}
.titulo{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px 20px}
.titulo h1{margin:0;font-size:20px}.titulo .meta{color:var(--tenue);font-size:13px}
/* Pestañas de CARPETA: la activa se funde con el panel de abajo (su borde inferior es del color
   del papel y pisa la línea base con el margen negativo). Sin eso son botones, no pestañas. */
/* El -1px va en la TIRA, no en cada pestaña: con el desbordamiento recortado (que es lo que evita
   una barra vertical fantasma de 1px), el sobresaliente de la pestaña activa se cortaba y la
   carpeta dejaba de fundirse. Bajando la tira entera, nada sobresale de su caja. */
nav.pestanas{display:flex;gap:4px;margin:0 0 -1px;flex:1 1 auto;min-width:0;align-items:flex-end;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;scroll-snap-type:x proximity}
nav.pestanas button{flex:none;scroll-snap-align:start;border:1px solid transparent;border-bottom:1px solid var(--borde);background:transparent;color:var(--tenue);padding:8px 16px;border-radius:8px 8px 0 0;cursor:pointer;font:inherit;white-space:nowrap;border-top:2px solid transparent}
nav.pestanas button:hover{color:var(--tinta);background:var(--fondo)}
nav.pestanas button.activo{background:var(--papel);border-color:var(--borde);border-top-color:var(--acento);border-bottom-color:var(--papel);color:var(--tinta);font-weight:600}
nav.pestanas button:focus-visible{outline:2px solid var(--acento);outline-offset:-3px}
nav.pestanas button.activo small{color:var(--acento)}
.pestana:focus-visible{outline:2px solid var(--acento);outline-offset:4px;border-radius:6px}
.barra-de-busqueda{display:flex;gap:8px;align-items:center;flex:0 1 auto;margin:0 0 6px auto;min-width:0}
/* Nada de vw acá: la diferencia con el ancho disponible es la barra de desplazamiento, y esa
   cuenta ya costó un desborde horizontal en este repo. El ancho lo negocia el flex. */
.barra-de-busqueda input{flex:0 1 340px;min-width:140px;padding:6px 12px;border:1px solid var(--borde);border-radius:999px;background:var(--fondo);color:var(--tinta);font:inherit}
.barra-de-busqueda .coincidencias{color:var(--tenue);font-size:13px;white-space:nowrap}
.barra-de-busqueda .filtro--accion{margin-left:0;flex:none}
main{max-width:var(--lienzo);margin:0 auto;padding:18px var(--margen) 80px}
.pestana{display:none}.pestana.activa{display:block}
.indicadores{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 18px}
.indicadores--compactos{margin:0 0 14px}
.indicador{display:flex;flex-direction:column;gap:2px;background:var(--papel);border:1px solid var(--borde);border-left:4px solid var(--gris);border-radius:10px;padding:10px 14px;text-decoration:none;color:inherit;box-shadow:var(--sombra)}
.indicador:hover{border-color:var(--acento)}
.indicador--verde{border-left-color:var(--verde)}.indicador--rojo{border-left-color:var(--rojo)}.indicador--advertencia{border-left-color:var(--ambar)}.indicador--info{border-left-color:var(--info)}.indicador--omitido{border-left-color:var(--gris)}
.indicador__valor{font-size:22px;font-weight:700;line-height:1.1}.indicador--verde .indicador__valor{color:var(--verde)}.indicador--rojo .indicador__valor{color:var(--rojo)}.indicador--advertencia .indicador__valor{color:var(--ambar)}
.indicador__etiqueta{font-size:12px;color:var(--tenue);text-transform:uppercase;letter-spacing:.03em}.indicador__detalle{font-size:12px;color:var(--tenue)}
.proyecto{display:flex;gap:18px;align-items:flex-start;background:var(--papel);border:1px solid var(--borde);border-radius:10px;padding:16px 20px;margin:0 0 18px;box-shadow:var(--sombra)}
.proyecto h2{margin:0 0 4px;font-size:18px}.proyecto p{margin:.4em 0}.logo{flex:none}
.bloque{background:var(--papel);border:1px solid var(--borde);border-radius:10px;margin:0 0 14px;box-shadow:var(--sombra)}
.bloque>summary{padding:12px 20px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;cursor:pointer;list-style:none}
.bloque>summary::-webkit-details-marker{display:none}
.bloque>summary::before{content:"▸";color:var(--tenue);transition:transform .15s}.bloque[open]>summary::before{transform:rotate(90deg)}
.bloque>summary h2{margin:0;font-size:16px;display:inline-flex;align-items:center;gap:8px}
.bloque>summary .resumen{color:var(--tenue);font-size:13px}.bloque[open]>summary .resumen{display:none}
.bloque__cuerpo{padding:0 20px 16px}
h2 small,h3 small,summary small,.filtro small{color:var(--tenue);font-weight:400;font-size:12px}
h3{font-size:15px;margin:14px 0 8px}
.nota{color:var(--tenue);font-size:14px}.nota p{margin:.4em 0}.tenue{color:var(--tenue)}
.vacio{color:var(--tenue);font-style:italic}.ok{color:var(--verde)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;vertical-align:top;padding:8px 10px;border-top:1px solid var(--borde)}
th{color:var(--tenue);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em;border-top:0}
.senales td:first-child{width:24px}
.punto{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--gris);vertical-align:middle;flex:none}
.punto--verde{background:var(--verde)}.punto--rojo{background:var(--rojo)}.punto--advertencia{background:var(--ambar)}.punto--omitido{background:var(--gris);outline:2px dashed var(--gris);outline-offset:-3px}.punto--info{background:var(--info)}
.veredicto{border-left:4px solid var(--gris);padding:10px 14px;border-radius:6px;background:var(--fondo)}
.veredicto--verde{border-color:var(--verde)}.veredicto--rojo{border-color:var(--rojo)}.veredicto--advertencia{border-color:var(--ambar)}
.veredicto__cabecera{display:flex;align-items:center;gap:8px;font-weight:600;flex-wrap:wrap}.veredicto__cabecera .meta{margin-left:auto;font-weight:400;color:var(--tenue);font-size:13px}
.veredicto p{margin:.5em 0}
ul.vinetas{margin:0;padding-left:20px}ul.vinetas>li{margin:6px 0}ul.hijos{margin:4px 0 0;padding-left:18px;color:var(--tenue);font-size:14px}
.chip{display:inline-block;font-size:11px;line-height:1.4;padding:1px 8px;border-radius:999px;border:1px solid var(--borde);color:var(--tenue);margin:2px 4px 2px 0;text-decoration:none;white-space:nowrap}
.chip--ok{border-color:var(--verde);color:var(--verde)}.chip--mal{border-color:var(--rojo);color:var(--rojo)}.chip--gris{border-color:var(--gris)}.chip--info{border-color:var(--info);color:var(--info)}.chip--fuerte{background:var(--acento);border-color:var(--acento);color:#fff}
.punteros{margin-top:8px}
.filtros{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
.filtro{border:1px solid var(--borde);background:transparent;color:var(--tinta);padding:4px 10px;border-radius:999px;cursor:pointer;font:inherit;font-size:13px;display:inline-flex;align-items:center;gap:6px}
.filtro.activo{border-color:var(--acento);color:var(--acento)}.filtro--accion{margin-left:auto;color:var(--tenue)}
.etiquetas{display:inline-flex;flex-wrap:wrap;gap:4px;align-items:center;vertical-align:middle}
.etiquetas--barra{display:flex;width:100%;gap:5px;margin:0 0 12px;padding:8px 10px;background:var(--fondo);border:1px solid var(--borde);border-radius:8px}
.etiquetas__titulo{color:var(--tenue);font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-right:4px}
.etiqueta{font:inherit;font-size:11px;font-weight:400;line-height:1.5;padding:1px 9px;border-radius:999px;border:1px solid var(--borde);background:transparent;color:var(--tenue);cursor:pointer;white-space:nowrap}
.etiqueta:hover{border-color:var(--acento);color:var(--acento)}
.etiqueta.activa{background:var(--acento);border-color:var(--acento);color:#fff}
.etiqueta.activa small{color:#fff}
.etiqueta--gate{border-color:var(--info);color:var(--info)}
.etiqueta--mal{border-color:var(--rojo);color:var(--rojo)}
.etiqueta--fuerte{border-color:var(--acento);color:var(--acento)}
.etiqueta--limpiar{margin-left:auto;border-style:dashed}
.tarjeta{border-top:1px solid var(--borde);padding:6px 0}
.tarjeta details>summary,details.grupo>summary,.bloque__cuerpo details>summary,.proyecto details>summary{cursor:pointer;list-style:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 0;font-weight:600}
.bloque__cuerpo details>summary::-webkit-details-marker,.proyecto details>summary::-webkit-details-marker{display:none}
.bloque__cuerpo details>summary::before,.proyecto details>summary::before{content:"▸";color:var(--tenue);font-weight:400;transition:transform .15s}
.bloque__cuerpo details[open]>summary::before,.proyecto details[open]>summary::before{transform:rotate(90deg)}
details .cuerpo{padding:4px 0 8px 18px}
details.grupo{border-top:1px solid var(--borde);padding:4px 0}
.num{font:600 12px ui-monospace,monospace;color:var(--tenue);min-width:34px}
dl{margin:0}.campo{display:grid;grid-template-columns:96px 1fr;gap:10px;margin:6px 0}dt{color:var(--tenue);font-size:12px;text-transform:uppercase;letter-spacing:.03em;padding-top:2px}dd{margin:0}
.mecanismo{margin-top:8px;padding:8px 12px;background:var(--fondo);border-radius:6px}.mecanismo p{margin:.3em 0}
.columnas{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:20px}
.advertencias li{color:var(--rojo)}
.mas{color:var(--verde)}.menos{color:var(--rojo)}
pre.diff{font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--codigo);border-radius:6px;padding:10px 12px;overflow:auto;max-height:480px;margin:6px 0}
.d-mas{color:var(--verde)}.d-menos{color:var(--rojo)}.d-hunk{color:var(--info)}.d-meta{color:var(--tenue)}
.barras{display:flex;gap:6px;align-items:flex-end;height:140px;padding:0 4px;border-bottom:1px solid var(--borde)}
.barra{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;font-size:10px;color:var(--tenue)}
.barra__col{width:100%;background:var(--acento);opacity:.35;border-radius:3px 3px 0 0;display:flex;flex-direction:column;justify-content:flex-end;min-height:1px}
.barra__salida{background:var(--acento);opacity:1;border-radius:3px 3px 0 0}
.barra span{margin-top:4px}
.barras--semanas{height:120px}
.barras--semanas .barra__col{opacity:1;background:var(--codigo);border:1px solid var(--borde);border-bottom:0}
.barras--semanas .barra__salida{background:var(--verde);border-radius:0}
.avance{width:120px;height:8px;background:var(--codigo);border-radius:4px;overflow:hidden}
.avance__lleno{height:100%;background:var(--verde);border-radius:4px}
table.frentes td:nth-child(2){min-width:220px}
.no-afirma li{color:var(--tenue)}
.piezas{display:flex;flex-wrap:wrap;gap:6px 14px}.pieza{display:inline-flex;align-items:center;gap:6px}.pieza small{color:var(--tenue)}
table.mapa td:first-child{white-space:nowrap;width:160px}
.grafico{width:100%;height:auto;max-height:260px;display:block;margin:6px 0}
.grafico polyline{fill:none;stroke-width:2}.g-alcance{stroke:var(--gris)}.g-hecho{stroke:var(--verde)}.g-pend{stroke:var(--acento)}.g-ideal{stroke:var(--ambar);stroke-dasharray:6 4}
.g-rejilla{stroke:var(--borde);stroke-width:1}.g-eje{fill:var(--tenue);font-size:11px}
.leyenda{font-size:12px;color:var(--tenue);display:flex;gap:14px;flex-wrap:wrap}.leyenda span::before{content:"";display:inline-block;width:14px;height:3px;margin-right:6px;vertical-align:middle}
.l-alcance::before{background:var(--gris)}.l-hecho::before{background:var(--verde)}.l-pend::before{background:var(--acento)}.l-ideal::before{background:var(--ambar)}
.chip--atencion{border-color:var(--ambar);color:var(--ambar)}
.avance--ancho{width:160px;max-width:100%}
table.memoria code{word-break:break-all}.avance__lleno--info{background:var(--info)}
[hidden]{display:none!important}
/* ── Cabecera: proyecto, estado en una frase, responsable y latido en vivo ── */
.titulo{align-items:center}.titulo h1{display:flex;align-items:baseline;gap:10px}.titulo__proyecto{font-size:13px;font-weight:400;color:var(--tenue)}
.titulo__derecha{margin-left:auto;display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:13px}
.pastilla{display:inline-flex;align-items:center;gap:8px;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:600;text-decoration:none;border:1px solid var(--borde);color:var(--tinta);background:var(--fondo)}
.pastilla>span{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;color:#fff;background:var(--gris);font-size:11px}
.pastilla--verde>span{background:var(--verde)}.pastilla--rojo>span{background:var(--rojo)}.pastilla--advertencia>span{background:var(--ambar)}
.pastilla--rojo{border-color:var(--rojo)}.pastilla--advertencia{border-color:var(--ambar)}.pastilla--verde{border-color:var(--verde)}
.vivo{display:inline-flex;align-items:center;gap:6px;color:var(--tenue)}
.vivo__punto{width:8px;height:8px;border-radius:50%;background:var(--gris)}
.vivo--on .vivo__punto{background:var(--verde);box-shadow:0 0 0 0 var(--verde);animation:latido 2s infinite}
.vivo--caido .vivo__punto{background:var(--ambar);animation:none}
@keyframes latido{0%{box-shadow:0 0 0 0 rgba(26,127,55,.5)}70%{box-shadow:0 0 0 7px rgba(26,127,55,0)}100%{box-shadow:0 0 0 0 rgba(26,127,55,0)}}
@media (prefers-reduced-motion:reduce){.vivo--on .vivo__punto{animation:none}}
.pie{margin-top:28px;color:var(--tenue);font-size:12px;text-align:center}
/* ── Resumen ── */
.hero{display:grid;grid-template-columns:auto 1fr auto;gap:18px;align-items:center;background:var(--papel);border:1px solid var(--borde);border-left:6px solid var(--gris);border-radius:12px;padding:18px 22px;margin:0 0 16px;box-shadow:var(--sombra)}
.hero--verde{border-left-color:var(--verde)}.hero--rojo{border-left-color:var(--rojo)}.hero--advertencia{border-left-color:var(--ambar)}
.hero__icono{display:grid;place-items:center;width:56px;height:56px;border-radius:50%;font-size:28px;font-weight:700;color:#fff;background:var(--gris)}
.hero--verde .hero__icono{background:var(--verde)}.hero--rojo .hero__icono{background:var(--rojo)}.hero--advertencia .hero__icono{background:var(--ambar)}
.hero__rotulo{margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--tenue)}
.hero h2{margin:2px 0 4px;font-size:22px;line-height:1.25}.hero__texto p{margin:0;color:var(--tenue)}
.hero__meta{display:grid;gap:6px;font-size:13px;min-width:200px}.hero__meta div{display:grid;grid-template-columns:96px 1fr;gap:8px;align-items:baseline}.hero__meta dt{padding:0;white-space:nowrap}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:0 0 18px}
.kpi{display:flex;flex-direction:column;gap:4px;background:var(--papel);border:1px solid var(--borde);border-radius:12px;padding:14px 16px;text-decoration:none;color:inherit;box-shadow:var(--sombra)}
a.kpi[href]:hover{border-color:var(--acento)}
.kpi__etiqueta{font-size:12px;color:var(--tenue);text-transform:uppercase;letter-spacing:.04em}
.kpi__valor{font-size:30px;font-weight:700;line-height:1.1;display:flex;align-items:center;gap:10px}
.kpi__icono{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;font-size:13px;color:#fff;background:var(--gris)}
.kpi--verde .kpi__icono{background:var(--verde)}.kpi--rojo .kpi__icono{background:var(--rojo)}.kpi--advertencia .kpi__icono{background:var(--ambar)}.kpi--info .kpi__icono{background:var(--info)}
.kpi__detalle{font-size:13px;color:var(--tenue)}
.kpi__barra{display:block;height:6px;background:var(--codigo);border-radius:3px;overflow:hidden}
.kpi__lleno{display:block;height:100%;border-radius:3px;background:var(--gris)}.kpi__lleno--verde{background:var(--verde)}.kpi__lleno--rojo{background:var(--rojo)}.kpi__lleno--advertencia{background:var(--ambar)}
.panel-bloque{background:var(--papel);border:1px solid var(--borde);border-radius:12px;padding:6px 20px 16px;margin:0 0 16px;box-shadow:var(--sombra)}
.problemas{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.problema{border:1px solid var(--borde);border-top:4px solid var(--gris);border-radius:10px;padding:10px 14px;background:var(--fondo)}
.problema--rojo{border-top-color:var(--rojo)}.problema--advertencia{border-top-color:var(--ambar)}
.problema__cabecera{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.problema p{margin:6px 0}
.problema__que{font-weight:600}.problema__porque{font-size:14px}.problema__pie{font-size:12px}
.dos-columnas{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px;margin:0 0 16px}
.dos-columnas>.panel-bloque{margin:0}
.tablero-columna{background:var(--papel);border:1px solid var(--borde);border-radius:12px;padding:6px 20px 14px;box-shadow:var(--sombra)}
.quien{font-size:18px}
ul.pendientes{list-style:none;margin:0;padding:0}
.pendiente{display:grid;grid-template-columns:24px 1fr;gap:10px;padding:10px 0;border-top:1px solid var(--borde)}
.pendiente:first-child{border-top:0}
.pendiente__marca{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;font-size:12px;font-weight:700;color:#fff;background:var(--gris);flex:none}
.pendiente--rojo .pendiente__marca,.pendiente__marca--rojo{background:var(--rojo)}.pendiente--advertencia .pendiente__marca,.pendiente__marca--advertencia{background:var(--ambar)}.pendiente--info .pendiente__marca{background:var(--info)}.pendiente__marca--verde{background:var(--verde)}
.pendiente__comando{display:inline-block;margin-top:4px;font-size:12px}
.graficas{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}
.graficas figure{margin:0}.graficas figcaption{font-size:13px;font-weight:600;margin:0 0 10px}
.dona{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.dona svg{width:140px;height:140px;flex:none}
.dona__fondo{fill:none;stroke:var(--codigo);stroke-width:18}.dona__arco{fill:none;stroke-width:18}
.dona__arco--verde{stroke:var(--verde)}.dona__arco--rojo{stroke:var(--rojo)}.dona__arco--omitido{stroke:var(--gris)}.dona__arco--advertencia{stroke:var(--ambar)}
.dona__centro{font-size:24px;font-weight:700;fill:var(--tinta)}.dona__sub{font-size:11px;fill:var(--tenue)}
.dona__leyenda{list-style:none;margin:0;padding:0;font-size:14px;display:grid;gap:6px}
.pilas{display:flex;gap:4px;align-items:flex-end;height:150px;border-bottom:1px solid var(--borde);padding:0 2px}
.pila{flex:1;max-width:40px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;font-size:10px;color:var(--tenue);outline-offset:2px}
.pila__col{width:100%;display:flex;flex-direction:column;gap:2px;min-height:2px}
.pila__col i{display:block;min-height:2px}.pila__col i:first-child{border-radius:4px 4px 0 0}
.pila__verde{background:var(--verde)}.pila__rojo{background:var(--rojo)}.pila__omitido{background:var(--gris)}
.pila__marca{font-weight:700;margin-top:3px}.pila__marca--verde{color:var(--verde)}.pila__marca--rojo{color:var(--rojo)}
.leyenda--cuadros span::before{width:10px;height:10px;border-radius:2px}.c-verde::before{background:var(--verde)}.c-rojo::before{background:var(--rojo)}.c-omitido::before{background:var(--gris)}
.barras--actividad{height:150px}.barra__col--llena{opacity:1;border-radius:4px 4px 0 0}
.config{list-style:none;margin:0;padding:0}
.config__item{border-top:1px solid var(--borde)}.config__item:first-child{border-top:0}
.config__item summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;padding:8px 0}
.config__item summary::-webkit-details-marker{display:none}
.config__item--destacado{background:var(--fondo);border-radius:8px;padding:0 10px;margin:0 -10px 4px;border-top:0}
.config__chequeos{list-style:none;margin:0 0 8px;padding:0 0 0 30px;font-size:14px;display:grid;gap:4px}
.foco__titulo{font-weight:600;margin:.6em 0 .3em}.foco__avance{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.foco__avance .kpi__barra{flex:0 0 160px}
/* ── Pestañas sin desplazamiento horizontal: se acomodan en varias filas antes que mostrar una barra ── */
nav.pestanas{flex-wrap:wrap;overflow:visible;row-gap:2px}
nav.pestanas button{padding:8px 11px}
.titulo .barra-de-busqueda{margin:0}.barra-de-busqueda input{flex:0 1 180px;min-width:110px;padding:4px 12px}
.insignia{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;font-size:11px;font-weight:700;margin-left:4px}
.insignia--hay{background:var(--ambar);color:#fff}.insignia--cero{background:transparent;color:var(--verde)}.insignia--cero::before{content:"✓";font-size:12px}.insignia--cero{font-size:0}
nav.pestanas button.activo small.insignia--hay{color:#fff}
/* ── «Qué hacer» ── */
.que-hacer{background:var(--papel);border:1px solid var(--borde);border-left:6px solid var(--ambar);border-radius:12px;padding:6px 20px 12px;margin:0 0 16px;box-shadow:var(--sombra)}
.que-hacer--ok{border-left-color:var(--verde)}.que-hacer--ok p{margin:.2em 0 .5em}
.que-hacer h3{display:flex;align-items:center;gap:8px}
ol.acciones{list-style:none;margin:0;padding:0;counter-reset:accion}
.accion{display:grid;grid-template-columns:24px 1fr auto;gap:10px;align-items:start;padding:8px 0;border-top:1px solid var(--borde)}
.accion:first-child{border-top:0}.accion code{font-size:12px}
.pendiente__marca--info{background:var(--info)}.pendiente__marca--omitido{background:var(--gris)}
/* ── Deuda accionable ── */
.kpis--compactos{margin:6px 0 14px}.kpis--compactos .kpi__valor{font-size:24px}
.dos-columnas--plano{margin:0}
.deuda{border:1px solid var(--borde);border-left:4px solid var(--info);border-radius:10px;padding:10px 14px;margin:0 0 10px;background:var(--fondo)}
.deuda--humano{border-left-color:var(--ambar)}
.deuda__cabecera{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.deuda p{margin:6px 0}.deuda__detalle{font-size:14px}
.deuda__remedio{font-size:14px;padding:6px 10px;border-radius:6px;background:var(--papel)}
.deuda__remedio--falta{color:var(--rojo)}.deuda__pie{font-size:12px}
/* ── Lo que está en rojo ── */
.tira{display:flex;flex-wrap:wrap;gap:3px;margin:8px 0 4px}
.tira__celda{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:5px;color:#fff;font-size:12px;font-weight:700;background:var(--gris)}
.tira__celda--verde{background:var(--verde)}.tira__celda--rojo{background:var(--rojo)}
.roja{border:1px solid var(--borde);border-top:4px solid var(--rojo);border-radius:10px;padding:10px 14px;margin:12px 0;background:var(--fondo)}
.roja__cuerpo{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:16px}
.roja h4{margin:10px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--tenue)}
pre.error{font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--codigo);border-left:3px solid var(--rojo);border-radius:6px;padding:8px 10px;margin:0;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto}
.problema__remedio{font-size:14px;padding:6px 10px;border-radius:6px;background:var(--papel)}
.empuje{flex:1 1 auto}
/* Los destinos de un enlace interno no quedan debajo de la cabecera fija. */
main [id]{scroll-margin-top:150px}
/* ── Salud: tablero por dimensiones ── */
.salud__puntaje{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:12px}
.salud__puntaje .dona svg{width:110px;height:110px}.salud__puntaje .dona__leyenda{display:none}
.dims{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:12px;margin:0 0 16px}
.dim{background:var(--papel);border:1px solid var(--borde);border-top:4px solid var(--gris);border-radius:12px;padding:12px 14px;box-shadow:var(--sombra);display:flex;flex-direction:column;gap:6px}
.dim--verde{border-top-color:var(--verde)}.dim--rojo{border-top-color:var(--rojo)}.dim--advertencia{border-top-color:var(--ambar)}
.dim__cabecera{display:flex;align-items:center;gap:8px}.dim__cifra{margin-left:auto;font-size:20px;font-weight:700}
.dim--rojo .dim__cifra{color:var(--rojo)}.dim--advertencia .dim__cifra{color:var(--ambar)}.dim--verde .dim__cifra{color:var(--verde)}
.dim__mide{margin:0;font-size:13px;color:var(--tenue)}
ul.dim__malos{margin:0;padding-left:18px;font-size:13px}
.dim__remedio{font-size:13px;padding:8px 10px;border-radius:8px;background:var(--fondo)}
.dim__acciones{display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap}
/* ── Pipeline del gate (como el de una forja): etapas en columnas, jobs con su caja de estado ── */
ol.pipeline{list-style:none;margin:12px 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr));gap:22px}
.etapa{position:relative;background:var(--fondo);border:1px solid var(--borde);border-top:4px solid var(--gris);border-radius:10px;padding:8px 10px}
.etapa--verde{border-top-color:var(--verde)}.etapa--rojo{border-top-color:var(--rojo)}.etapa--omitido{border-top-color:var(--gris)}
.etapa:not(:last-child)::after{content:"";position:absolute;top:20px;right:-22px;width:22px;height:2px;background:var(--borde)}
.etapa__cabecera{display:flex;align-items:center;gap:8px;padding:2px 0 8px;border-bottom:1px solid var(--borde);margin-bottom:6px}
.etapa__cabecera small{margin-left:auto;color:var(--tenue);font-size:11px;white-space:nowrap}
ul.etapa__jobs{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.job{position:relative;display:grid;grid-template-columns:22px 1fr auto;gap:8px;align-items:center;padding:4px 6px;border-radius:6px;color:inherit;text-decoration:none;font-size:13px;outline-offset:1px}
.job:hover,.job:focus-visible{background:var(--papel)}
.job--rojo{background:color-mix(in srgb,var(--rojo) 10%,transparent)}
.job__caja{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:5px;color:#fff;font-size:11px;font-weight:700;background:var(--gris);flex:none}
.job__caja--verde{background:var(--verde)}.job__caja--rojo{background:var(--rojo)}
.job__nombre{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.job__ms{color:var(--tenue);font-size:11px}
/* Tooltip propio (no el title nativo): aparece con hover Y con foco, y trae varias líneas. */
.tip{display:none;position:absolute;left:0;top:calc(100% + 6px);z-index:5;width:max-content;max-width:300px;background:var(--tinta);color:var(--papel);border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.45;box-shadow:0 6px 18px rgba(0,0,0,.25);white-space:normal}
.tip>*{display:block}.tip strong{margin-bottom:2px}.tip__porque{opacity:.85;margin-top:4px}.tip__pie{opacity:.7;margin-top:4px;font-family:ui-monospace,Consolas,monospace;font-size:11px}
.job:hover>.tip,.job:focus-visible>.tip,.job:focus>.tip{display:block}
.etapa:nth-last-child(-n+2) .tip{left:auto;right:0}.tip{max-width:min(300px,80vw)}
/* ── Botón de prompt ── */
button.prompt{font:inherit;font-size:12px;line-height:1.4;padding:2px 10px;border-radius:999px;border:1px solid var(--acento);background:transparent;color:var(--acento);cursor:pointer;white-space:nowrap}
button.prompt:hover,button.prompt:focus-visible{background:var(--acento);color:#fff}
button.prompt.prompt--copiado{background:var(--verde);border-color:var(--verde);color:#fff}
.accion__lado{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.aviso-flotante{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(20px);opacity:0;background:var(--tinta);color:var(--papel);padding:8px 16px;border-radius:999px;font-size:13px;transition:opacity .2s,transform .2s;z-index:20;pointer-events:none}
.aviso-flotante.visible{opacity:1;transform:translateX(-50%) translateY(0)}
.dialogo-prompt{border:1px solid var(--borde);border-radius:12px;background:var(--papel);color:var(--tinta);width:min(640px,92vw);padding:16px 20px}
.dialogo-prompt textarea{width:100%;font:13px/1.5 ui-monospace,Consolas,monospace;background:var(--fondo);color:var(--tinta);border:1px solid var(--borde);border-radius:8px;padding:8px}
.dialogo-prompt__botones{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
.dialogo-prompt__botones button{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid var(--borde);background:var(--fondo);color:var(--tinta);cursor:pointer}
.dialogo-prompt__botones [data-copiar]{background:var(--acento);border-color:var(--acento);color:#fff}
/* ── Pestañas internas (Código) ── */
.subpestanas__tira{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--borde);margin:6px 0 10px}
.subpestanas__tira button{font:inherit;font-size:14px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--tenue);padding:6px 12px;cursor:pointer}
.subpestanas__tira button.activo{color:var(--tinta);border-bottom-color:var(--acento);font-weight:600}
.tablero-columna h3,.deuda__cabecera,.problema__cabecera{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
/* En angosto la tira NO envuelve: seis carpetas en dos filas se ven rotas. Se desplaza a lo largo. */
@media (max-width:720px){:root{--margen:16px}.campo{grid-template-columns:1fr}
.hero{grid-template-columns:auto 1fr;padding:14px 16px;gap:12px}.hero__icono{width:40px;height:40px;font-size:20px}.hero__meta{grid-column:1/-1;min-width:0}.hero h2{font-size:18px}.titulo__derecha{margin-left:0}
.dos-columnas,.problemas,.graficas{grid-template-columns:1fr}.kpis{grid-template-columns:1fr 1fr}.kpi__valor{font-size:24px}
/* En el teléfono la cabecera NO es fija: con las pestañas en varias filas tapaba media pantalla. */
header{position:static}nav.pestanas button{padding:6px 9px;font-size:14px}.accion{grid-template-columns:24px 1fr}.accion__lado{grid-column:2;justify-content:flex-start}
.etapa:not(:last-child)::after{display:none}
.titulo .barra-de-busqueda{flex:1 1 100%}
header>.barra-superior{flex-wrap:wrap}.barra-de-busqueda{flex:1 1 100%;margin:0 0 8px}.barra-de-busqueda input{flex:1 1 auto}.columnas{grid-template-columns:1fr}.barra-de-busqueda input{min-width:0}.proyecto{flex-direction:column}nav.pestanas button{padding:8px 12px}
/* Una tabla no se achica por debajo de su contenido: sin esto desbordaba la PÁGINA entera
   (medido a 360: documento de 580 px) y el panel se desplazaba a lo ancho. Que se desplace ella. */
.bloque__cuerpo table{display:block;overflow-x:auto}}
/* «Qué hacer»: una frase de estado, dos columnas (tuyo | agente), grupos por lo que piden. */
.qh-estado{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--papel);border:1px solid var(--borde);border-left:4px solid var(--gris);border-radius:10px;padding:12px 16px;margin:16px 0}
.qh-estado--verde{border-left-color:var(--verde)}.qh-estado--rojo{border-left-color:var(--rojo)}.qh-estado--advertencia{border-left-color:var(--ambar)}
.qh-estado__icono{font-size:20px}.qh-estado__meta{margin-left:auto;font-size:13px}
.qh-aviso{background:var(--papel);border:1px dashed var(--ambar);border-radius:8px;padding:8px 12px}
.qh-columnas{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}
.qh-col{background:var(--papel);border:1px solid var(--borde);border-radius:12px;padding:16px 18px;box-shadow:var(--sombra)}
.qh-col--humano{border-top:4px solid var(--acento)}.qh-col--agente{border-top:4px solid var(--info)}
.qh-col h2{display:flex;align-items:center;gap:8px;margin:0 0 4px;font-size:19px}
.qh-col h2 small{font-weight:400;color:var(--tenue);font-size:14px}
.qh-col h2 .empuje{flex:1}
.qh-grupo{margin-top:18px}
.qh-grupo h3{margin:0;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--tenue);display:inline-flex;align-items:center;gap:8px}
.qh-grupo details>summary{cursor:pointer;list-style-position:inside}
.qh-grupo details>summary h3{display:inline-flex}
.qh-grupo--vacio .ok{margin:6px 0 0;font-size:14px}
.qh-cuenta{background:var(--fondo);border:1px solid var(--borde);border-radius:999px;padding:0 8px;font-size:12px;color:var(--tinta);letter-spacing:0}
.qh-ayuda{margin:4px 0 8px;color:var(--tenue);font-size:13px}
.qh-lista{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:8px}
.qh-tarjeta{border:1px solid var(--borde);border-radius:8px;padding:10px 12px;background:var(--papel)}
.qh-tarjeta:hover{border-color:var(--acento)}
.qh-tarjeta__titulo{font-weight:600;line-height:1.35}
.qh-tarjeta__titulo a{text-decoration:none}.qh-tarjeta__titulo a:hover{text-decoration:underline}
.qh-tarjeta__porque,.qh-espera{margin:4px 0 0;color:var(--tenue);font-size:13.5px}
.qh-tarjeta__accion{margin:6px 0 0;font-size:14px}
.qh-tarjeta__pie{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;font-size:12.5px}
.qh-mas{margin-top:8px}.qh-mas>summary{cursor:pointer;color:var(--acento);font-size:14px}
/* Una pestaña que junta secciones: cada sección de abajo arranca con un corte claro y su título. */
.fusion{margin-top:40px;padding-top:20px;border-top:2px solid var(--borde)}
.fusion__titulo{margin:0 0 12px;font-size:22px}
.qh-frente{margin-top:8px;border:1px solid var(--borde);border-radius:8px;padding:8px 12px;background:var(--fondo)}
.qh-frente>summary{cursor:pointer;display:flex;align-items:center;gap:8px;font-weight:600}
.qh-frente__nombre{flex:1;min-width:0}
.qh-frente[open]>summary{margin-bottom:4px}
@media (max-width:900px){.qh-columnas{grid-template-columns:1fr}.qh-estado__meta{margin-left:0;width:100%}}
`;


const JS = `
/* EN VIVO. Las fechas salen absolutas del generador (determinista) y acá se leen como «hace X».
   Servido por http (node scripts/panel/servir.mjs), la página mira latido.json y se recarga sola
   cuando el panel se regenera, conservando la pestaña (el hash) y la posición. Abierto como
   archivo no hay a quién preguntar: lo dice, en vez de fingir que está al día. */
(function(){
  function hace(iso){
    var s = Math.round((Date.now() - new Date(iso).getTime())/1000);
    if(!isFinite(s)) return null;
    if(s < 45) return 'hace un momento';
    if(s < 3600) return 'hace ' + Math.round(s/60) + ' min';
    if(s < 172800) return 'hace ' + Math.round(s/3600) + ' h';
    return 'hace ' + Math.round(s/86400) + ' días';
  }
  function refrescar(){
    Array.prototype.forEach.call(document.querySelectorAll('time[data-relativo]'), function(t){
      var r = hace(t.getAttribute('datetime')); if(r){ t.textContent = r; t.title = t.getAttribute('datetime').replace('T',' ').slice(0,16); }
    });
  }
  refrescar(); setInterval(refrescar, 15000);
  var vivo = document.getElementById('vivo'); if(!vivo) return;
  var texto = vivo.querySelector('.vivo__texto');
  var generado = document.body.getAttribute('data-generado');
  var firma = document.body.getAttribute('data-version') + '|' + generado;
  try { var y = sessionStorage.getItem('panel-scroll'); if(y){ sessionStorage.removeItem('panel-scroll'); window.scrollTo(0, Number(y)); } } catch(e){}
  if(location.protocol.indexOf('http') !== 0){
    if(texto && generado) texto.textContent = 'foto ' + (hace(generado) || '') + ' · sin sincronizar';
    vivo.title = 'Abierto como archivo: no se actualiza solo. Para verlo en vivo: node scripts/panel/servir.mjs';
    return;
  }
  vivo.classList.add('vivo--on');
  function pintar(){ if(texto) texto.textContent = 'en vivo · ' + (generado ? hace(generado) : 'sin capa en vivo'); }
  pintar(); setInterval(pintar, 15000);
  setInterval(function(){
    fetch('latido.json', {cache:'no-store'}).then(function(r){ return r.json(); }).then(function(l){
      vivo.classList.remove('vivo--caido');
      if(l.version + '|' + (l.generadoEn || '') !== firma){
        try { sessionStorage.setItem('panel-scroll', String(window.scrollY)); } catch(e){}
        location.reload();
      }
    }).catch(function(){ vivo.classList.add('vivo--caido'); if(texto) texto.textContent = 'sin conexión con el servidor del panel'; });
  }, 4000);
})();
/* El botón «Prompt»: copia la instrucción para el agente. Sin portapapeles (abierto como archivo,
   o el navegador lo niega) abre una ventana con el texto ya seleccionado: nunca falla en silencio. */
(function(){
  var aviso = null;
  function avisar(texto){
    if(!aviso){ aviso = document.createElement('div'); aviso.className = 'aviso-flotante'; aviso.setAttribute('role','status'); document.body.appendChild(aviso); }
    aviso.textContent = texto; aviso.classList.add('visible');
    clearTimeout(avisar.t); avisar.t = setTimeout(function(){ aviso.classList.remove('visible'); }, 2200);
  }
  function mostrar(texto){
    var d = document.getElementById('dialogo-prompt');
    if(!d){
      d = document.createElement('dialog'); d.id = 'dialogo-prompt'; d.className = 'dialogo-prompt';
      d.innerHTML = '<h3>Prompt para el agente</h3><p class="tenue">Copialo y pegalo en la sesión del agente del arnés.</p><textarea rows="12" aria-label="Prompt para el agente"></textarea><div class="dialogo-prompt__botones"><button type="button" data-copiar>Copiar</button><button type="button" data-cerrar>Cerrar</button></div>';
      document.body.appendChild(d);
      d.querySelector('[data-cerrar]').addEventListener('click', function(){ d.close(); });
      d.querySelector('[data-copiar]').addEventListener('click', function(){ var t = d.querySelector('textarea'); t.select(); try { document.execCommand('copy'); avisar('Prompt copiado'); } catch(e){} });
    }
    var area = d.querySelector('textarea'); area.value = texto;
    if(d.showModal) d.showModal(); else d.setAttribute('open','');
    area.focus(); area.select();
  }
  document.addEventListener('click', function(ev){
    var b = ev.target.closest && ev.target.closest('button.prompt[data-prompt]');
    if(!b) return;
    ev.preventDefault(); ev.stopPropagation();
    var texto = b.getAttribute('data-prompt');
    if(navigator.clipboard && window.isSecureContext){
      navigator.clipboard.writeText(texto).then(function(){ avisar('Prompt copiado: pegalo en la sesión del agente'); b.classList.add('prompt--copiado'); setTimeout(function(){ b.classList.remove('prompt--copiado'); }, 1500); }, function(){ mostrar(texto); });
    } else mostrar(texto);
  });
  /* Pestañas internas (Código): cada grupo maneja las suyas. */
  document.addEventListener('click', function(ev){
    var b = ev.target.closest && ev.target.closest('[data-subpestana]');
    if(!b) return;
    var grupo = b.closest('[data-subpestanas]');
    Array.prototype.forEach.call(grupo.querySelectorAll('[data-subpestana]'), function(o){ var suya = o===b; o.classList.toggle('activo', suya); o.setAttribute('aria-selected', suya ? 'true' : 'false'); });
    Array.prototype.forEach.call(grupo.querySelectorAll('.subpestana'), function(p){ p.hidden = p.id !== b.getAttribute('data-subpestana'); });
  });
})();
(function(){
  var pestanas = Array.prototype.slice.call(document.querySelectorAll('nav.pestanas button[data-pestana]'));
  var paneles = Array.prototype.slice.call(document.querySelectorAll('.pestana'));
  function activar(nombre){
    if(!document.getElementById('pestana-'+nombre)) nombre = pestanas[0].getAttribute('data-pestana');
    pestanas.forEach(function(b){
      var suya = b.getAttribute('data-pestana')===nombre;
      b.classList.toggle('activo', suya);
      // Una tira de pestañas tiene UN solo punto de tabulación: adentro se mueve con las flechas.
      b.setAttribute('aria-selected', suya ? 'true' : 'false');
      b.tabIndex = suya ? 0 : -1;
    });
    paneles.forEach(function(p){ p.classList.toggle('activa', p.id==='pestana-'+nombre); });
    if(history.replaceState) history.replaceState(null,'','#'+nombre);
  }
  pestanas.forEach(function(b){ b.addEventListener('click', function(){ activar(b.getAttribute('data-pestana')); }); });
  var SALTO = { ArrowLeft:-1, ArrowRight:1, Home:'primera', End:'ultima' };
  pestanas.forEach(function(b){
    b.addEventListener('keydown', function(ev){
      var salto = SALTO[ev.key];
      if(salto===undefined) return;
      ev.preventDefault();
      var i = pestanas.indexOf(b);
      var destino = salto==='primera' ? 0 : salto==='ultima' ? pestanas.length-1 : (i+salto+pestanas.length)%pestanas.length;
      activar(pestanas[destino].getAttribute('data-pestana'));
      pestanas[destino].focus();
    });
  });
  function irA(id){
    // El nombre de una pestaña abre la pestaña ARRIBA, no la sección que se llame igual: «#salud»
    // bajaba hasta la sección «salud» y se salteaba el «Qué hacer» (el salto que se veía al entrar).
    if(id && document.getElementById('pestana-'+id)){ activar(id); window.scrollTo(0,0); return true; }
    var destino = document.getElementById(id);
    if(!destino) return false;
    var panel = destino.closest('.pestana');
    if(panel) activar(panel.id.replace('pestana-',''));
    var d = destino; while(d){ if(d.tagName==='DETAILS') d.open = true; d = d.parentElement; }
    var dentro = destino.querySelector('details'); if(dentro) dentro.open = true;
    destino.scrollIntoView({block:'start'});
    return true;
  }
  var inicial = (location.hash||'').replace('#','');
  if(!irA(inicial)) activar(inicial || pestanas[0].getAttribute('data-pestana'));
  document.addEventListener('click', function(ev){
    var a = ev.target.closest && ev.target.closest('a[href^="#"]');
    if(!a) return;
    if(irA(a.getAttribute('href').slice(1))) ev.preventDefault();
  });

  var filtrosActivos = {};
  var etiquetasActivas = [];
  function aplicarFiltros(){
    var q = (document.getElementById('buscar').value||'').toLowerCase().trim();
    var visibles = 0, total = 0;
    Array.prototype.forEach.call(document.querySelectorAll('[data-buscar]'), function(el){
      total++;
      var oculto = q && el.textContent.toLowerCase().indexOf(q)===-1;
      Object.keys(filtrosActivos).forEach(function(grupo){
        var valor = filtrosActivos[grupo];
        var portador = el.hasAttribute('data-'+grupo) ? el : el.closest('[data-'+grupo+']');
        if(valor && portador && portador.getAttribute('data-'+grupo)!==valor) oculto = true;
      });
      // Las etiquetas se acumulan (Y, no O) y sólo mandan sobre lo que las lleva: una tabla sin
      // etiquetas no se vacía por filtrar los gotchas.
      if(etiquetasActivas.length){
        var conEtiquetas = el.hasAttribute('data-etiquetas') ? el : (el.closest && el.closest('[data-etiquetas]'));
        if(conEtiquetas){
          var marcas = conEtiquetas.getAttribute('data-etiquetas');
          for(var i=0;i<etiquetasActivas.length;i++) if(marcas.indexOf('|'+etiquetasActivas[i]+'|')===-1) oculto = true;
        }
      }
      el.hidden = !!oculto;
      if(!oculto) visibles++;
      if(q && !oculto){ var d = el; while(d){ if(d.tagName==='DETAILS') d.open = true; d = d.parentElement; } var dd = el.querySelector('details'); if(dd) dd.open = true; }
    });
    // El contador de la pestaña sigue a CUALQUIER filtro: con «48» arriba y diez tarjetas a la
    // vista, el número de la pestaña miente. Con una etiqueta activa se cuentan sólo las tarjetas
    // que LLEVAN etiquetas, que son las únicas sobre las que ese filtro manda.
    var conEtiqueta = etiquetasActivas.length > 0;
    var dicho = [];
    if(q) dicho.push('«'+q+'»');
    if(conEtiqueta) dicho.push(etiquetasActivas.join(' + '));
    var etq = document.querySelectorAll('[data-etiquetas]').length;
    var etqVis = document.querySelectorAll('[data-etiquetas]:not([hidden])').length;
    var cuenta = q ? visibles+' de '+total : etqVis+' de '+etq+' etiquetadas';
    document.getElementById('coincidencias').textContent = dicho.length ? cuenta+' · '+dicho.join(' · ') : '';
    paneles.forEach(function(p){
      var boton = document.querySelector('nav.pestanas button[data-pestana="'+p.id.replace('pestana-','')+'"]');
      var badge = boton.querySelector('small'); if(!badge) return;
      if(q) badge.textContent = p.querySelectorAll('[data-buscar]:not([hidden])').length;
      else if(conEtiqueta && p.querySelector('[data-etiquetas]')) badge.textContent = p.querySelectorAll('[data-etiquetas]:not([hidden])').length;
      else badge.textContent = badge.getAttribute('data-total');
    });
  }
  document.getElementById('buscar').addEventListener('input', aplicarFiltros);
  Array.prototype.forEach.call(document.querySelectorAll('.filtro[data-filtro-grupo]'), function(b){
    b.addEventListener('click', function(){
      var grupo = b.getAttribute('data-filtro-grupo');
      filtrosActivos[grupo] = b.getAttribute('data-filtro');
      Array.prototype.forEach.call(document.querySelectorAll('.filtro[data-filtro-grupo="'+grupo+'"]'), function(o){ o.classList.toggle('activo', o===b); });
      aplicarFiltros();
    });
  });
  document.addEventListener('click', function(ev){
    var b = ev.target.closest && ev.target.closest('[data-etiqueta]');
    if(!b) return;
    ev.preventDefault();  // el chip vive dentro de un <summary>: sin esto, filtrar también plegaba la tarjeta.
    var t = b.getAttribute('data-etiqueta');
    if(!t) etiquetasActivas = [];
    else { var i = etiquetasActivas.indexOf(t); if(i===-1) etiquetasActivas.push(t); else etiquetasActivas.splice(i,1); }
    Array.prototype.forEach.call(document.querySelectorAll('[data-etiqueta]'), function(o){
      var v = o.getAttribute('data-etiqueta');
      o.classList.toggle('activa', !!v && etiquetasActivas.indexOf(v)!==-1);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.etiqueta--limpiar'), function(o){ o.hidden = !etiquetasActivas.length; });
    aplicarFiltros();
  });
  Array.prototype.forEach.call(document.querySelectorAll('.etiqueta--limpiar'), function(o){ o.hidden = true; });

  Array.prototype.forEach.call(document.querySelectorAll('[data-plegar]'), function(b){
    b.addEventListener('click', function(){
      var raiz = document.querySelector(b.getAttribute('data-plegar'));
      var dets = raiz.querySelectorAll('.tarjeta details');
      var abrir = Array.prototype.some.call(dets, function(d){ return !d.open; });
      Array.prototype.forEach.call(dets, function(d){ d.open = abrir; });
    });
  });
  var todo = document.getElementById('plegar-todo');
  if(todo) todo.addEventListener('click', function(){
    var panel = document.querySelector('.pestana.activa');
    var dets = panel.querySelectorAll('details');
    var abrir = Array.prototype.some.call(dets, function(d){ return !d.open; });
    Array.prototype.forEach.call(dets, function(d){ d.open = abrir; });
  });
})();
`;


/** Página completa. `rutaRaiz` es la ruta relativa desde el HTML hasta la raíz del repo (para los enlaces). */
export function renderizarHtml(modelo, opciones = {}) {
  const rutaRaiz = (opciones.rutaRaiz ?? ".").replace(/\/+$/, "");
  const v = modelo.enVivo ?? null;
  const alarmas = alarmasDe(modelo);
  // El plan del repo es memoria; el del gestor, capa en vivo. Se muestra el que haya.
  const planVisible = v?.plan ?? modelo.plan;

  // El RESUMEN va primero: lo primero que el panel tiene que decir es cómo estamos y qué hace cada
  // uno. La salud del arnés (si los frenos muerden) sigue segunda: es para quien mantiene el arnés.
  const resumen = construirResumen(modelo);
  const kpisPorPestana = indicadores(modelo);
  // El número de cada pestaña es lo que hay PARA HACER en ella (su «Qué hacer»), no cuántas piezas
  // muestra: «Gotchas 82» o «Reglas 39» se leían como alarmas y no pedían nada.
  const acciones = accionesPorPestana(modelo);
  // «Qué hacer» abre el panel: lo primero que alguien busca es qué le toca. Su número es lo que
  // espera a la PERSONA (decidir + hacer), no todo lo que hay.
  const bandeja = construirBandeja(modelo);
  const secciones = [
    { id: "que-hacer", nombre: "Qué hacer", total: bandeja.total.humano, html: pestanaQueHacer(modelo) },
    { id: "resumen", nombre: "Resumen", html: pestanaResumen(modelo) },
    { id: "ahora", nombre: "Ahora", acciones: acciones.ahora, vacio: "Nada en rojo y nada pendiente en esta máquina.", html: v ? pestanaAhora(v, modelo, rutaRaiz) : '<p class="vacio">Sin capa en vivo: generar el panel sin <code>--sin-vivo</code>.</p>' },
    { id: "estado", nombre: "Estado", acciones: acciones.estado, vacio: "Sin deuda abierta.", html: pestanaEstado(modelo, rutaRaiz) },
    { id: "salud", nombre: "Salud", previo: tableroDeSalud(modelo).previo, acciones: acciones.salud, vacio: "Cada freno y sensor del arnés está vivo.", html: pestanaSalud(modelo, rutaRaiz) },
    { id: "gotchas", nombre: "Gotchas", acciones: acciones.gotchas, vacio: "Cada incidente tiene su freno ejecutable.", html: pestanaGotchas(modelo, rutaRaiz) },
    { id: "plan", nombre: "Plan", acciones: acciones.plan, vacio: "El plan no tiene pendientes.", html: pestanaPlan(planVisible) },
    { id: "memoria", nombre: "Memoria", acciones: acciones.memoria, vacio: "La memoria apunta a cosas que existen y entra en el presupuesto.", html: pestanaMemoria(modelo, rutaRaiz) },
    { id: "reglas", nombre: "Reglas", acciones: acciones.reglas, vacio: "Cada principio BLOCKING declara su mecanismo.", html: pestanaReglas(modelo, rutaRaiz) },
    { id: "fuentes", nombre: "Fuentes", acciones: acciones.fuentes, vacio: "Todas las fuentes se leyeron.", html: pestanaFuentes(modelo, rutaRaiz) },
  ];
  // CINCO pestañas, no diez (2026-11-10: «combiná esto», tras «me pierdo en ese panel»). Cada una
  // junta secciones que contestan lo mismo; la primera abre sin título y las demás debajo, cada
  // una con el `id` de su pestaña vieja, así `#ahora` o `#gotchas` siguen abriendo donde están.
  // El número de la pestaña: en «Qué hacer», lo que espera a la PERSONA; en las demás, la suma de
  // las acciones de sus secciones.
  const porId = new Map(secciones.map((s) => [s.id, s]));
  const pestanas = [
    { id: "que-hacer", nombre: "Qué hacer", partes: ["que-hacer", "plan"] },
    { id: "resumen", nombre: "Resumen", partes: ["resumen", "ahora"] },
    { id: "salud", nombre: "Salud", partes: ["salud", "estado", "gotchas"] },
    { id: "memoria", nombre: "Memoria", partes: ["memoria", "fuentes"] },
    { id: "reglas", nombre: "Reglas", partes: ["reglas"] },
  ].map((p) => {
    const partes = p.partes.map((id) => porId.get(id));
    const total = partes[0].total ?? partes.reduce((n, s) => n + (s.acciones?.length ?? 0), 0);
    return { ...p, partes, total };
  });

  const aviso = alarmas.length
    ? `<div class="veredicto veredicto--rojo" style="margin-top:10px">${punto("rojo")} <strong>${alarmas.length}</strong> alarma(s) del arnés — ver <a href="#salud">Salud</a>.</div>`
    : "";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,">
<title>Panel del arnés · ${escapar(modelo.proyecto?.nombre || "")}</title>
<style>${CSS}</style>
</head>
<body data-version="${escapar(modelo.version)}" data-generado="${escapar(v?.generadoEn ?? "")}">
<header>
  <div class="titulo">
    <h1>Panel del arnés <span class="titulo__proyecto">${escapar(modelo.proyecto?.nombre || "")}</span></h1>
    <a class="pastilla pastilla--${resumen.estado.tono}" href="#resumen" title="${escapar(resumen.estado.detalle)}"><span aria-hidden="true">${ICONO_TONO[resumen.estado.tono] ?? "·"}</span> ${escapar(resumen.estado.titular)}</a>
    <span class="titulo__derecha">
      <span class="responsable">${
        resumen.responsable
          ? `Informe de <strong title="${escapar(resumen.responsable.identidad)} · ${escapar(resumen.responsable.fuente)}">${escapar(resumen.responsable.nombre)}</strong>`
          : v
            ? `<span class="chip chip--atencion">sin responsable declarado</span>`
            : "Informe de la memoria del repo"
      }${v ? ` <span class="tenue">· ${escapar(v.maquina)}</span>` : ""}</span>
      <span id="vivo" class="vivo" title="${v ? "Generado al " + fecha(v.generadoEn) : "sin capa en vivo"}"><span class="vivo__punto" aria-hidden="true"></span><span class="vivo__texto">${v ? `foto del ${fecha(v.generadoEn)}` : "sólo memoria"}</span></span>
      <span class="barra-de-busqueda">
        <span id="coincidencias" class="coincidencias"></span>
        <input id="buscar" type="search" placeholder="Buscar…" aria-label="Buscar en el panel">
        <button id="plegar-todo" class="filtro filtro--accion" title="plegar o desplegar todas las secciones de la pestaña">⇕</button>
      </span>
    </span>
  </div>
  <div class="barra-superior">
  <nav class="pestanas" role="tablist" aria-label="Secciones del panel">
    ${pestanas
      .map(
        (p, i) =>
          `<button role="tab" id="tab-${p.id}" data-pestana="${p.id}" aria-controls="pestana-${p.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" class="${
            i === 0 ? "activo" : ""
          }">${p.nombre} <small class="insignia ${p.total ? "insignia--hay" : "insignia--cero"}" data-total="${p.total}" title="${p.total ? `${p.total} cosa(s) por hacer` : "nada por hacer"}">${p.total}</small></button>`,
      )
      .join("")}
  </nav>
  </div>
  ${aviso}
</header>
<main>
  ${pestanas
    .map((p, i) => {
      // UN solo «Qué hacer» por pestaña, ARRIBA, con los ítems de todas sus secciones a la vista:
      // el número de la pestaña es su largo, y lo que se ve tiene que coincidir con el número. Cada
      // sección tenía su propio bloque, así que la pestaña decía «2» y los dos ítems estaban al
      // fondo, dentro de «Ahora» (2026-11-10). Con varias secciones, cada ítem dice de cuál viene.
      // Una pestaña cuya primera sección trae su PROPIO número («Qué hacer»: la bandeja) no junta
      // bloques: su número no es la suma de acciones, y el Plan iría a parar encima de la bandeja.
      const propio = p.partes[0].total !== undefined;
      const conAcciones = propio ? [] : p.partes.filter((s) => s.acciones);
      const varias = conAcciones.length > 1 || (conAcciones.length === 1 && conAcciones[0] !== p.partes[0]);
      const acciones = conAcciones.flatMap((s) => s.acciones.map((a) => (varias ? { ...a, seccion: s.nombre } : a)));
      const queHacer = conAcciones.length ? bloqueQueHacer(acciones, { vacio: conAcciones.map((s) => s.vacio).filter(Boolean).join(" "), vista: p.nombre }) : "";
      const cuerpo = p.partes
        .map((s, j) => {
          const kpis = (kpisPorPestana[s.id] ?? []).filter(Boolean).join("");
          // La primera sección puede abrir con su estado (`previo`, como Salud): el bloque va después.
          const suyo = propio && s.acciones ? bloqueQueHacer(s.acciones, { vacio: s.vacio, vista: s.nombre }) : "";
          const contenido = `${s.previo ?? ""}${j === 0 ? queHacer : ""}${suyo}${kpis ? `<div class="indicadores">${kpis}</div>` : ""}${s.html}`;
          return j === 0 ? contenido : `<section class="fusion" id="${s.id}" aria-labelledby="fusion-${s.id}"><h2 class="fusion__titulo" id="fusion-${s.id}">${escapar(s.nombre)}</h2>${contenido}</section>`;
        })
        .join("");
      return `<div class="pestana ${i === 0 ? "activa" : ""}" id="pestana-${p.id}" role="tabpanel" aria-labelledby="tab-${p.id}" tabindex="0">${cuerpo}</div>`;
    })
    .join("\n")}
  <footer class="pie">versión <code>${escapar(modelo.version)}</code> · memoria de ${modelo.fuentes.length} archivos · ${v ? `capa en vivo de ${escapar(v.maquina)}` : "sólo memoria"} · en vivo: <code>node scripts/panel/servir.mjs</code></footer>
</main>
<script>${JS}</script>
</body>
</html>
`;
}
