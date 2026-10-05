#!/usr/bin/env node
/**
 * SubagentStop — un subagente no cierra sin el contrato de salida que el config le declara.
 *
 * El `reviewer` y el `gate-runner` son sensores: lo que devuelven decide si algo se entrega. Su
 * formato (`VEREDICTO: …`) vivía sólo en la prosa de su definición, y un subagente que cerraba
 * con «se ve bien» devolvía una opinión sin veredicto que el agente principal tomaba como
 * aprobación. Este hook lo frena en el borde: si el último mensaje no casa `mustMatch`, el exit 2
 * le devuelve el turno al SUBAGENTE con el motivo, y el agente principal recibe la salida
 * completa o nada.
 *
 * Qué agentes y qué formato salen del config (`subagentOutput.contracts`), no de acá: el hook no
 * conoce ningún agente por nombre. Un agente sin contrato pasa. Falla abierto si falta el mensaje
 * o el regex no compila (P5): eso lo caza el self-test, no el turno del humano.
 */
import { readInput, loadConfig, deny, allow } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();
if (!config) allow();

// Ya se lo devolvimos una vez: insistir es un loop, y el formato lo sigue viendo el humano.
if (input?.stop_hook_active) allow();

const contrato = config.subagentOutput?.contracts?.[input?.agent_type];
if (!contrato?.mustMatch) allow();

const mensaje = input?.last_assistant_message;
if (typeof mensaje !== "string") allow();

let re;
try {
  // `i`: «VEREDICTO: Aprobado» es un veredicto, igual que lo lee `reviewer-eval`; `m`: la línea
  // puede estar en cualquier parte del mensaje, no sólo al principio.
  re = new RegExp(contrato.mustMatch, "im");
} catch {
  allow();
}
if (re.test(mensaje)) allow();

deny(
  `SALIDA SIN CONTRATO: el subagente \`${input.agent_type}\` está por cerrar sin lo que su salida exige ` +
    `(\`${contrato.mustMatch}\`).\n` +
    `Motivo: ${contrato.reason ?? "quien te delegó decide con esa línea; sin ella, tu salida es una opinión."}\n` +
    `Terminá con el formato de la sección «Salida» de tu definición. No repitas el trabajo: agregá lo que falta.`,
);
