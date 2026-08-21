#!/usr/bin/env node
/**
 * Stop — no se cierra la tarea con código editado y el gate sin correr.
 *
 * "Test verde ≠ compila ≠ entregable": el marcador `.git/gate-dirty` lo pone
 * `post-edit-check.mjs` en cada edición de código y lo borra `scripts/gate.sh`
 * cuando TODAS las señales salen verdes.
 */
import fs from "node:fs";
import path from "node:path";
import { readInput, loadConfig, deny, allow, REPO_ROOT } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();
if (!config) allow();

// Si el propio hook ya bloqueó una vez y el agente sigue en loop, no insistir.
if (input?.stop_hook_active) allow();

const marker = path.join(REPO_ROOT, config.gate?.marker ?? ".git/gate-dirty");
if (!fs.existsSync(marker)) allow();

deny(
  `GATE PENDIENTE: hay código editado en esta sesión y el gate no quedó verde.\n` +
    `Corré \`${config.gate?.command ?? "npm run gate"}\` (o el subagente \`gate-runner\`) y arreglá lo que salga rojo.\n` +
    `Si el trabajo no es entregable todavía, decilo explícitamente en el mensaje final: reportar "listo" sin gate verde es una violación, no un descuido.`,
);
