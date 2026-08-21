#!/usr/bin/env node
/**
 * SessionStart — estado verificado al empezar, para no releer el repo entero.
 *
 * Imprime rama, commit, cambios sin commitear, STATUS.md y las alertas del arnés
 * (pre-commit sin instalar, gate pendiente). Todo lo que salga por stdout entra
 * al contexto: se mantiene corto a propósito.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readInput, loadConfig, allow, REPO_ROOT } from "./harness.mjs";

await readInput();
const config = loadConfig() ?? {};

const git = (args) => spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).stdout?.trim() ?? "";

const lines = ["## Estado del repo (hook SessionStart)"];

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const head = git(["log", "-1", "--pretty=%h %s"]);
const dirty = git(["status", "--porcelain"]).split("\n").filter(Boolean);

lines.push(`- Rama: \`${branch}\` · HEAD: ${head}`);
lines.push(
  dirty.length
    ? `- Sin commitear: ${dirty.length} archivo(s) — ${dirty.slice(0, 5).map((l) => l.slice(3)).join(", ")}${dirty.length > 5 ? ", …" : ""}`
    : "- Working tree limpio.",
);

// Alerta: el pre-commit del repo tiene que estar realmente instalado (no .sample).
const hooksPath = git(["config", "core.hooksPath"]);
if (hooksPath !== ".githooks") {
  lines.push("- ⚠️ pre-commit NO instalado (`core.hooksPath` ≠ `.githooks`). Corré `npm run hooks:install`.");
}

// Alerta: gate pendiente de una sesión anterior.
const marker = path.join(REPO_ROOT, config.gate?.marker ?? ".git/gate-dirty");
if (fs.existsSync(marker)) {
  lines.push(`- ⚠️ Gate pendiente de una sesión anterior: corré \`${config.gate?.command ?? "npm run gate"}\`.`);
}

// STATUS.md: estado verificado + deuda conocida.
const statusFile = path.join(REPO_ROOT, config.status?.file ?? "STATUS.md");
if (fs.existsSync(statusFile)) {
  const status = fs.readFileSync(statusFile, "utf8").split("\n").slice(0, 40).join("\n");
  lines.push("", "### STATUS.md (encabezado)", status);
} else {
  lines.push(`- ⚠️ Falta \`${config.status?.file ?? "STATUS.md"}\`: nadie sabe qué está verificado.`);
}

lines.push(
  "",
  "Recordá: nada se entrega sin `npm run gate` verde · índice de símbolos (Serena) antes de abrir archivos · lecciones con `/lesson`.",
);

allow(lines.join("\n"));
