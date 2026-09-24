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

const chip = (texto, clase = "") => `<span class="chip ${clase}">${texto}</span>`;

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
    { abierta: true, extra: `<small>${t.piezas}</small>`, resumen: `${t.guia} guías · ${t.freno} frenos · ${t.sensor} sensores` },
  );
}

const TONO_ACTIVADOR = { activo: "verde", "instalado y muerto": "rojo", "no instalado": "neutro" };

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
    tarjetaProyecto(m, rutaRaiz),
    seccion("salud", "Salud del arnés", cabecera, { abierta: true, resumen: alarmas.length ? `${alarmas.length} alarma(s)` : "sin alarmas" }),
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

  const deuda = e.deuda.grupos
    .map((g) => detalles(`${punto(g.tono)} ${inline(g.titulo, rutaRaiz)} <small>${g.items.length}</small>`, listaVinetas(g.items, rutaRaiz), g.tono === "advertencia", 'class="grupo"'))
    .join("");

  const verdes = e.senales.filter((s) => s.tono === "verde").length;
  return [
    `<p class="nota">Esta pestaña es PROSA verificada: lo que <a href="${escapar(`${rutaRaiz}/${archivo}`)}"><code>${escapar(archivo)}</code></a> afirma, con su fecha. Lo que corrió en esta máquina está en «Ahora».</p>`,
    seccion("veredicto", "Estado verificado", veredicto, { abierta: true }),
    e.abiertos.items.length ? seccion("abierto", inline(e.abiertos.titulo, rutaRaiz), listaVinetas(e.abiertos.items, rutaRaiz), { extra: `<small>${e.abiertos.items.length}</small>`, abierta: true }) : "",
    seccion("senales", "Señales (según la prosa)", senales, { extra: `<small>${e.senales.length}</small>`, resumen: `${verdes} verdes de ${e.senales.length}` }),
    e.bloqueos.length ? seccion("bloqueos", "Bloqueos", listaVinetas(e.bloqueos, rutaRaiz), { extra: `<small>${e.bloqueos.length}</small>`, abierta: true }) : "",
    seccion("deuda", "Deuda conocida", `${e.deuda.intro ? `<div class="nota">${parrafos(e.deuda.intro, rutaRaiz)}</div>` : ""}${deuda || '<p class="vacio">— nada declarado —</p>'}`, {
      resumen: e.deuda.grupos.map((g) => `${g.items.length} ${g.titulo.toLowerCase()}`).join(" · "),
    }),
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
  if (!m.rutas.incidents) return seccion("gotchas", "Gotchas", '<p class="vacio">El config no declara <code>incidents.file</code>: el repo no tiene registro de incidentes que leer.</p>', { abierta: true });
  const ejecutables = gotchas.filter((g) => g.ejecutable).length;
  const filtros = `<div class="filtros" data-filtros="gotchas">
    <button class="filtro activo" data-filtro-grupo="gotchas" data-filtro="">todos <small>${gotchas.length}</small></button>
    <button class="filtro" data-filtro-grupo="gotchas" data-filtro="ejecutable">con freno ejecutable <small>${ejecutables}</small></button>
    <button class="filtro" data-filtro-grupo="gotchas" data-filtro="sin-freno">sin freno ejecutable <small>${gotchas.length - ejecutables}</small></button>
    <button class="filtro filtro--accion" data-plegar="#pestana-gotchas">plegar / desplegar todo</button>
  </div>`;
  return seccion(
    "gotchas",
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
    ? detalles(
        `Diff contra HEAD ${r.diffTruncado ? chip(`recortado: faltan ${r.diffTruncado} líneas`, "chip--gris") : ""}`,
        `<pre class="diff">${r.diff
          .split("\n")
          .map((l) => `<span class="${l.startsWith("+") ? "d-mas" : l.startsWith("-") ? "d-menos" : l.startsWith("@@") ? "d-hunk" : /^(diff|index) /.test(l) ? "d-meta" : ""}">${escapar(l)}</span>`)
          .join("\n")}</pre>`,
      )
    : "";
  return `<article class="tarjeta repo" data-buscar>${detalles(
    `${punto(r.limpio ? "verde" : "advertencia")} <code>${escapar(r.nombre)}</code> <code>${escapar(r.rama ?? "?")}</code> ${r.limpio ? chip("árbol limpio", "chip--ok") : chip(`${r.cambios.length} archivo(s) cambiados`, "chip--mal")} ${r.rol ? chip(escapar(r.rol), "chip--gris") : ""}`,
    `<p>${posicion}</p>${grupos ? `<p><span class="tenue">Cambios por carpeta:</span> ${grupos}</p>` : ""}${r.cambios.length ? cambios : ""}${diff}${detalles(`Últimos commits <small>${r.ultimosCommits.length}</small>`, commits)}`,
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
  const verdes = nombres.filter((n) => reg?.senales?.[n]?.estado === "verde").length;
  return seccion(
    "registro",
    "Última corrida del gate (esta máquina)",
    `${cab}${tabla(["Señal", "Última corrida", "Último verde", "Script"], filas, "verificacion")}
     <p class="nota">Sale de <code>${escapar(v.gate.rutaRegistro)}</code>, que el gate escribe en cada corrida: es de ESTA máquina y no se versiona. El veredicto en prosa, con su fecha, está en «Estado»: las dos cosas son distintas a propósito.</p>`,
    { abierta: true, extra: `<small>${verdes}/${nombres.length}</small>`, resumen: reg ? `${reg.veredicto} · ${fecha(reg.fecha)}` : "sin registro" },
  );
}

function seccionGestor(v, m, rutaRaiz) {
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
    seccion("gate-vivo", "Gate de esta sesión", gate, { abierta: v.gate.pendiente, resumen: v.gate.pendiente ? "pendiente" : "al día" }),
    seccionRegistro(v, m, rutaRaiz),
    v.repos.length
      ? seccion("repos", "Código", v.repos.map(tarjetaRepo).join(""), { abierta: true, extra: `<small>${v.repos.length}</small>`, resumen: sucios.length ? `${sucios.length} con cambios: ${sucios.map((r) => r.nombre).join(", ")}` : "todo limpio" })
      : "",
    sondas ? seccion("sondas", "Servicios locales", sondas, { abierta: true, extra: `<small>${v.sondas.length}</small>`, resumen: `${v.sondas.filter((s) => s.viva).length}/${v.sondas.length} responden` }) : "",
    seccionGestor(v, m, rutaRaiz),
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
      "plan",
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
    "plan",
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

// ── Fuentes ─────────────────────────────────────────────────────────────────

function pestanaFuentes(m, rutaRaiz) {
  return seccion(
    "fuentes",
    "Fuentes y regeneración",
    `<p class="nota">La memoria del panel se DERIVA de los archivos de abajo, sin ningún modelo de lenguaje ni red: leerlo es leerlos. Se regenera con <code>${escapar(m.comando)}</code> y en cada corrida del gate. Su versión es el hash del modelo: si cambia algo que el panel muestra, cambia la versión. La pestaña «Ahora» es aparte: lee git, el registro del gate, las sondas y el gestor, y por eso lleva hora.</p>
     ${tabla(["Archivo", "Hash", "Líneas"], m.fuentes.map((f) => [`<a href="${escapar(`${rutaRaiz}/${f.ruta}`)}"><code>${escapar(f.ruta)}</code></a>`, `<code>${escapar(f.hash)}</code>`, String(f.lineas)]))}
     ${m.faltantes?.length ? `<h3>Fuentes que no están <small>${m.faltantes.length}</small></h3><p class="nota">El config las nombra (o son el default) y no existen en este repo. No es una alarma: el panel sale igual, sin esa parte.</p><ul class="vinetas">${m.faltantes.map((f) => `<li data-buscar><code>${escapar(f)}</code></li>`).join("")}</ul>` : ""}
     ${m.advertencias.length ? `<h3>Advertencias de las fuentes <small>${m.advertencias.length}</small></h3><ul class="vinetas advertencias">${m.advertencias.map((a) => `<li data-buscar>${escapar(a.que)} <span class="tenue">— <code>${escapar(a.comando)}</code></span></li>`).join("")}</ul>` : '<p class="ok">Las fuentes están bien formadas y todo puntero verificable existe.</p>'}`,
    { abierta: true },
  );
}

// ── Indicadores de cabecera ─────────────────────────────────────────────────

function indicadores(m) {
  const e = m.estado;
  const v = m.enVivo ?? null;
  const alarmas = alarmasDe(m);
  const principios = m.reglas.constituciones.flatMap((c) => c.principios);
  const sinFreno = m.gotchas.filter((g) => !g.ejecutable).length;
  const reg = v?.gate.registro ?? null;
  const salida = [
    indicador(String(alarmas.length), "alarmas del arnés", { tono: alarmas.length ? "rojo" : "verde", href: "#salud", detalle: alarmas.length ? "ver Salud" : "todo vivo" }),
    v
      ? indicador(reg ? escapar(reg.veredicto) : "sin dato", "último gate (esta máquina)", { tono: reg ? (reg.veredicto === "verde" ? "verde" : reg.veredicto === "rojo" ? "rojo" : "info") : "advertencia", href: "#registro", detalle: reg ? fecha(reg.fecha) : "nunca corrió acá" })
      : "",
    indicador(TONO_ETIQUETA[e.veredicto?.tono] ?? "?", "veredicto en prosa", { tono: e.veredicto?.tono ?? "neutro", href: "#veredicto", detalle: escapar(e.fechaGate ?? m.rutas.status) }),
    v ? indicador(v.gate.pendiente ? "pendiente" : "al día", "gate de la sesión", { tono: v.gate.pendiente ? "advertencia" : "verde", href: "#gate-vivo", detalle: v.gate.pendiente ? "código editado sin gate" : "nada sin verificar" }) : "",
    m.arnes?.mapa ? indicador(String(m.arnes.mapa.totales.piezas), "piezas del arnés", { href: "#mapa", detalle: `${m.arnes.mapa.huecos.length} etapa(s) sin control` }) : "",
    (() => {
      const plan = v?.plan ?? m.plan;
      return plan?.estado === "ok"
        ? indicador(`${plan.resumen.pct}%`, "plan hecho", { tono: plan.resumen.pct === 100 ? "verde" : "info", href: "#plan", detalle: `${plan.resumen.hechas}/${plan.resumen.total} · ${plan.resumen.pendientes} pendientes` })
        : indicador("omitido", "plan", { tono: "omitido", href: "#plan", detalle: "sin fuente del plan" });
    })(),
    indicador(String(m.reglas.gate.signals.length), "señales del gate", { href: "#gate", detalle: `${m.reglas.hooks.length} hooks` }),
    indicador(String(m.gotchas.length), "gotchas pagados", { tono: sinFreno ? "advertencia" : "verde", href: "#gotchas", detalle: `${sinFreno} sin freno ejecutable` }),
    indicador(String(principios.length), "principios", { href: "#constituciones", detalle: `${principios.filter((p) => p.fuerza === "BLOCKING").length} BLOCKING · ${principios.filter((p) => p.fuerza === "REVIEW").length} REVIEW` }),
  ];
  if (v) {
    const raiz = v.repos.find((r) => !r.ausente);
    if (raiz) salida.push(indicador(String(raiz.cambios.length), "archivos cambiados", { tono: raiz.limpio ? "verde" : "advertencia", href: "#repos", detalle: `rama ${escapar(raiz.rama ?? "?")}` }));
    if (v.tokens) salida.push(indicador(abreviar(v.tokens.hoy.salida), "tokens de salida hoy", { tono: "info", href: "#tokens", detalle: `${abreviar(v.tokens.total.salida)} en ${v.tokens.dias} días` }));
  }
  return salida.join("");
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
[hidden]{display:none!important}
/* En angosto la tira NO envuelve: seis carpetas en dos filas se ven rotas. Se desplaza a lo largo. */
@media (max-width:720px){:root{--margen:14px}.campo{grid-template-columns:1fr}
header>.barra-superior{flex-wrap:wrap}.barra-de-busqueda{flex:1 1 100%;margin:0 0 8px}.barra-de-busqueda input{flex:1 1 auto}.columnas{grid-template-columns:1fr}.barra-de-busqueda input{min-width:0}.proyecto{flex-direction:column}nav.pestanas button{padding:8px 12px}
/* Una tabla no se achica por debajo de su contenido: sin esto desbordaba la PÁGINA entera
   (medido a 360: documento de 580 px) y el panel se desplazaba a lo ancho. Que se desplace ella. */
.bloque__cuerpo table{display:block;overflow-x:auto}}
`;


const JS = `
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
  const e = modelo.estado;
  const v = modelo.enVivo ?? null;
  const alarmas = alarmasDe(modelo);
  const totalPrincipios = modelo.reglas.constituciones.reduce((n, c) => n + c.principios.length, 0);
  // El plan del repo es memoria; el del gestor, capa en vivo. Se muestra el que haya.
  const planVisible = v?.plan ?? modelo.plan;

  // La SALUD va primero: el panel es del arnés, y lo primero que tiene que decir es si está vivo.
  const pestanas = [
    { id: "salud", nombre: "Salud", total: alarmas.length, html: pestanaSalud(modelo, rutaRaiz) },
    v ? { id: "ahora", nombre: "Ahora", total: v.repos.length + v.sondas.length, html: pestanaAhora(v, modelo, rutaRaiz) } : null,
    { id: "plan", nombre: "Plan", total: planVisible?.resumen?.pendientes ?? 0, html: pestanaPlan(planVisible) },
    { id: "estado", nombre: "Estado", total: e.senales.length + e.abiertos.items.length + e.bloqueos.length, html: pestanaEstado(modelo, rutaRaiz) },
    { id: "gotchas", nombre: "Gotchas", total: modelo.gotchas.length, html: pestanaGotchas(modelo, rutaRaiz) },
    { id: "reglas", nombre: "Reglas", total: totalPrincipios + modelo.reglas.gate.signals.length, html: pestanaReglas(modelo, rutaRaiz) },
    { id: "fuentes", nombre: "Fuentes", total: modelo.fuentes.length, html: pestanaFuentes(modelo, rutaRaiz) },
  ].filter(Boolean);

  const reg = v?.gate.registro ?? null;
  const aviso = alarmas.length
    ? `<div class="veredicto veredicto--rojo" style="margin-top:10px">${punto("rojo")} <strong>${alarmas.length}</strong> alarma(s) del arnés — ver <a href="#salud">Salud</a>.</div>`
    : "";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel del arnés · ${escapar(modelo.proyecto?.nombre || "")}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <div class="titulo">
    <h1>Panel del arnés</h1>
    <span>${punto(alarmas.length ? "rojo" : "verde")} salud <strong>${alarmas.length ? `${alarmas.length} alarma(s)` : "sin alarmas"}</strong></span>
    ${reg ? `<span>${punto(TONO_CORRIDA[reg.veredicto] ?? (reg.veredicto === "fast-verde" ? "info" : "neutro"))} gate <strong>${escapar(reg.veredicto)}</strong> · ${fecha(reg.fecha)}</span>` : e.veredicto ? `<span>${punto(e.veredicto.tono)} gate (prosa) <strong>${escapar(TONO_ETIQUETA[e.veredicto.tono] ?? e.veredicto.tono)}</strong> · ${escapar(e.fechaGate ?? "")}</span>` : ""}
    ${v ? `<span>${punto(v.gate.pendiente ? "advertencia" : "verde")} sesión <strong>${v.gate.pendiente ? "gate pendiente" : "al día"}</strong></span>` : ""}
    <span class="meta">${escapar(modelo.proyecto?.nombre || "")} · versión <code>${escapar(modelo.version)}</code> · memoria de ${modelo.fuentes.length} archivos${v ? ` · en vivo al ${fecha(v.generadoEn)}` : " · sólo memoria"}</span>
  </div>
  <div class="barra-superior">
  <nav class="pestanas" role="tablist" aria-label="Secciones del panel">
    ${pestanas
      .map(
        (p, i) =>
          `<button role="tab" id="tab-${p.id}" data-pestana="${p.id}" aria-controls="pestana-${p.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" class="${
            i === 0 ? "activo" : ""
          }">${p.nombre} <small data-total="${p.total}">${p.total}</small></button>`,
      )
      .join("")}
  </nav>
    <div class="barra-de-busqueda">
      <span id="coincidencias" class="coincidencias"></span>
      <input id="buscar" type="search" placeholder="Buscar en salud, estado, gotchas y reglas…" aria-label="Buscar">
      <button id="plegar-todo" class="filtro filtro--accion" title="plegar o desplegar todas las secciones de la pestaña">⇕ todo</button>
    </div>
  </div>
  ${aviso}
</header>
<main>
  <div class="indicadores">${indicadores(modelo)}</div>
  ${pestanas
    .map((p, i) => `<div class="pestana ${i === 0 ? "activa" : ""}" id="pestana-${p.id}" role="tabpanel" aria-labelledby="tab-${p.id}" tabindex="0">${p.html}</div>`)
    .join("\n")}
</main>
<script>${JS}</script>
</body>
</html>
`;
}
