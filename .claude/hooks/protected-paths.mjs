#!/usr/bin/env node
/**
 * PreToolUse Write|Edit|MultiEdit — rutas protegidas.
 *
 * Pilar 4: secretos, artefactos derivados e historia de git no los toca el agente.
 * La excepción legítima es que el humano haga el cambio él mismo.
 */
import { readInput, loadConfig, deny, allow, targetPath, firstMatch } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();
if (!config) allow();

const rel = targetPath(input);
if (!rel) allow();

// Fuera del repo: no es asunto de este hook.
if (rel.startsWith("..")) allow();

const hit = firstMatch(config.protectedPaths, rel);
if (hit) {
  deny(
    `RUTA PROTEGIDA: \`${rel}\` no se edita desde el agente.\n` +
      `Motivo: ${hit.reason}\n` +
      `Si el cambio hace falta de verdad, pedíselo al humano y que lo haga él.`,
  );
}

allow();
