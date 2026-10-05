#!/usr/bin/env node
/**
 * PreToolUse Bash — comandos irreversibles o que saltan la verificación.
 *
 * El incidente arquetípico de la guía (un `sed -i` amplio sobre el directorio fuente)
 * es una de las reglas de `.claude/harness.config.json` → `bash.deny`.
 *
 * Dos niveles, porque «pedí confirmación» y «bloqueado» no son lo mismo:
 *  - `bash.deny` bloquea (exit 2). Para lo que nadie debería correr desde el agente.
 *  - `bash.ask` le pasa la decisión al HUMANO (P9: mostrar, esperar confirmación, ejecutar).
 *    Antes esas reglas vivían en `deny` con un motivo que decía «pedí confirmación», y la
 *    confirmación no servía de nada: el humano decía que sí y el hook volvía a bloquear.
 * `deny` gana: un comando que casa las dos listas se bloquea.
 */
import { readInput, loadConfig, deny, allow, ask, firstMatch } from "./harness.mjs";

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
      `Reformulá el comando, o pedile al humano que lo corra él. No lo reintentes igual.`,
  );
}

const confirmar = firstMatch(config.bash?.ask, command);
if (confirmar) ask(`CONFIRMACIÓN DEL HUMANO: ${confirmar.reason}`, input);

allow();
