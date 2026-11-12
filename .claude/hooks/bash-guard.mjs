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

const command = typeof input?.tool_input?.command === "string" ? input.tool_input.command : "";
if (!command) allow();

// Lo que el shell borra antes de ejecutar no cambia el comando, pero sí su texto: `--ha''rd`,
// `--ha""rd` y `g\it` son `--hard` y `git` para bash, y para un regex son otra cosa. Las reglas
// se miden contra el texto Y contra esta forma: un freno que se esquiva con dos comillas no frena.
// Sólo se quitan las comillas VACÍAS y la barra delante de una letra: lo que nunca cambia el
// significado, para no morder de más (un mensaje de commit con comillas sigue igual).
const desarmado = command.replace(/''|""/g, "").replace(/\\(?=[A-Za-z0-9_-])/g, "");
const casa = (reglas) => firstMatch(reglas, command) ?? (desarmado !== command ? firstMatch(reglas, desarmado) : null);

const hit = casa(config.bash?.deny);
if (hit) {
  deny(
    `COMANDO BLOQUEADO: \`${command}\`\n` +
      `Motivo: ${hit.reason}\n` +
      `Reformulá el comando, o pedile al humano que lo corra él. No lo reintentes igual.`,
  );
}

// `exempt` es la forma segura y verificable de un comando que en general se pregunta: si el
// comando ENTERO casa `exempt`, no hace falta el sí del humano. Sin esto, una pregunta que
// sale veinte veces por día se contesta «sí» sin leer, y deja de proteger justo el caso raro.
// El regex se escribe anclado (`^…$`) para que un `&& otra-cosa` encadenado no herede la exención.
// `exempt` hereda los `flags` de su regla: una regla que distingue mayúsculas no puede eximir sin distinguirlas.
// Y se mide sólo contra el texto ORIGINAL, no contra el desarmado: la regla busca el peligro en
// las dos formas (más amplio = más seguro), la exención exige la forma declarada al pie de la
// letra (más estricto = más seguro). Medirla contra el desarmado dejaría que `g''it` heredara
// la exención de la forma limpia.
const confirmar = (config.bash?.ask ?? []).find(
  (regla) => casa([regla]) && !(regla.exempt && firstMatch([{ pattern: regla.exempt, flags: regla.flags }], command)),
);
if (confirmar) ask(`CONFIRMACIÓN DEL HUMANO: ${confirmar.reason}`, input);

allow();
