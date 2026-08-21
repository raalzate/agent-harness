#!/usr/bin/env node
/**
 * PreToolUse Bash — comandos irreversibles o que saltan la verificación.
 *
 * El incidente arquetípico de la guía (un `sed -i` amplio sobre el directorio fuente)
 * es una de las reglas de `.claude/harness.config.json` → `bash.deny`.
 */
import { readInput, loadConfig, deny, allow, firstMatch } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();
if (!config) allow();

const command = input?.tool_input?.command ?? "";
if (!command) allow();

const hit = firstMatch(config.bash?.deny, command);
if (hit) {
  deny(
    `COMANDO BLOQUEADO: \`${command}\`\n` +
      `Motivo: ${hit.reason}\n` +
      `Reformulá el comando o pedí confirmación explícita al humano. No lo reintentes igual.`,
  );
}

allow();
