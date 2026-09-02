#!/usr/bin/env node
/**
 * PreToolUse Write|Edit|MultiEdit — rutas protegidas.
 *
 * Pilar 4: secretos, artefactos derivados e historia de git no los toca el agente.
 * La excepción legítima es que el humano haga el cambio él mismo.
 */
import { readInput, loadConfig, deny, allow, targetPath, targetPaths, firstMatch } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();
if (!config) allow();

const rel = targetPath(input);
if (!rel) allow();

// Fuera del repo: no es asunto de este hook.
if (rel.startsWith("..")) allow();

// Se evalúan TODOS los nombres que el archivo tiene dentro del repo, no sólo el escrito: un
// symlink interno (`alias/ → src/secreto/`) es otro nombre de una ruta que ya tiene dueño, y
// prohibir por un nombre mientras el otro pasa es no prohibir. Basta que UNO case.
for (const nombre of targetPaths(input)) {
  const hit = firstMatch(config.protectedPaths, nombre);
  if (hit) {
    deny(
      `RUTA PROTEGIDA: \`${nombre}\` no se edita desde el agente.\n` +
        (nombre === rel ? "" : `(pedido como \`${rel}\`, que es un alias de esa ruta)\n`) +
        `Motivo: ${hit.reason}\n` +
        `Si el cambio hace falta de verdad, pedíselo al humano y que lo haga él.`,
    );
  }
}

allow();
