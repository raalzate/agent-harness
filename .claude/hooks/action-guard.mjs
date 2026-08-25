#!/usr/bin/env node
/**
 * PreToolUse Write|Edit|MultiEdit — el freno que faltaba: **no actúes sobre una pregunta**.
 *
 * Lee el marcador que deja `ask-first.mjs` cuando el pedido del turno fue informativo.
 * Mientras esté puesto, ninguna edición DENTRO del repo pasa. Lo limpia el siguiente
 * pedido del usuario, así que la fuga es humana y explícita: si quería el cambio, lo pide.
 *
 * Dos decisiones que lo hacen convivible (ley 4: un freno que muerde de más se desactiva):
 *
 *  - **No bloquea fuera del repo.** Un borrador en el scratchpad para armar la respuesta
 *    es parte de contestar, no de actuar.
 *  - **No se consume solo.** Insistir con la misma edición vuelve a fallar: el camino es
 *    contestar y proponer, no reintentar.
 */
import fs from "node:fs";
import path from "node:path";
import { readInput, loadConfig, deny, allow, targetPath, REPO_ROOT } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();
const spec = config?.askFirst;
if (!spec?.marker) allow();

const marker = path.join(REPO_ROOT, spec.marker);
if (!fs.existsSync(marker)) allow();

const rel = targetPath(input);
// Fuera del repo (scratchpad, temporales): escribir ahí es parte de pensar la respuesta.
if (!rel || rel.startsWith("..")) allow();

let pedido = "";
try {
  pedido = fs.readFileSync(marker, "utf8").split("\n").slice(1).join(" ").trim().slice(0, 180);
} catch {
  /* el marcador existe pero no se pudo leer: alcanza con que exista */
}

deny(
  `NO ACTÚES SOBRE UNA PREGUNTA: el pedido de este turno era informativo y estás por editar \`${rel}\`.\n` +
    (pedido ? `Pedido: «${pedido}»\n` : "") +
    `\nContestá la pregunta. Si al contestarla concluís que hace falta un cambio, **proponelo en una línea y esperá**: ` +
    `el humano lo pide en su próximo mensaje y este freno se levanta solo.\n` +
    `No reintentes la misma edición: el marcador no se consume.`,
);
