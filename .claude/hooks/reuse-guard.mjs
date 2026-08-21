#!/usr/bin/env node
/**
 * PreToolUse Write|Edit|MultiEdit — boilerplate que ya tiene abstracción.
 *
 * Evita el fallo más caro y más silencioso: reimplementar algo que el repo ya resuelve
 * (el registro de notaciones, el puente de preload, el cliente de nube del main).
 * El catálogo vive en `docs/architecture/reuse-patterns.md`; las reglas en la config.
 */
import { readInput, loadConfig, deny, allow, targetPath, proposedContent } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();
if (!config) allow();

const rel = targetPath(input);
const content = proposedContent(input);
if (!rel || !content) allow();

for (const rule of config.reuse ?? []) {
  let scope;
  let pattern;
  try {
    scope = new RegExp(rule.appliesTo);
    pattern = new RegExp(rule.pattern);
  } catch {
    continue;
  }
  if (!scope.test(rel)) continue;
  if (!pattern.test(content)) continue;

  deny(
    `REUSO: esto ya tiene abstracción en el repo (${rel}).\n` +
      `Motivo: ${rule.reason}\n` +
      `Mirá primero: ${rule.see} · catálogo completo en docs/architecture/reuse-patterns.md`,
  );
}

allow();
