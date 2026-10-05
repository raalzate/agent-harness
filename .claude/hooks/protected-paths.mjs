#!/usr/bin/env node
/**
 * PreToolUse Write|Edit|MultiEdit|mcp__* — rutas protegidas.
 *
 * Pilar 4: secretos, artefactos derivados e historia de git no los toca el agente.
 * La excepción legítima es que el humano haga el cambio él mismo.
 *
 * Las herramientas MCP que escriben (`writeTools`) pasan por acá igual que `Edit`: el freno
 * protege la RUTA, no la herramienta con que se llega. Las de lectura salen en la primera línea.
 */
import { readInput, loadConfig, deny, allow, targetPath, targetPaths, firstMatch, escribe, esHerramientaMcp } from "./harness.mjs";

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

allow();
