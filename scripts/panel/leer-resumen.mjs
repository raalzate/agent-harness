/**
 * El RESUMEN del panel: la lectura ejecutiva que contesta, en este orden, «¿de quién es este
 * informe?», «¿cómo estamos?», «¿qué está fallando y por qué?» y «¿qué tiene que hacer cada uno?».
 *
 * Existe porque el panel tenía todos los datos y ninguna conclusión: once indicadores sueltos
 * arriba de cada pestaña, un mapa de 68 piezas como portada y ninguna frase que dijera el estado.
 * Quien lo abría tenía que armar el diagnóstico a mano. Acá se arma UNA vez, con reglas explícitas
 * y sin opinión: cada problema y cada pendiente nombra el dato del que sale.
 *
 * Dos mitades:
 *   - lectores de la capa EN VIVO (responsable, doctor, foco, historial del gate): cosas de esta
 *     máquina y de esta persona, que el repo declara en `panel.owner|doctor|focus` sin que este
 *     script sepa nada del proyecto;
 *   - `construirResumen(modelo)`: puro. Mismos datos, mismo resumen; sin `enVivo` sale sólo lo
 *     que la memoria sabe, para que el panel «sin vivo» siga siendo reproducible byte a byte.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const leerJson = (ruta) => {
  try {
    return JSON.parse(readFileSync(ruta, "utf8"));
  } catch {
    return null;
  }
};

// ── responsable ─────────────────────────────────────────────────────────────

/** `KEY=valor` de un `.env`, sin exportar nada al proceso: el panel lee, no configura. */
export function leerEnvArchivo(ruta) {
  const out = {};
  try {
    for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(linea);
      if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {
    /* sin archivo: no hay nada que leer */
  }
  return out;
}

/** «ana.perez@x.com» → «Ana Perez». Un correo no es un nombre, pero es mejor que un correo. */
export function nombreDeIdentidad(id) {
  const local = String(id ?? "").split("@")[0];
  if (!local || !String(id).includes("@")) return String(id ?? "");
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

/**
 * De quién es el informe. El panel describe UNA máquina y UNA persona: sin nombre, quien lo recibe
 * no sabe si mira su estado o el de otro. Orden: variables declaradas (entorno, luego el `.env`
 * declarado), después la identidad de git. Nunca se inventa: sin dato, `null` y el panel lo pide.
 */
export function leerResponsable(raiz, spec, { env = process.env, git = null } = {}) {
  const archivo = spec.envFile ? leerEnvArchivo(path.resolve(raiz, spec.envFile)) : {};
  for (const clave of spec.env) {
    const valor = env[clave] || archivo[clave];
    if (valor) return { identidad: valor, nombre: nombreDeIdentidad(valor), fuente: env[clave] ? `$${clave}` : `${clave} en ${spec.envFile}` };
  }
  if (git) {
    const nombre = git(raiz, ["config", "user.name"]).trim();
    const correo = git(raiz, ["config", "user.email"]).trim();
    if (nombre || correo) return { identidad: correo || nombre, nombre: nombre || nombreDeIdentidad(correo), fuente: "git config" };
  }
  return null;
}

// ── doctor (configuración de la máquina) ────────────────────────────────────

/**
 * La salida del doctor del repo → secciones con sus chequeos. Formato que entiende (el de
 * comando declarado en `panel.doctor.command`): una sección por línea `N. Título` y un chequeo
 * por línea `✔|⚠|✘ texto`, con el arreglo opcional en la línea siguiente `→ comando`.
 */
export function parsearDoctor(texto) {
  const secciones = [];
  let actual = null;
  let ultimo = null;
  for (const cruda of String(texto ?? "").split(/\r?\n/)) {
    const linea = cruda.trim();
    const sec = /^(\d+)\.\s+(.+)$/.exec(linea);
    if (sec) {
      actual = { titulo: sec[2], chequeos: [] };
      secciones.push(actual);
      ultimo = null;
      continue;
    }
    const ch = /^([✔✘⚠])\s+(.+)$/.exec(linea);
    if (ch && actual) {
      ultimo = { tono: ch[1] === "✔" ? "verde" : ch[1] === "✘" ? "rojo" : "advertencia", texto: ch[2], arreglo: null };
      actual.chequeos.push(ultimo);
      continue;
    }
    const fix = /^→\s+(.+)$/.exec(linea);
    if (fix && ultimo) ultimo.arreglo = fix[1];
  }
  const todos = secciones.flatMap((s) => s.chequeos);
  return {
    secciones,
    ok: todos.filter((c) => c.tono === "verde").length,
    avisos: todos.filter((c) => c.tono === "advertencia").length,
    bloqueantes: todos.filter((c) => c.tono === "rojo").length,
  };
}

export function leerDoctor(raiz, spec, ejecutar) {
  if (!spec) return null;
  const r = ejecutar(raiz, spec.command, spec.timeoutMs);
  const datos = parsearDoctor(r.stdout);
  if (!datos.secciones.length) return { ok: false, comando: spec.command.join(" "), error: (r.stderr || r.stdout || `salió con ${r.status}`).trim().split("\n").slice(0, 2).join(" · ") };
  return { ok: true, comando: spec.command.join(" "), destacar: spec.highlight ?? null, ...datos };
}

// ── foco (objetivo del gestor, con tareas del humano y del agente) ──────────

/**
 * El foco como lo deja el gestor del repo: `{ id, title, state, url, assignedTo, leidoEn,
 * plan: { resumen, tareas[{ id, title, state, dueno, cerrada, bloqueada, url }], propuestas[{ quien, texto }] } }`.
 * Se lee tal cual; si el archivo no tiene esa forma, no hay foco.
 */
export function leerFoco(raiz, spec) {
  if (!spec) return null;
  const f = leerJson(path.resolve(raiz, spec.file));
  if (!f || f.id == null) return existsSync(path.resolve(raiz, spec.file)) ? { error: `${spec.file} no tiene la forma esperada` } : null;
  const plan = f.plan ?? {};
  return {
    id: f.id,
    titulo: f.title ?? "",
    estado: f.state ?? "",
    url: f.url ?? null,
    asignado: f.assignedTo ?? null,
    leidoEn: f.leidoEn ?? null,
    resumen: plan.resumen ?? null,
    tareas: (plan.tareas ?? []).map((t) => ({ id: t.id, titulo: t.title ?? "", estado: t.state ?? "", dueno: t.dueno ?? null, cerrada: Boolean(t.cerrada), bloqueada: Boolean(t.bloqueada), url: t.url ?? null })),
    propuestas: (plan.propuestas ?? []).filter((p) => p?.texto).map((p) => ({ quien: p.quien === "agente" ? "agente" : "humano", texto: String(p.texto) })),
  };
}

// ── bandeja (qué le toca a cada uno, leído del gestor) ──────────────────────

/**
 * El caché de la bandeja que deja el gestor (`{ leidoEn, items[], prs[] }`). Si envejeció más de
 * `maxAgeMinutes`, lanza el comando que lo refresca DESPRENDIDO —el panel no espera a la red— y
 * muestra el que hay, con su hora. Sin caché todavía, lo dice en vez de mostrar «nada que hacer».
 */
export function leerBandeja(raiz, spec, ahora = new Date(), lanzar = refrescarDesprendido) {
  if (!spec) return null;
  const ruta = path.resolve(raiz, spec.file);
  const b = leerJson(ruta);
  const edadMin = existsSync(ruta) ? (ahora.getTime() - statSync(ruta).mtimeMs) / 60000 : Infinity;
  if (spec.command && edadMin > spec.maxAgeMinutes) lanzar(raiz, spec.command);
  if (!b || !Array.isArray(b.items)) return { ok: false, error: existsSync(ruta) ? `${spec.file} no tiene la forma esperada` : `todavía no hay bandeja: se está leyendo del gestor (\`${(spec.command ?? []).join(" ")}\`)` };
  return { ok: true, leidoEn: b.leidoEn ?? null, items: b.items, prs: Array.isArray(b.prs) ? b.prs : [] };
}

function refrescarDesprendido(raiz, argv) {
  try {
    const [cmd, ...args] = argv;
    const hijo = spawn(cmd === "node" ? process.execPath : cmd, args, { cwd: raiz, detached: true, stdio: "ignore", windowsHide: true });
    // Un ejecutable que no existe NO lanza: emite `error` más tarde, y sin quien lo escuche tumbaba
    // al generador (o al panel en vivo) por un refresco que es opcional.
    hijo.on("error", () => {});
    hijo.unref();
  } catch {
    // Que no se pueda refrescar no tumba el panel: queda el caché con su hora a la vista.
  }
}

/**
 * El reparto que declaró el repo (`panel.triage`, ya resuelto en `m.reparto`), compilado. Un regex
 * inválido no tumba el panel: no casa con nada, y el self-test es el que lo pone rojo.
 */
function repartoDe(m) {
  const r = m?.reparto ?? {};
  const re = (fuente) => {
    if (!fuente) return { test: () => false };
    try {
      return new RegExp(fuente, "i");
    } catch {
      return { test: () => false };
    }
  };
  const comando = (nombre, id) => (typeof r.commands?.[nombre] === "string" ? r.commands[nombre].replaceAll("{id}", String(id ?? "<id>")) : null);
  return {
    delHumano: re(r.humanPattern),
    decision: re(r.decisionPattern),
    contenedor: re(r.containerPattern),
    externo: re(r.external?.pattern),
    etiquetaExterna: r.external?.label ?? "un tercero",
    cierre: re(r.closurePattern),
    remoto: r.remote ?? "el remoto",
    comando,
  };
}

/**
 * «QUÉ HACER»: lo de cada dueño, agrupado por lo que pide, sin repetir nada. Reglas (cada una
 * nombra su dato):
 *   HUMANO —
 *     · decidir: un PR con conflictos (¿se actualiza o se cierra?), un ítem que pide elegir, una
 *       señal roja que sólo una persona destraba;
 *     · hacer: sus tareas del gestor, conseguir el voto de un PR, la máquina (doctor), commits
 *       sin empujar;
 *     · esperando: lo que espera a un tercero (`triage.external`) — lo sigue, no lo resuelve sola;
 *     · frentes: los contenedores a su nombre (`triage.containerPattern`) — contexto, no acciones.
 *   AGENTE —
 *     · ya: señales rojas suyas, el gate pendiente, alarmas, y sus tareas sin nada que esperar;
 *     · esperaTuyo: sus tareas que esperan algo de la persona (con el «espera a #id»);
 *     · esperaOtros: las que esperan a alguien más o a un ítem sin dueño declarado;
 *     · despues: sus tareas que esperan otra tarea suya (una cadena, no un bloqueo).
 *   Cada ítem del gestor lleva su FRENTE (el contenedor) y si es del foco: la vista agrupa por eso.
 * Sin bandeja (gestor no declarado o caché ausente) las listas del gestor quedan vacías y `error`
 * dice por qué: vacío por no saber no se puede ver igual que vacío por no haber nada.
 */
export function construirBandeja(m) {
  const v = m.enVivo ?? null;
  const r = construirResumen(m);
  const b = v?.bandeja?.ok ? v.bandeja : null;
  const rep = repartoDe(m);
  const humano = { decidir: [], hacer: [], esperando: [], frentes: [] };
  const agente = { ya: [], esperaTuyo: [], esperaOtros: [], despues: [] };
  const delFoco = new Set((v?.foco && !v.foco.error ? v.foco.tareas ?? [] : []).map((t) => Number(t.id)));
  const vistos = new Set();
  const una = (lista, it) => {
    const clave = it.id != null ? `#${it.id}` : it.titulo;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    lista.push(it);
  };

  // Lo que dice el gate y la máquina: viene del resumen, que ya decidió el dueño de cada cosa.
  for (const p of r.problemas.filter((x) => x.tono === "rojo")) {
    const it = { titulo: p.dueno === "humano" ? `Destrabar «${p.titulo}»` : `Arreglar «${p.titulo}»`, porque: p.que, accion: p.remedio ?? null, comando: p.reproducir ?? null, origen: "gate" };
    una(p.dueno === "humano" ? humano.decidir : agente.ya, it);
  }
  // Lo editado sin gate es trabajo EN CURSO del agente: verificarlo y commitearlo es suyo. Sólo
  // sin nada pendiente, archivos sueltos piden una decisión de la persona.
  if (r.gate?.pendiente) una(agente.ya, { titulo: "Correr el gate completo y commitear lo editado", porque: "se editó código después del último gate", comando: m.reglas?.gate?.command ?? "node scripts/gate.mjs", origen: "gate" });
  for (const a of [...(m.arnes?.alarmas ?? []), ...(m.advertencias ?? [])]) una(agente.ya, { titulo: a.que, porque: breve(a.porque ?? a.detalle ?? ""), comando: a.comando ?? null, origen: "arnés" });
  for (const sec of r.configuracion?.ok ? r.configuracion.secciones : []) {
    for (const c of sec.chequeos.filter((x) => x.tono !== "verde")) una(humano.hacer, { titulo: `Configurar tu máquina: ${c.texto}`, porque: sec.titulo, comando: c.arreglo ?? null, origen: "máquina" });
  }
  const raiz = v?.repos?.find((x) => !x.ausente) ?? null;
  if (raiz?.adelante > 0) una(humano.hacer, { titulo: `Empujar ${raiz.adelante} commit(s) hacia ${rep.remoto}`, porque: `están sólo en esta máquina (rama ${raiz.rama})`, comando: "git push", origen: "git" });
  if (raiz && !raiz.limpio && raiz.cambios?.length && !r.gate?.pendiente) una(humano.decidir, { titulo: `Qué hacer con ${raiz.cambios.length} archivo(s) sin commitear`, porque: "commitear es decisión tuya: se commitea con el gate verde, o se descarta", comando: "git status", origen: "git" });

  // Los PR: con conflictos piden una decisión; sin conflictos, conseguir el voto.
  for (const pr of b?.prs ?? []) {
    // El contrato con el adaptador es un booleano (`aprobo`) y un texto libre (`estado`): cada
    // forja tiene su escala de votos, y leer un número acá dejaba «pendiente» a todo revisor de otra.
    const pendientes = (pr.revisores ?? []).filter((x) => !x.aprobo);
    const quien = pendientes.length ? pendientes.map((x) => `${x.nombre} (${x.estado ?? "sin votar"})`).join(", ") : "sin revisores asignados";
    const base = { id: `PR${pr.id}`, url: pr.url, origen: `PR #${pr.id}` };
    // Con hilos sin resolver el PR NO está para votar: contestarlos es trabajo del agente, y pedir
    // el voto antes es pedirle a alguien que revise algo que va a cambiar. Cada push puede traer
    // una revisión nueva: se vuelve a mirar siempre.
    if (pr.hilosAbiertos > 0) una(agente.ya, { ...base, titulo: `Resolver ${pr.hilosAbiertos} hilo(s) de revisión del PR #${pr.id}, y volver a mirar después del push`, porque: `${pr.titulo} · hasta resolverlos no está para votar`, comando: rep.comando("threads", pr.id) });
    else if (pr.mergeStatus === "conflicts") una(humano.decidir, { ...base, titulo: `PR #${pr.id} tiene conflictos con ${pr.base}: ¿lo actualizo o se cierra?`, porque: pr.titulo, accion: "Decime «actualizalo» (merge de la base y push) o cerralo en la forja." });
    else una(humano.hacer, { ...base, titulo: `Conseguir el voto del PR #${pr.id} y mezclarlo`, porque: `${pr.titulo} · espera a: ${quien}`, accion: "Abrí el PR: votá o pedí el voto; con las políticas en verde, mezclalo." });
  }

  // El gestor: cada ítem una vez, en la lista de lo que pide.
  for (const it of b?.items ?? []) {
    const base = { id: it.id, titulo: it.titulo, url: it.url, origen: `${it.tipo} #${it.id}`, estado: it.estado, frente: it.frente ?? null, delFoco: delFoco.has(Number(it.id)), tomar: rep.comando("take", it.id), ver: rep.comando("show", it.id) };
    if (it.dueno === "humano") {
      if (rep.contenedor.test(it.tipo ?? "")) una(humano.frentes, base);
      else if (rep.externo.test(it.titulo ?? "")) una(humano.esperando, { ...base, accion: `Seguirla con ${rep.etiquetaExterna} y anotar la respuesta en el ítem.` });
      else if (rep.decision.test(it.titulo ?? "")) una(humano.decidir, base);
      else una(humano.hacer, base);
      continue;
    }
    // A quién espera manda dónde va: lo tuyo te pide algo; lo de otra persona se sigue; lo del
    // propio agente es sólo el orden de trabajo.
    const espera = it.esperaA ?? [];
    const tuyo = espera.filter((p) => p.dueno === "humano");
    const ajeno = espera.filter((p) => p.dueno === "otro" || p.dueno === "sin-dueno");
    if (tuyo.length) una(agente.esperaTuyo, { ...base, esperaA: tuyo });
    else if (ajeno.length) una(agente.esperaOtros, { ...base, esperaA: ajeno });
    else if (espera.length) una(agente.despues, { ...base, esperaA: espera });
    else if (it.bloqueado) una(agente.esperaTuyo, { ...base, esperaA: [], porque: "marcada «bloqueado» en el gestor sin decir a qué espera: hay que declararle el predecesor" });
    else una(agente.ya, base);
  }

  return {
    estado: r.estado,
    gate: r.gate,
    leidoEn: b?.leidoEn ?? null,
    error: v?.bandeja && !v.bandeja.ok ? v.bandeja.error : !v ? "sin capa en vivo" : !v.bandeja ? "el panel no declara `panel.inbox` en el config" : null,
    humano,
    agente,
    total: { humano: humano.decidir.length + humano.hacer.length, agente: agente.ya.length },
    // Vocabulario del gestor de ESTE repo, para que la plantilla no nombre ninguno.
    etiquetaExterna: rep.etiquetaExterna,
    comandoDueno: rep.comando("owner"),
  };
}

// ── historial del gate (para la tendencia) ──────────────────────────────────

export const MAX_HISTORIAL = 30;

/** Una corrida del registro → una fila del historial. */
export function filaDeHistorial(reg) {
  const estados = Object.values(reg?.senales ?? {}).map((s) => s?.estado);
  return {
    fecha: reg.fecha,
    veredicto: reg.veredicto,
    modo: reg.modo ?? null,
    head: reg.head ?? null,
    ms: reg.ms ?? null,
    verdes: estados.filter((e) => e === "verde").length,
    rojas: estados.filter((e) => e === "rojo").length,
    omitidas: estados.filter((e) => e !== "verde" && e !== "rojo").length,
  };
}

/** Agrega la corrida actual si es nueva. Puro: el que escribe es `generar.mjs`. */
export function historialConRegistro(previo, reg, max = MAX_HISTORIAL) {
  const filas = Array.isArray(previo) ? previo.filter((f) => f?.fecha) : [];
  if (reg?.fecha && !filas.some((f) => f.fecha === reg.fecha)) filas.push(filaDeHistorial(reg));
  return filas.sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-max);
}

// ── el resumen ──────────────────────────────────────────────────────────────

/** Primera oración, acotada: el porqué entero vive en «Reglas», acá va lo que se lee de un vistazo. */
export function breve(texto, max = 170) {
  const t = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // Sin clase de caracteres pegada al grupo: `]` seguido de `(` lo lee el link-check como un enlace.
  const corte = t.search(/(?:\.|:|;)(?:\s|$)/);
  const frase = corte > 30 ? t.slice(0, corte) : t;
  return frase.length > max ? `${frase.slice(0, max - 1).trimEnd()}…` : frase;
}

const comandoDe = (s) => (Array.isArray(s?.command) ? s.command.join(" ") : (s?.command ?? null));

const quitarMarcas = (t) => String(t ?? "").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();


/** Las oraciones del detalle que dicen cómo se cierra: «se cierra con…», «lo corrige…». */
export function remedioDe(texto, cierre) {
  const oraciones = quitarMarcas(texto)
    .replace(/^[:;,.\s]+/, "")
    .split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ«`(#])/);
  // Qué frase anuncia un cierre lo dice el repo (`panel.triage.closurePattern`): es su idioma.
  if (!cierre) return null;
  const elegidas = oraciones.filter((o) => cierre.test(o));
  return elegidas.length ? elegidas.join(" ") : null;
}

/**
 * La deuda conocida, cada ítem con lo que la bitácora dice de él: qué pasa, de quién es (humano
 * o agente) y cómo se cierra. La lista de STATUS sólo trae el título y el `#n` del evento; sin
 * cruzarla, el panel mostraba veinte títulos y ninguna acción.
 */
export function deudaAccionable(m) {
  const eventos = new Map((m.estado?.bitacora ?? []).map((e) => [e.n, e]));
  const rep = repartoDe(m);
  const senales = (m.reglas?.gate?.signals ?? []).map((s) => s.name);
  // Una línea entera entre paréntesis («(ninguna registrada)», «(none)») es el marcador de lista
  // VACÍA que escribe la proyección, no una deuda: contada como tal, el panel pedía «decidir el
  // criterio de cierre de #null» con la deuda en cero (2026-11-10).
  const esMarcadorDeVacio = (it) => /^\s*\([^()]*\)\s*\.?\s*$/.test(String(it.texto ?? ""));
  return (m.estado?.deuda?.grupos ?? []).flatMap((g) =>
    g.items.filter((it) => !esMarcadorDeVacio(it)).map((it) => {
      const texto = String(it.texto ?? "");
      const n = Number(/·\s*#(\d+)/.exec(texto)?.[1] ?? NaN);
      const ev = Number.isFinite(n) ? eventos.get(n) : null;
      const titulo = quitarMarcas(texto.replace(/\s*·\s*#\d+.*$/, "")).replace(/[:.]$/, "");
      const detalle = ev ? quitarMarcas(ev.que).replace(/^[:;,.\s]+/, "") : quitarMarcas(it.hijos?.map((h) => h.texto).join(" ") ?? "");
      return {
        n: Number.isFinite(n) ? n : null,
        titulo,
        detalle,
        remedio: remedioDe(detalle, rep.cierre),
        dueno: rep.delHumano.test(`${titulo} ${detalle}`) ? "humano" : "agente",
        fecha: ev?.fecha?.slice(0, 10) ?? /(\d{4}-\d{2}-\d{2})\s*$/.exec(texto)?.[1] ?? null,
        evidencia: ev?.evidencia ? quitarMarcas(ev.evidencia) : null,
        senales: senales.filter((s) => detalle.includes(`«${s}»`)),
        grupo: g.titulo,
      };
    }),
  );
}

/**
 * Cada señal roja con lo necesario para arreglarla: el error real (líneas que guardó el gate),
 * por qué importa, cómo reproducirla y la deuda registrada que la explica, si la hay.
 */
export function senalesRojas(m) {
  const reg = m.enVivo?.gate?.registro;
  if (!reg) return [];
  const declaradas = new Map((m.reglas?.gate?.signals ?? []).map((s) => [s.name, s]));
  const deuda = deudaAccionable(m);
  return Object.entries(reg.senales ?? {})
    .filter(([nombre, s]) => s.estado === "rojo" && (!declaradas.size || declaradas.has(nombre)))
    .map(([nombre, s]) => ({
      nombre,
      motivo: s.motivo ?? "falló",
      error: Array.isArray(s.error) ? s.error : [],
      porque: breve(declaradas.get(nombre)?.why, 260),
      reproducir: comandoDe(declaradas.get(nombre)),
      ultimoVerde: s.ultimoVerde?.fecha ?? null,
      ms: s.ms ?? null,
      deudas: deuda.filter((d) => d.senales.includes(nombre)),
    }));
}

// ── la salud del arnés como indicador ───────────────────────────────────────

/**
 * La salud del arnés en DIMENSIONES medibles: cada una cuenta cuántas piezas están bien de cuántas,
 * nombra las que no, dice cómo se remedia y de quién es. Antes la pestaña decía «sin alarmas»
 * mientras había una etapa sin control, gotchas sin freno y el self-test sin mirar: un estado que
 * no era el estado. Ahora el estado es la peor dimensión, y cada número enlaza a su remedio.
 *
 * Las dimensiones con `critica` (hooks, frenos, self-test) ponen ROJA la salud: si fallan, el arnés
 * deja de frenar en silencio. Las demás, incompletas, la dejan en atención.
 */
export function saludDelArnes(m) {
  const a = m.arnes ?? {};
  const reg = m.enVivo?.gate?.registro ?? null;
  const dims = [];
  const dim = (d) => {
    const tono = d.total === 0 ? "omitido" : d.ok === d.total ? "verde" : d.critica ? "rojo" : "advertencia";
    dims.push({ ...d, tono, pct: d.total ? Math.round((d.ok / d.total) * 100) : 0 });
  };

  const hooks = a.hooks ?? [];
  dim({ clave: "hooks", nombre: "Hooks del agente vivos", mide: "cada hook declarado en settings.json existe y se puede lanzar", ok: hooks.filter((h) => h.existe).length, total: hooks.length, malos: hooks.filter((h) => !h.existe).map((h) => `${h.evento} → ${h.archivo}`), remedio: "Restaurar el archivo del hook o quitar su declaración de .claude/settings.json.", comando: "node scripts/harness-selftest.mjs", dueno: "agente", critica: true });

  const instalados = (a.activadores ?? []).filter((x) => x.estado !== "no instalado");
  dim({ clave: "frenos", nombre: "Frenos encendidos", mide: "cada freno instalado tiene la clave del config que lo enciende", ok: instalados.filter((x) => x.estado === "activo").length, total: instalados.length, malos: instalados.filter((x) => x.estado !== "activo").map((x) => `${x.archivo} sin \`${x.clave}\``), remedio: "Declarar la clave que falta en .claude/harness.config.json (o desinstalar el freno).", comando: "node scripts/harness-selftest.mjs", dueno: "agente", critica: true });

  const senales = m.reglas?.gate?.signals ?? [];
  dim({ clave: "why", nombre: "Señales con su porqué", mide: "cada señal del gate declara `why`: sin él nadie sabe qué protege", ok: senales.filter((s) => s.why).length, total: senales.length, malos: senales.filter((s) => !s.why).map((s) => s.name), remedio: "Escribir el `why` de cada señal en gate.signals.", comando: null, dueno: "agente" });

  const runners = a.runners ?? [];
  dim({ clave: "runners", nombre: "Controles fuera del gate con corredor", mide: "lo que no corre en el gate tiene un `runner` que existe", ok: runners.filter((r) => r.existe).length, total: runners.length, malos: runners.filter((r) => !r.existe).map((r) => `${r.clave} → ${r.runner}`), remedio: "Crear el corredor declarado o apagar el control.", comando: null, dueno: "agente" });

  const etapas = a.mapa?.etapas ?? [];
  const huecos = a.mapa?.huecos ?? [];
  dim({ clave: "etapas", nombre: "Etapas del ciclo con control", mide: "cada etapa (sesión, pedido, edición, commit…) tiene al menos una guía, freno o sensor", ok: etapas.length - huecos.length, total: etapas.length, malos: huecos.map((h) => `«${h}» sin ningún control`), remedio: "Decidir si la etapa necesita un freno o un sensor; si no, declararla sin control a propósito en `taxonomy`.", comando: "node scripts/harness-map.mjs", dueno: "humano" });

  const gotchas = m.gotchas ?? [];
  dim({ clave: "gotchas", nombre: "Incidentes con freno ejecutable", mide: "cada incidente pagado quedó convertido en test, lint o hook", ok: gotchas.filter((g) => g.ejecutable).length, total: gotchas.length, malos: gotchas.filter((g) => !g.ejecutable).map((g) => `#${g.n} ${quitarMarcas(g.titulo)}`), remedio: "Convertir cada uno en un freno (/lesson) o declarar por qué no se puede.", comando: "/lesson", dueno: "agente" });

  // Lo que sólo se sabe corriendo: el self-test y la latencia, de la última corrida del gate.
  // Qué señal es el self-test y cuál la latencia se sabe por el SCRIPT que corre, no por cómo la
  // llamó el repo: buscada por nombre, una señal rebautizada dejaba la dimensión omitida en silencio.
  // El modelo trae el comando como texto (`command`) y como lista (`argv`); el config crudo, sólo la lista.
  const argvDe = (s) => (Array.isArray(s.argv) ? s.argv : Array.isArray(s.command) ? s.command : String(s.command ?? "").split(/\s+/));
  const corren = (script) => new Set(senales.filter((s) => argvDe(s).some((a) => String(a).replace(/\\/g, "/").endsWith(script))).map((s) => s.name));
  const deLaCorrida = (script) => {
    const nombres = corren(script);
    return Object.entries(reg?.senales ?? {}).filter(([n]) => nombres.has(n));
  };
  const selftests = deLaCorrida("scripts/harness-selftest.mjs");
  dim({ clave: "selftest", nombre: "Self-test: los frenos muerden", mide: "en la última corrida, cada freno probado con su cebo se puso rojo cuando debía", ok: selftests.filter(([, s]) => s.estado === "verde").length, total: selftests.length, malos: selftests.filter(([, s]) => s.estado !== "verde").map(([n, s]) => `${n}: ${s.estado}${s.error?.[0] ? ` — ${s.error[0]}` : ""}`), remedio: "Leer qué freno dejó de morder y arreglarlo; nunca relajar el caso del self-test.", comando: "node scripts/harness-selftest.mjs", dueno: "agente", critica: true });
  const latencia = deLaCorrida("scripts/hooks-timing.mjs");
  dim({ clave: "latencia", nombre: "Hooks dentro de su presupuesto", mide: "ningún hook cuesta más de lo presupuestado en cada prompt o edición", ok: latencia.filter(([, s]) => s.estado === "verde").length, total: latencia.length, malos: latencia.filter(([, s]) => s.estado !== "verde").map(([n, s]) => `${n}: ${s.estado}`), remedio: "Medir cada hook y sacar del que se pasa el trabajo caro (o subir su presupuesto con motivo).", comando: "node scripts/hooks-timing.mjs", dueno: "agente" });

  const medidas = dims.filter((d) => d.tono !== "omitido");
  const rojas = medidas.filter((d) => d.tono === "rojo");
  const atencion = medidas.filter((d) => d.tono === "advertencia");
  const sanas = medidas.filter((d) => d.tono === "verde");
  const estado = rojas.length
    ? { tono: "rojo", titular: `Arnés en riesgo: ${rojas.map((d) => d.nombre.toLowerCase()).join(" y ")} fallan`, detalle: "Con esto roto, un freno puede dejar de frenar sin que nada lo diga." }
    : atencion.length
      ? { tono: "advertencia", titular: `Arnés funcionando, con ${atencion.length} punto(s) por completar`, detalle: `${sanas.length} de ${medidas.length} dimensiones al 100 %. Falta: ${atencion.map((d) => d.nombre.toLowerCase()).join(" · ")}.` }
      : { tono: "verde", titular: "Arnés sano: todas las dimensiones al 100 %", detalle: `${medidas.length} dimensiones medidas, ninguna con huecos.` };
  const piezas = medidas.reduce((n, d) => n + d.total, 0);
  const piezasOk = medidas.reduce((n, d) => n + d.ok, 0);
  return { estado, dimensiones: dims, puntaje: piezas ? Math.round((piezasOk / piezas) * 100) : 0, sanas: sanas.length, medidas: medidas.length };
}

// ── el gate como pipeline ───────────────────────────────────────────────────

const TONO_DE_ESTADO = (e) => (e === "verde" ? "verde" : e === "rojo" ? "rojo" : "omitido");

/**
 * La última corrida agrupada en etapas, como el pipeline de una forja: cada etapa con sus jobs
 * (las señales, en el orden del gate), su estado (la peor de sus señales) y su duración. Las etapas
 * las declara el repo (`panel.pipeline.stages`); lo que no casa con ninguna va a «Otras».
 */
export function etapasDelPipeline(m) {
  const reg = m.enVivo?.gate?.registro;
  if (!reg) return [];
  const declaradas = m.reglas?.gate?.signals ?? [];
  // Con señales declaradas, sólo ésas: lo que quedó en el registro de un nombre viejo no es un job.
  const orden = declaradas.length ? declaradas.map((s) => s.name) : Object.keys(reg.senales ?? {});
  const porNombre = new Map(declaradas.map((s) => [s.name, s]));
  const defs = (m.enVivo?.etapas ?? []).map((e) => ({ nombre: e.name, re: new RegExp(e.match, "i"), jobs: [] }));
  const otras = { nombre: defs.length ? "Otras" : "Gate", re: null, jobs: [] };
  for (const nombre of orden) {
    const s = reg.senales?.[nombre];
    if (!s) continue;
    const job = {
      nombre,
      estado: TONO_DE_ESTADO(s.estado),
      ms: s.ms ?? null,
      motivo: s.motivo ?? null,
      ultimoVerde: s.ultimoVerde?.fecha ?? null,
      porque: breve(porNombre.get(nombre)?.why, 200),
      comando: comandoDe(porNombre.get(nombre)),
    };
    (defs.find((d) => d.re.test(nombre)) ?? otras).jobs.push(job);
  }
  return [...defs, otras]
    .filter((e) => e.jobs.length)
    .map(({ nombre, jobs }) => ({
      nombre,
      jobs,
      estado: jobs.some((j) => j.estado === "rojo") ? "rojo" : jobs.some((j) => j.estado === "omitido") ? "omitido" : "verde",
      verdes: jobs.filter((j) => j.estado === "verde").length,
      ms: jobs.reduce((n, j) => n + (j.ms ?? 0), 0),
    }));
}

// ── prompts para el agente ──────────────────────────────────────────────────
//
// El botón «Prompt para el agente» copia una instrucción lista para pegar: qué hacer, con la
// evidencia que el panel ya tiene (error, comando, deuda), y las reglas del arnés que aplican.
// Sale del mismo modelo, así que dice lo mismo que la pantalla.

// Sin nombrar la guía ni el comando: los dos son de cada repo, y el agente ya los tiene declarados.
const CIERRE = "Seguí las reglas del arnés (la guía del repo). Al terminar corré el gate completo y reportá el veredicto real; si no queda verde, decí qué falta.";
const SIN_ACCION_EXTERNA = "No ejecutes acciones hacia afuera (el gestor, pipelines, PR, push) sin mi autorización explícita: preparámelas y esperá.";

export function promptDeAccion(a, vista) {
  const lineas =
    a.dueno === "agente"
      ? [`Tarea del panel del arnés (pestaña «${vista}»): ${quitarMarcas(a.texto)}.`, a.comando ? `Punto de partida: \`${a.comando}\`.` : null, CIERRE]
      : [
          `Ayudame a destrabar esto, que el panel del arnés marca como mío (pestaña «${vista}»): ${quitarMarcas(a.texto)}.`,
          a.comando ? `Referencia: \`${a.comando}\`.` : null,
          "Preparame lo que necesito para resolverlo: qué decidir, a quién pedírselo y el texto o el comando listo.",
          SIN_ACCION_EXTERNA,
        ];
  return lineas.filter(Boolean).join("\n");
}

export function promptDeSenal(r) {
  const deudas = r.deudas.map((d) => `- deuda #${d.n} (${d.dueno}): ${d.titulo}. ${d.remedio ?? d.detalle}`);
  const humana = r.deudas.some((d) => d.dueno === "humano");
  return [
    `La señal «${r.nombre}» del gate está en rojo (${r.motivo}).`,
    r.error.length ? `Error registrado:\n${r.error.map((l) => `  ${l}`).join("\n")}` : `El registro no guardó el error: reproducilo con \`${r.reproducir}\` y leé el mensaje real.`,
    r.reproducir ? `Para reproducirla: \`${r.reproducir}\`.` : null,
    r.porque ? `Por qué importa: ${r.porque}` : null,
    deudas.length ? `Deuda registrada que la explica:\n${deudas.join("\n")}` : null,
    humana
      ? `La destraba una persona: preparame el pedido (a quién, qué cambiar, con qué evidencia). ${SIN_ACCION_EXTERNA}`
      : "Diagnosticá la causa con el error real (archivo, línea, mensaje), arreglala sin tocar aserciones para que pasen y volvé a correr la señal.",
    CIERRE,
  ]
    .filter(Boolean)
    .join("\n");
}

export function promptDeDeuda(d) {
  return [
    `Cerrar la deuda #${d.n} de STATUS.md: «${d.titulo}».`,
    d.detalle ? `Qué pasa: ${d.detalle}` : null,
    d.remedio ? `Cómo se cierra (según la bitácora): ${d.remedio}` : "La bitácora no dice cómo se cierra: proponé un criterio de cierre verificable antes de tocar nada.",
    d.evidencia ? `Se verifica con: \`${d.evidencia}\`.` : null,
    d.dueno === "humano" ? `Esta deuda la destraba una persona: preparame lo necesario. ${SIN_ACCION_EXTERNA}` : null,
    "Al cerrarla, registralo con `node scripts/status.mjs record` (evento debt.closed) citando la evidencia.",
    CIERRE,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Todos los pendientes del agente en un solo prompt, en el orden del panel (lo rojo primero). */
export function promptDePendientes(lista) {
  if (!lista.length) return "";
  return [
    "Pendientes del agente según el panel del arnés, en orden (lo rojo primero). Tomalos de a uno:",
    ...lista.map((p, i) => `${i + 1}. ${quitarMarcas(p.texto)}${p.comando ? ` — \`${p.comando}\`` : ""}`),
    CIERRE,
  ].join("\n");
}

/**
 * «Qué hacer» de cada pestaña: lo accionable de esa vista y nada más. Cada acción nombra su dueño
 * y, si la hay, el comando. Una pestaña sin acciones lo dice: «nada que hacer» también es un dato.
 */
export function accionesPorPestana(m) {
  const v = m.enVivo ?? null;
  const acc = (dueno, tono, texto, comando = null) => ({ dueno, tono, texto, comando });
  const deuda = deudaAccionable(m);
  const rojas = senalesRojas(m);
  const rep = repartoDe(m);

  // Salud: una acción por dimensión incompleta (la misma fuente que el indicador), más las
  // alarmas que no caen en ninguna dimensión (advertencias de las fuentes).
  const salud = [
    ...saludDelArnes(m)
      .dimensiones.filter((d) => d.tono === "rojo" || d.tono === "advertencia")
      .map((d) => acc(d.dueno, d.tono, `${d.nombre}: ${d.ok}/${d.total} — ${d.remedio}`, d.comando)),
    // Las alarmas que ya cuenta una dimensión (hook ausente, freno muerto, señal sin why, runner
    // inexistente) no se repiten; las demás (pieza sin clasificar, control sin runner…) sí.
    ...(m.arnes?.alarmas ?? []).filter((x) => !/no existe|instalado y muerto|no declara `why`|nadie lo corre$/.test(x.que)).map((x) => acc("agente", "rojo", x.que, x.comando)),
    ...(m.advertencias ?? []).map((a) => acc("agente", "advertencia", a.que, a.comando ?? null)),
    // El barrido de deriva que corre el panel en vivo (`drift`): sólo lo ROJO pide algo; sus avisos
    // (reglas sin cicatriz) son para decidir con calma y se leen en la salida del barrido.
    ...(v?.deriva && v.deriva.exit !== 0 ? [acc("agente", "rojo", `Hay deriva (barrido del ${String(v.deriva.fecha ?? "").slice(0, 16).replace("T", " ")}): ${(v.deriva.salida ?? []).filter((l) => /✗|ROJO|DERIVA/.test(l)).join(" · ") || "ver la salida del barrido"}`, "node scripts/drift-check.mjs")] : []),
  ];

  const ahora = [];
  for (const r of rojas) {
    const remedio = r.deudas.find((d) => d.remedio);
    ahora.push(acc(r.deudas.some((d) => d.dueno === "humano") ? "humano" : "agente", "rojo", `«${r.nombre}» en rojo${remedio ? ` — ${remedio.remedio}` : ": leer el error y arreglarlo"}`, r.reproducir));
  }
  if (v?.gate?.pendiente) ahora.push(acc("agente", "advertencia", "Hay código editado sin gate: correr el gate completo", m.reglas?.gate?.command ?? null));
  for (const s of v?.sondas ?? []) if (!s.viva) ahora.push(acc("humano", "advertencia", `El servicio «${s.nombre}» no responde (${s.error ?? s.status ?? "?"}): levantarlo`, s.url));
  const raiz = v?.repos?.find((r) => !r.ausente);
  if (raiz && !raiz.limpio) ahora.push(acc("humano", "info", `${raiz.cambios.length} archivo(s) sin commitear en ${raiz.rama}: decidir si se commitean`, "git status"));

  const plan = v?.plan ?? m.plan;
  // Con dueño por ítem, cada uno ve lo suyo: cargarle todo al humano le pedía mover las tareas
  // del agente y las historias que se cierran solas (2026-11-10).
  const pd = plan?.porDueno;
  const planAcc = plan?.estado !== "ok"
    ? [acc("humano", "info", `El burn-down no tiene fuente: ${plan?.motivo ?? "sin plan"}`, "panel.tracker.command en el config")]
    : pd
      ? [
          ...(pd.humano ? [acc("humano", "info", `${pd.humano} ítem(s) del plan esperan al humano (decisiones, accesos, preguntas a terceros)`, rep.comando("focus"))] : []),
          ...(pd.sinDueno ? [acc("humano", "advertencia", `${pd.sinDueno} ítem(s) del plan sin dueño: marcar cada uno`, rep.comando("owner"))] : []),
          ...(pd.agente ? [acc("agente", "info", `${pd.agente} ítem(s) del plan son del agente`, rep.comando("focus"))] : []),
        ]
      : plan.resumen?.pendientes ? [acc("humano", "info", `${plan.resumen.pendientes} ítem(s) del plan pendientes`)] : [];

  // Sólo lo accionable: las deudas que dicen cómo se cierran, primero las que dejan una señal en
  // rojo, y UNA acción para las que no lo dicen (listarlas todas otra vez era repetir las tarjetas).
  const conRemedio = deuda.filter((d) => d.remedio).sort((a, b) => b.senales.length - a.senales.length);
  const sinRemedio = deuda.filter((d) => !d.remedio);
  const estado = conRemedio.map((d) => acc(d.dueno, d.senales.length ? "rojo" : "advertencia", `${d.titulo} — ${d.remedio}`, d.n ? `deuda #${d.n}` : null));
  if (sinRemedio.length) {
    estado.push(acc("humano", "info", `${sinRemedio.length} deuda(s) no dicen cómo se cierran (${sinRemedio.map((d) => `#${d.n}`).join(", ")}): decidir para cada una el criterio de cierre, o cerrarla si ya no aplica`, "node scripts/status.mjs record"));
  }
  // La bitácora anota el veredicto cuando CAMBIA (gate.mjs, anotarVeredicto), así que su commit es
  // «verde desde X», no «el último gate». Comparar el commit pedía actualizarla en cada corrida
  // verde sobre un commit nuevo, y ningún comando podía hacerlo (2026-11-09). Lo incoherente es que
  // los VEREDICTOS difieran; y el remedio es el gate completo que declara el config, no un script
  // retirado.
  const reg = v?.gate?.registro;
  if (reg && m.estado?.veredicto && reg.modo === "full" && ["verde", "rojo"].includes(reg.veredicto) && m.estado.veredicto.tono !== reg.veredicto) {
    estado.unshift(acc("agente", "advertencia", `La bitácora dice ${quitarMarcas(m.estado.veredicto.texto).split("·")[0].trim()} sobre ${m.estado.rama ?? "otra versión"}, pero el último gate completo (${reg.head ?? "?"}) salió ${reg.veredicto.toUpperCase()}: correr el gate completo para que la anote`, m.reglas?.gate?.command ?? null));
  }

  const gotchas = (m.gotchas ?? []).filter((g) => !g.ejecutable).map((g) => acc("agente", "advertencia", `Gotcha ${g.n} «${quitarMarcas(g.titulo)}» no tiene freno ejecutable: convertirlo en test, lint o hook, o declarar por qué no se puede`, "/lesson"));

  const reglas = (m.reglas?.constituciones ?? []).flatMap((c) => c.principios).filter((p) => p.fuerza === "BLOCKING" && !String(p.mecanismo ?? "").trim()).map((p) => acc("humano", "advertencia", `${p.id} es BLOCKING y no declara mecanismo`));

  const mem = v?.memoria;
  const memoria = [];
  if (mem?.personal?.conRutasRotas) memoria.push(acc("agente", "advertencia", `${mem.personal.conRutasRotas} memoria(s) de esta máquina apuntan a archivos que ya no existen: actualizarlas o borrarlas`));
  if (mem?.personal?.fueraDelIndice?.length) memoria.push(acc("agente", "advertencia", `${mem.personal.fueraDelIndice.length} memoria(s) fuera del índice MEMORY.md: indexarlas o borrarlas`));
  if (mem?.alArrancar?.excede) memoria.push(acc("humano", "advertencia", "Lo que el agente lee al arrancar excede el presupuesto: recortar las guías"));

  const fuentes = (m.faltantes ?? []).map((f) => acc("humano", "info", `Falta ${f}: el panel no lo puede leer`));

  return { salud, ahora, plan: planAcc, estado, gotchas, reglas, memoria, fuentes };
}

/**
 * El diagnóstico: un estado en una frase, los problemas con su porqué y dos listas de pendientes
 * separadas por dueño. Reglas de reparto (sin opinión, cada una nombra su dato):
 *   - AGENTE: lo que se arregla con código o con un comando en el repo — señales rojas u omitidas
 *     del gate, el gate pendiente, alarmas del arnés, advertencias de la memoria, sus propuestas del foco;
 *   - HUMANO: lo que sólo decide o configura una persona — la máquina (doctor), lo que está sin
 *     commitear (commitear es decisión del humano), sus propuestas del foco.
 */
export function construirResumen(m) {
  const v = m.enVivo ?? null;
  const reg = v?.gate?.registro ?? null;
  const declaradas = new Map((m.reglas?.gate?.signals ?? []).map((s) => [s.name, s]));
  // El registro ACUMULA: una señal renombrada o quitada del config deja su última corrida ahí para
  // siempre. Contada, el Resumen decía «12/13» con todo verde. Cuentan sólo las que el config
  // declara hoy (sin config legible, las del registro).
  const todas = Object.entries(reg?.senales ?? {})
    .filter(([nombre]) => !declaradas.size || declaradas.has(nombre))
    .map(([nombre, s]) => ({ nombre, ...s, declarada: declaradas.get(nombre) ?? null }));
  const esOpcional = (s) => s.estado === "omitida" && /^no existe \.git\//.test(s.motivo ?? "");
  // …y tampoco la apagada a propósito (ver `opcional`, abajo): ni suma ni resta.
  const senales = todas.filter((s) => !esOpcional(s));
  const rojas = senales.filter((s) => s.estado === "rojo");
  // Una señal que se omite porque falta un marcador LOCAL opcional (`no existe .git/…`, como la
  // tarea declarada) está apagada a propósito: no es «el gate no midió todo». El titular decía
  // «Casi: 1 señal omitida» con el gate verde, y asustaba por nada (2026-11-10).
  const opcional = (s) => s.estado === "omitida" && /^no existe \.git\//.test(s.motivo ?? "");
  const omitidas = senales.filter((s) => s.estado !== "verde" && s.estado !== "rojo" && !opcional(s));
  const verdes = senales.filter((s) => s.estado === "verde");
  const doctor = v?.doctor?.ok ? v.doctor : null;
  const foco = v?.foco && !v.foco.error ? v.foco : null;
  const raiz = v?.repos?.find((r) => !r.ausente) ?? null;
  const alarmas = [...(m.arnes?.alarmas ?? []), ...(m.advertencias ?? [])];
  const comandoGate = m.reglas?.gate?.command ?? "node scripts/gate.mjs";

  const problemas = [];
  const detalleRojas = new Map(senalesRojas(m).map((r) => [r.nombre, r]));
  for (const s of rojas) {
    const d = detalleRojas.get(s.nombre);
    const conRemedio = d?.deudas.find((x) => x.remedio) ?? null;
    problemas.push({
      tono: "rojo",
      titulo: s.nombre,
      que: d?.error?.[0] ?? s.motivo ?? "falló",
      porque: breve(s.declarada?.why),
      remedio: conRemedio ? `${conRemedio.remedio} (deuda #${conRemedio.n})` : null,
      desde: s.ultimoVerde?.fecha ?? null,
      reproducir: comandoDe(s.declarada),
      dueno: d?.deudas.some((x) => x.dueno === "humano") ? "humano" : "agente",
    });
  }
  for (const c of (doctor?.secciones ?? []).flatMap((sec) => sec.chequeos.filter((x) => x.tono === "rojo").map((x) => ({ ...x, seccion: sec.titulo })))) {
    problemas.push({ tono: "rojo", titulo: c.seccion, que: c.texto, porque: "la máquina no puede correr el gate completo hasta arreglarlo", desde: null, reproducir: c.arreglo, dueno: "humano" });
  }
  for (const a of alarmas) problemas.push({ tono: "advertencia", titulo: "alarma del arnés", que: a.que, porque: breve(a.porque ?? a.detalle ?? ""), desde: null, reproducir: a.comando ?? null, dueno: "agente" });

  const agente = [];
  const humano = [];
  for (const s of rojas) {
    const d = detalleRojas.get(s.nombre);
    const humanas = d?.deudas.filter((x) => x.dueno === "humano") ?? [];
    // Una señal roja por algo que sólo una persona destraba (un acceso, una autorización)
    // es pendiente del HUMANO, con el remedio que dejó escrito la deuda; si no, del agente.
    if (humanas.length) for (const x of humanas) humano.push({ tono: "rojo", texto: `Destrabar «${s.nombre}»: ${x.remedio ?? x.titulo}`, comando: `deuda #${x.n}`, origen: "gate" });
    else agente.push({ tono: "rojo", texto: `Arreglar la señal «${s.nombre}» (${s.motivo ?? "roja"})`, comando: comandoDe(s.declarada), origen: "gate" });
  }
  if (v?.gate?.pendiente) agente.push({ tono: "advertencia", texto: "Correr el gate completo: hay cambios sin verificar", comando: comandoGate, origen: "gate", desde: v.gate.desde });
  // Una `abortada` no es una omitida: la señal existe y arrancó (o lo intentó), pero no llegó a medir
  // (consola muerta, corte desde afuera). Se arregla volviéndola a correr, no instalando lo que falta.
  for (const s of omitidas)
    agente.push(
      s.estado === "abortada"
        ? { tono: "rojo", texto: `Volver a correr «${s.nombre}» — abortada, no llegó a medir (${s.motivo ?? "sin motivo"}); no es un defecto de lo que mide`, comando: comandoDe(s.declarada), origen: "gate" }
        : { tono: "omitido", texto: `Hacer correr «${s.nombre}» — salió omitida (${s.motivo ?? "sin motivo"}); omitida no es verde`, comando: comandoDe(s.declarada), origen: "gate" },
    );
  for (const a of alarmas) agente.push({ tono: "advertencia", texto: a.que, comando: a.comando ?? null, origen: "arnés" });
  for (const p of foco?.propuestas ?? []) (p.quien === "agente" ? agente : humano).push({ tono: "info", texto: p.texto, comando: null, origen: `foco #${foco.id}` });
  for (const t of (foco?.tareas ?? []).filter((t) => !t.cerrada && t.dueno)) {
    (t.dueno === "agente" ? agente : humano).push({ tono: t.bloqueada ? "advertencia" : "info", texto: `#${t.id} ${t.titulo} — ${t.estado}${t.bloqueada ? " · bloqueada" : ""}`, comando: null, url: t.url, origen: `foco #${foco.id}` });
  }
  for (const sec of doctor?.secciones ?? []) {
    for (const c of sec.chequeos.filter((x) => x.tono !== "verde")) humano.push({ tono: c.tono, texto: `${sec.titulo}: ${c.texto}`, comando: c.arreglo, origen: "configuración" });
  }
  if (raiz && !raiz.limpio && raiz.cambios?.length) humano.push({ tono: "info", texto: `Decidir qué hacer con ${raiz.cambios.length} archivo(s) sin commitear en ${raiz.rama ?? "la rama actual"}`, comando: "git status", origen: "git" });
  if (v && !v.responsable?.nombre) humano.push({ tono: "advertencia", texto: "Declarar quién es el responsable de este informe", comando: "panel.owner.env en .claude/harness.config.json", origen: "panel" });

  // El estado en una frase. Manda lo peor; la frase dice cuánto y de qué.
  let estado;
  if (!v) {
    const tono = m.estado?.veredicto?.tono ?? "neutro";
    estado = { tono, titular: tono === "verde" ? "Verde según la bitácora" : tono === "rojo" ? "Rojo según la bitácora" : "Sin veredicto", detalle: `Sólo memoria (sin capa en vivo): veredicto escrito en ${m.rutas?.status ?? "STATUS.md"}${m.estado?.fechaGate ? ` el ${m.estado.fechaGate}` : ""}.` };
  } else if (!reg) {
    estado = { tono: "advertencia", titular: "Sin datos: el gate nunca corrió en esta máquina", detalle: `Correr ${comandoGate} para tener un estado.` };
  } else if (rojas.length || doctor?.bloqueantes) {
    const partes = [];
    if (rojas.length) partes.push(`${rojas.length} de ${senales.length} señales del gate fallan`);
    if (doctor?.bloqueantes) partes.push(`${doctor.bloqueantes} problema(s) de configuración bloquean`);
    estado = { tono: "rojo", titular: `No entregable: ${partes.join(" y ")}`, detalle: rojas.length ? `Fallan: ${rojas.map((s) => s.nombre).join(" · ")}.` : "La máquina no puede correr el gate." };
  } else if (v.gate.pendiente) {
    estado = { tono: "advertencia", titular: "Hay cambios sin verificar", detalle: `El último gate pasó, pero se editó código después. Correr ${comandoGate}.` };
  } else if (omitidas.length) {
    estado = { tono: "advertencia", titular: `Casi: ${omitidas.length} señal(es) omitidas`, detalle: "Omitida no es verde: el gate no midió todo." };
  } else {
    estado = { tono: "verde", titular: "Entregable: gate verde y nada pendiente", detalle: `Las ${senales.length} señales pasaron.` };
  }

  return {
    responsable: v?.responsable?.nombre ? v.responsable : null,
    estado,
    gate: reg ? { fecha: reg.fecha, veredicto: reg.veredicto, modo: reg.modo, head: reg.head, total: senales.length, verdes: verdes.length, rojas: rojas.length, omitidas: omitidas.length, pendiente: Boolean(v?.gate?.pendiente) } : null,
    lentas: [...senales].filter((s) => Number.isFinite(s.ms)).sort((a, b) => b.ms - a.ms).slice(0, 6).map((s) => ({ nombre: s.nombre, ms: s.ms, estado: s.estado })),
    historial: v?.historial ?? [],
    problemas,
    pendientes: { humano, agente },
    configuracion: v?.doctor ?? null,
    foco: v?.foco ?? null,
    actividad: v?.tokens ? v.tokens.ultimosDias.map((d) => ({ dia: d.dia, mensajes: d.mensajes, salida: d.salida })) : [],
  };
}
