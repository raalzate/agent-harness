#!/usr/bin/env node
/**
 * PreToolUse Write|Edit|MultiEdit|mcp__* — el freno que faltaba: **no actúes cuando no corresponde**.
 *
 * Lee dos marcadores, los dos levantados por el próximo pedido del humano (`ask-first.mjs`):
 *
 *  - `askFirst.marker`: el pedido del turno fue informativo. Se contesta, no se ejecuta.
 *  - `loop.marker`: el gate agotó el presupuesto de intentos sobre el mismo error. Otro intento
 *    sin hipótesis nueva es el bucle sin límite; lo que corresponde es parar y escalar.
 *
 * Mientras alguno esté puesto, ninguna edición DENTRO del repo pasa. La fuga es humana y
 * explícita: si quería el cambio, o tiene la respuesta a la escalada, lo dice.
 *
 * Dos decisiones que lo hacen convivible (ley 4: un freno que muerde de más se desactiva):
 *
 *  - **No bloquea fuera del repo.** Un borrador en el scratchpad para armar la respuesta
 *    (o el diagnóstico de la escalada) es parte de contestar, no de actuar.
 *  - **No se consume solo.** Insistir con la misma edición vuelve a fallar: el camino es
 *    contestar y proponer, no reintentar.
 */
import fs from "node:fs";
import path from "node:path";
import { readInput, loadConfig, deny, allow, targetPath, escribe, escrituraAmplia, rutaDeEstado } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();

/** El marcador declarado en `rel`, si está puesto; su contenido (sin la fecha), recortado. */
const puesto = (rel) => {
  if (!rel) return null;
  const abs = rutaDeEstado(rel);
  if (!fs.existsSync(abs)) return null;
  try {
    return fs.readFileSync(abs, "utf8").split("\n").slice(1).join(" ").trim().slice(0, 300);
  } catch {
    return ""; // existe pero no se pudo leer: alcanza con que exista
  }
};

const pregunta = puesto(config?.askFirst?.marker);
const agotado = puesto(config?.loop?.marker);
if (pregunta === null && agotado === null) allow();
if (!escribe(input, config)) allow(); // leer con un servidor MCP es parte de contestar

// Una escritura MCP sobre todo el proyecto o un directorio no trae archivo, pero cae DENTRO.
const amplia = escrituraAmplia(input, config);
const rel = amplia ? `${input?.tool_name} (sin archivo: todo el proyecto o un directorio)` : targetPath(input, config);
// Fuera del repo (scratchpad, temporales): escribir ahí es parte de pensar la respuesta.
if (!amplia && (!rel || rel.startsWith(".."))) allow();

// El presupuesto agotado va primero: es el estado más grave, y su mensaje es el que destraba.
if (agotado !== null) {
  deny(
    `PRESUPUESTO DE INTENTOS AGOTADO: el gate falló con el mismo error más veces que \`loop.maxAttempts\` y estás por editar \`${rel}\`.\n` +
      (agotado ? `Error: ${agotado.slice(0, 180)}\n` : "") +
      `\nParar y escalar: contale al humano qué falla (archivo, línea, mensaje), qué probaste y por qué no anduvo, y tu próxima hipótesis. ` +
      `Su próximo mensaje repone el presupuesto y este freno se levanta solo.\n` +
      `No reintentes la misma edición: el marcador no se consume.`,
  );
}

deny(
  `NO ACTÚES SOBRE UNA PREGUNTA: el pedido de este turno era informativo y estás por editar \`${rel}\`.\n` +
    (pregunta ? `Pedido: «${pregunta.slice(0, 180)}»\n` : "") +
    `\nContestá la pregunta. Si al contestarla concluís que hace falta un cambio, **proponelo en una línea y esperá**: ` +
    `el humano lo pide en su próximo mensaje y este freno se levanta solo.\n` +
    `No reintentes la misma edición: el marcador no se consume.`,
);
