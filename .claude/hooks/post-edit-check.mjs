#!/usr/bin/env node
/**
 * PostToolUse Write|Edit|MultiEdit — el freno de mayor retorno.
 *
 * Corre el lint del repo SOBRE EL ARCHIVO TOCADO y devuelve el error real al agente
 * (archivo, línea, mensaje), en vez de dejar que se entere en el gate diez ediciones
 * después. El typecheck completo es demasiado lento por edición: vive en el gate.
 *
 * Además marca `.git/gate-dirty` para que el hook Stop sepa que hay código sin verificar.
 */
import { spawnSync } from "node:child_process";
import { readInput, loadConfig, deny, allow, targetPath, markGateDirty, underAny, REPO_ROOT } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();
if (!config) allow();

const rel = targetPath(input);
if (!rel || rel.startsWith("..")) allow();

// Sólo código: editar un .md no ensucia el gate.
const isCode = /\.(ts|tsx|mjs|js|jsx)$/.test(rel) && underAny(rel, config.gate?.codeGlobs ?? []);
if (isCode) markGateDirty(config);

if (!isCode) allow();

const [cmd, ...baseArgs] = config.lint?.command ?? [];
if (!cmd) allow();

const res = spawnSync(cmd, [...baseArgs, config.lint?.fileFlag ?? "--file", rel], {
  cwd: REPO_ROOT,
  encoding: "utf8",
});

if (res.status && res.status !== 0) {
  deny(
    `LINT DEL REPO EN ROJO tras editar \`${rel}\`:\n\n` +
      `${(res.stdout || "").trim()}\n${(res.stderr || "").trim()}\n\n` +
      `Leé el error, corregí la causa y volvé a editar. No reintentes sin hipótesis nueva.`,
  );
}

allow();
