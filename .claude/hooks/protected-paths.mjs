#!/usr/bin/env node
/**
 * PreToolUse Write|Edit|MultiEdit|mcp__* — rutas protegidas.
 *
 * Pilar 4: secretos, artefactos derivados e historia de git no los toca el agente.
 * La excepción legítima es que el humano haga el cambio él mismo.
 *
 * Las herramientas MCP que escriben (`writeTools`) pasan por acá igual que `Edit`: el freno
 * protege la RUTA, no la herramienta con que se llega. Las de lectura salen en la primera línea.
 *
 * Y el alcance de la tarea declarada (`task`, #52): con una tarea activa, editar un archivo del
 * repo FUERA de lo planificado se frena. Vive acá porque es la misma pregunta —¿esta ruta se
 * puede tocar?— y un hook más sería un arranque de node más en cada edición.
 */
import fs from "node:fs";
import path from "node:path";
import { readInput, loadConfig, deny, allow, ask, targetPath, targetPaths, firstMatch, escribe, esHerramientaMcp, escrituraAmplia, dentroDelAlcance, tareaActiva, rutaDeTodo, pruebasBloqueadas, REPO_ROOT, CONFIG_PATH } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();
if (!config) allow();
if (!escribe(input, config)) allow();

const rel = targetPath(input, config);

/**
 * El texto con que quedaría el archivo después de la herramienta, o null si no se puede saber
 * (una herramienta MCP con semántica propia, un `old_string` que no está: esa edición falla sola).
 */
