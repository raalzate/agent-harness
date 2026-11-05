/**
 * UserPromptSubmit — «consultá el índice antes de abrir archivos».
 *
 * El pedido «¿dónde está X?» o «¿quién usa Y?» se contesta con un subgrafo, no
 * leyendo el árbol: eso es lo que dice la guía de buenas prácticas del arnés y lo
 * que hasta ahora era sólo prosa. Este hook lo pone en el camino del agente.
 *
 * Callado a propósito en dos casos: si el grafo no está construido (no hay nada
 * que consultar) y si el pedido no es una pregunta sobre el código. Un hook que
 * habla siempre deja de leerse.
 */
import { readInput, loadConfig, allow } from "./harness.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();
const prompt = String(input?.prompt ?? "");
if (!config?.graph || !prompt.trim()) allow();

const graphFile = path.join(REPO_ROOT, config.graph.graphFile);
if (!fs.existsSync(graphFile)) allow();

const pega = (config.graph.questionPatterns ?? []).some((p) => {
  try {
    return new RegExp(p, "i").test(prompt);
  } catch {
    return false; // patrón inválido: lo caza el self-test, no el turno del usuario
  }
});
if (!pega) allow();

// El panorama es OPCIONAL y hay de dos formas: un archivo de reporte (`reportFile`) o un
// comando que lo abre (`panoramaCommand`). Citar una clave ausente imprimía `undefined`, y
// un aviso que nombra algo inexistente se ignora entero — con él, el resto del aviso.
const panorama = config.graph.reportFile
  ? `Panorama: \`${config.graph.reportFile}\`.`
  : config.graph.panoramaCommand
    ? `Panorama: \`${config.graph.panoramaCommand}\`.`
    : "";

// La frontera entre los dos índices es la FUENTE, no la forma de la pregunta: el código es de
// este índice (y del `explorer`); lo que vive bajo `library.root` es de la biblioteca (y de su
// subagente). Sin nombrarlo acá, «¿dónde está documentado X?» casa `questionPatterns` y el agente
// buscaba docs en el grafo del código. Si el pedido además casa la ruta de la biblioteca, es
// mixto: los dos subagentes, en paralelo, cada uno con su fuente.
const lib = config.library;
const docsAgent = lib ? (lib.agent ?? "librarian") : null;
const docsRoute = lib ? (config.sdd?.routes ?? []).find((r) => r.route === (lib.route ?? "library")) : null;
const mixta =
  docsRoute &&
  (docsRoute.patterns ?? []).some((p) => {
    try {
      return new RegExp(p, "i").test(prompt);
    } catch {
      return false;
    }
  });

allow(
  [
    "## Índice del repo (hook graph-first)",
    `- Hay grafo construido en \`${config.graph.graphFile}\`: **consultalo antes de abrir archivos**.`,
    `- \`${config.graph.queryCommand}\` devuelve un subgrafo (símbolo, archivo, relación, radio de impacto) en vez del árbol completo.`,
    `- Abrir archivos es el ÚLTIMO recurso, y sólo el fragmento que el índice señaló: leer de más es la forma cara de contestar con la mitad del mapa.`,
    `- El subagente \`explorer\` sigue valiendo para lo que el índice no cubre en el CÓDIGO (strings, comentarios, config).`,
    docsAgent ? `- La documentación (\`${lib.root ?? "docs"}/\`) NO es de este índice: es del subagente \`${docsAgent}\`, que consulta la biblioteca.` : null,
    mixta ? `- **Pregunta mixta (código y documentación):** lanzá \`explorer\` y \`${docsAgent}\` en PARALELO, en el mismo mensaje, cada uno con su fuente; después cruzá las dos respuestas.` : null,
    panorama ? "" : null,
    panorama || null,
  ]
    .filter((l) => l !== null)
    .join("\n"),
);
