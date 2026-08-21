#!/usr/bin/env node
/**
 * UserPromptSubmit — pone el criterio de ruteo delante del agente ANTES de que edite.
 *
 * No bloquea (la intención no es verificable por máquina): informa. La regla dura es que
 * saltarse SDD sea una decisión declarada, no un silencio. Reglas en
 * `.claude/harness.config.json` → `sdd`; criterio completo en `docs/harness/sdd.md`.
 */
import { readInput, loadConfig, allow } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();
if (!config) allow();

const prompt = String(input?.prompt ?? "");
if (!prompt.trim()) allow();

const messages = [];
for (const route of config.sdd?.routes ?? []) {
  if (!route.message) continue;
  const hit = (route.patterns ?? []).some((p) => {
    try {
      return new RegExp(p, "i").test(prompt);
    } catch {
      return false;
    }
  });
  if (hit) messages.push(`- **${route.route}** · ${route.message}`);
}

// Silencio en lo trivial: un router que habla siempre deja de leerse.
if (!messages.length) allow();

allow(
  ["## Ruteo del arnés (hook sdd-router)", ...messages, "", "Criterio completo: `docs/harness/sdd.md`. El gate no cambia por tener o no spec."].join(
    "\n",
  ),
);
