#!/usr/bin/env node
/**
 * UserPromptSubmit — «una pregunta se contesta; una acción se pide».
 *
 * El arnés tenía frenos para QUÉ se toca, CÓMO, cuándo se cierra y si queda registrado.
 * No tenía ninguno para **si correspondía actuar**: el usuario preguntaba y el agente se
 * iba a editar archivos. Todas las rutas del router asumían que había un cambio por
 * delante; ninguna decía «esto no se toca, se contesta».
 *
 * Este hook clasifica el pedido y, si es una pregunta SIN verbo de acción, deja un
 * marcador que `action-guard.mjs` lee antes de cualquier edición dentro del repo.
 * El marcador lo limpia el siguiente pedido del usuario: la fuga es humana, a propósito.
 *
 * Deliberadamente ANGOSTO: sólo caza interrogación explícita (empieza con «¿», termina
 * con «?», o arranca con una palabra interrogativa). Un clasificador ancho bloquearía
 * instrucciones legítimas, y un freno que muerde de más se desactiva a mano en una semana.
 */
import fs from "node:fs";
import path from "node:path";
import { readInput, loadConfig, allow, REPO_ROOT } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();
const spec = config?.askFirst;
if (!spec?.marker) allow();

const prompt = String(input?.prompt ?? "").trim();
const marker = path.join(REPO_ROOT, spec.marker);

/** Borra el marcador: el pedido de este turno no es una pregunta. */
const limpiar = () => {
  try {
    fs.rmSync(marker, { force: true });
  } catch {
    /* sin marcador, el guard deja pasar: el arnés no bloquea por estar roto */
  }
};

if (!prompt) {
  limpiar();
  allow();
}

const casa = (patrones) =>
  (patrones ?? []).some((p) => {
    try {
      return new RegExp(p, "i").test(prompt);
    } catch {
      return false; // patrón inválido: lo caza el self-test, no el turno del usuario
    }
  });

// Un verbo de acción gana sobre la forma interrogativa: «¿podés arreglar X?» es una orden
// educada, no una consulta. Pero el MISMO verbo en pasado pregunta por lo que ya pasó
// —«¿aplicaste eso?», «¿lo cambiaste?»— y ahí la respuesta es contestar, no volver a
// actuar. Ese caso es el que originó este hook, así que el pasado gana sobre la acción.
const esPregunta = casa(spec.questionPatterns);

// Una pregunta que ARRANCA con interrogativo («cómo se instala X», «qué hace Y») nombra el
// verbo de acción como TEMA, no como orden. Lo que la vuelve orden es un pedido directo
// —«¿podés…?», «por favor…»—, no la mera presencia del verbo.
const preguntaFuerte = casa(spec.strongQuestionPatterns);
const pedidoDirecto = casa(spec.directRequestPatterns);
const verboDeAccion = casa(spec.actionPatterns) && !casa(spec.pastPatterns);
const esAccion = verboDeAccion && (pedidoDirecto || !preguntaFuerte);

if (!esPregunta || esAccion) {
  limpiar();
  allow();
}

try {
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, `${new Date().toISOString()}\n${prompt.slice(0, 500)}\n`);
} catch {
  /* si no se puede marcar, queda el aviso en el contexto y nada más */
}

allow(
  [
    "## Pedido informativo (hook ask-first)",
    "",
    spec.message ??
      "Esto es una **pregunta**: contestala. No edites archivos salvo que el usuario lo pida.",
    "",
    "Si al contestar concluís que hace falta un cambio, **proponelo y esperá**: el humano lo pide en su próximo mensaje.",
  ].join("\n"),
);