function resultado(abs) {
  const ti = input?.tool_input ?? {};
  if (input?.tool_name === "Write") return typeof ti.content === "string" ? ti.content : null;
  const cambios = input?.tool_name === "Edit" ? [ti] : input?.tool_name === "MultiEdit" && Array.isArray(ti.edits) ? ti.edits : null;
  if (!cambios) return null;
  let texto;
  try {
    texto = fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
  for (const c of cambios) {
    if (typeof c?.old_string !== "string" || typeof c?.new_string !== "string" || !texto.includes(c.old_string)) return null;
    texto = c.replace_all ? texto.split(c.old_string).join(c.new_string) : texto.replace(c.old_string, () => c.new_string);
  }
  return texto;
}

// Invariante del arnés, no regla del repo: un config ilegible apaga TODOS los frenos (fallan
// abiertos para no bloquear al humano, P5). Esa puerta es para el humano que lo rompió sin
// querer, no para el agente: una escritura que dejaría el config sin parsear se frena acá, sea
// cual sea el `protectedPaths`. Con el config ya roto este hook ni llega (salió arriba).
const configRel = path.relative(REPO_ROOT, CONFIG_PATH).split(path.sep).join("/");
if (targetPaths(input, config).includes(configRel)) {
  const texto = resultado(CONFIG_PATH);
  if (texto !== null) {
    // Que parsee no alcanza: `null`, `[]` o `42` parsean y dejan a cada hook sin config igual
    // (lo encontró el reviewer). Lo que se exige es lo que los hooks necesitan: un objeto.
    let problema = null;
    try {
      const v = JSON.parse(texto);
      if (v === null || typeof v !== "object" || Array.isArray(v)) problema = `parsea, pero es ${v === null ? "null" : Array.isArray(v) ? "un array" : typeof v}, no un objeto`;
    } catch (e) {
      problema = `no parsea: ${e.message}`;
    }
    if (problema) {
      deny(
        `CONFIG ILEGIBLE: esta escritura deja \`${configRel}\` inservible (${problema}).\n` +
          `Un config que no parsea apaga TODOS los frenos del arnés: fallan abiertos para no bloquear al humano (P5).\n` +
          `Editá sólo la clave que hace falta, con JSON válido.`,
      );
    }
  }
}

const reglas = Array.isArray(config.protectedPaths) ? config.protectedPaths : [];
// `ask: true` no bloquea: le pasa la decisión al humano. Es para lo que el agente a veces SÍ
// tiene que tocar —el config del arnés, cuando `/lesson` convierte un incidente en regla— pero
// nunca sin que alguien lo vea: el config es lo que decide qué frena, y editarlo en silencio es
// apagar el arnés con permiso de escritura. Un bloqueo gana siempre sobre una pregunta.
const bloquean = reglas.filter((r) => !r.ask);
const preguntan = reglas.filter((r) => r.ask);

// Se evalúan TODOS los nombres que el archivo tiene dentro del repo, no sólo el escrito: un
// symlink interno (`alias/ → src/secreto/`) es otro nombre de una ruta que ya tiene dueño, y
// prohibir por un nombre mientras el otro pasa es no prohibir. Basta que UNO case.
// Fuera del repo (`../`) no es asunto de este hook. Se filtra por nombre y no se sale en la
// primera ruta: un `move` desde afuera HACIA `.env` trae la de afuera primero.
const nombres = targetPaths(input, config).filter((n) => !n.startsWith(".."));
const alias = (nombre) => (nombre === rel || esHerramientaMcp(input) ? "" : `(pedido como \`${rel}\`, que es un alias de esa ruta)\n`);
for (const nombre of nombres) {
  const hit = firstMatch(bloquean, nombre);
  if (hit) {
    deny(
      `RUTA PROTEGIDA: \`${nombre}\` no se edita desde el agente.\n` +
        alias(nombre) +
        `Motivo: ${hit.reason}\n` +
        `Si el cambio hace falta de verdad, pedíselo al humano y que lo haga él.`,
    );
  }
}

// La pregunta se hace AL FINAL, después de los frenos de la tarea: si el humano dice que sí, la
// herramienta corre, así que antes tiene que haber pasado todo lo que bloquea.
let confirmar = null;
for (const nombre of nombres) {
  const hit = firstMatch(preguntan, nombre);
  if (hit) {
    confirmar = `RUTA PROTEGIDA (pide confirmación): \`${nombre}\`.\n${alias(nombre)}Motivo: ${hit.reason}`;
    break;
  }
}
const seguir = () => (confirmar ? ask(confirmar, input) : allow());

// El alcance de la tarea declarada. Sin tarea activa, nada que ver.
const tarea = tareaActiva(config);
if (!tarea) seguir();

// Locked tests come first: they are the definition of done, and loosening one is how a red task
// turns green without the code changing. Checked before the wide-write shortcut below, so the
// file-by-file answer is given whenever there is a file to answer about.
const bloqueadas = pruebasBloqueadas(tarea);
const tocada = targetPaths(input, config).find((n) => bloqueadas.has(n));
if (tocada) {
  deny(
    `PRUEBA BLOQUEADA: \`${tocada}\` quedó congelada en la tarea ${tarea.item} (\`task.mjs lock\`).\n` +
      `La prueba es la definición de terminado: si el código no la pasa, se cambia el código, no la prueba.\n` +
      `Si la prueba está MAL (no el código), pará y decilo; con el acuerdo del humano: \`node scripts/task.mjs unlock ${tocada} --why "<qué estaba mal en la prueba>"\`.`,
  );
}

// The task's own to-do list is part of planning, so it is always inside the scope.
const todo = rutaDeTodo(config, tarea.item);
const alcance = todo ? [...(tarea.alcance ?? []), { ruta: todo }] : tarea.alcance;
const ampliar = `node scripts/task.mjs scope <ruta> --why "<por qué entra en la tarea>"`;
const destinos = targetPaths(input, config);
if (todo && destinos.length && destinos.every((n) => n === todo)) seguir();
if (!tarea.alcance?.length) {
  deny(
    `SIN ALCANCE DECLARADO: la tarea ${tarea.item} está abierta y todavía no dice qué archivos toca.\n` +
      `Planificá antes de escribir: \`${ampliar}\`.`,
  );
}
// Una escritura MCP sobre todo el proyecto o un directorio no se puede cruzar archivo por archivo:
// la verificación de la tarea cruza el diff entero después.
if (escrituraAmplia(input, config)) seguir();
const afuera = targetPaths(input, config).filter((n) => !n.startsWith("..") && !dentroDelAlcance(n, alcance));
if (afuera.length) {
  deny(
    `FUERA DEL ALCANCE: \`${afuera[0]}\` no está en lo declarado para la tarea ${tarea.item} (${tarea.alcance.map((a) => a.ruta).join(", ")}).\n` +
      `Un cambio fuera de la tarea es el que nadie revisa. Si de verdad entra, ampliá el alcance con motivo: \`${ampliar}\`. Si no, no lo toques.`,
  );
}

seguir();
