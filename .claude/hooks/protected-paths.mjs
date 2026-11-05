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
import { readInput, loadConfig, deny, allow, targetPath, targetPaths, firstMatch, escribe, esHerramientaMcp, escrituraAmplia, dentroDelAlcance, tareaActiva, rutaDeTodo, pruebasBloqueadas } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();
if (!config) allow();
if (!escribe(input, config)) allow();

const rel = targetPath(input, config);

// Se evalúan TODOS los nombres que el archivo tiene dentro del repo, no sólo el escrito: un
// symlink interno (`alias/ → src/secreto/`) es otro nombre de una ruta que ya tiene dueño, y
// prohibir por un nombre mientras el otro pasa es no prohibir. Basta que UNO case.
// Fuera del repo (`../`) no es asunto de este hook. Se filtra por nombre y no se sale en la
// primera ruta: un `move` desde afuera HACIA `.env` trae la de afuera primero.
for (const nombre of targetPaths(input, config).filter((n) => !n.startsWith(".."))) {
  const hit = firstMatch(config.protectedPaths, nombre);
  if (hit) {
    deny(
      `RUTA PROTEGIDA: \`${nombre}\` no se edita desde el agente.\n` +
        (nombre === rel || esHerramientaMcp(input) ? "" : `(pedido como \`${rel}\`, que es un alias de esa ruta)\n`) +
        `Motivo: ${hit.reason}\n` +
        `Si el cambio hace falta de verdad, pedíselo al humano y que lo haga él.`,
    );
  }
}

// El alcance de la tarea declarada. Sin tarea activa, nada que ver.
const tarea = tareaActiva(config);
if (!tarea) allow();

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
if (todo && destinos.length && destinos.every((n) => n === todo)) allow();
if (!tarea.alcance?.length) {
  deny(
    `SIN ALCANCE DECLARADO: la tarea ${tarea.item} está abierta y todavía no dice qué archivos toca.\n` +
      `Planificá antes de escribir: \`${ampliar}\`.`,
  );
}
// Una escritura MCP sobre todo el proyecto o un directorio no se puede cruzar archivo por archivo:
// la verificación de la tarea cruza el diff entero después.
if (escrituraAmplia(input, config)) allow();
const afuera = targetPaths(input, config).filter((n) => !n.startsWith("..") && !dentroDelAlcance(n, alcance));
if (afuera.length) {
  deny(
    `FUERA DEL ALCANCE: \`${afuera[0]}\` no está en lo declarado para la tarea ${tarea.item} (${tarea.alcance.map((a) => a.ruta).join(", ")}).\n` +
      `Un cambio fuera de la tarea es el que nadie revisa. Si de verdad entra, ampliá el alcance con motivo: \`${ampliar}\`. Si no, no lo toques.`,
  );
}

allow();
