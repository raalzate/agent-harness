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
  // El comando de instalación sale del config: `npm run hooks:install` no existe en un
  // repo de .NET o de Java, y un aviso que nombra un comando inexistente se ignora.
  const instalar = config.gate?.installHooksCommand ?? "git config core.hooksPath .githooks";
  lines.push(`- ⚠️ pre-commit NO instalado (\`core.hooksPath\` ≠ \`.githooks\`). Corré \`${instalar}\`.`);
}

// Alerta: gate pendiente de una sesión anterior.
const marker = path.join(REPO_ROOT, config.gate?.marker ?? ".git/gate-dirty");
if (fs.existsSync(marker)) {
  lines.push(`- ⚠️ Gate pendiente de una sesión anterior: corré \`${config.gate?.command ?? "bash scripts/gate.sh"}\`.`);
}

// STATUS.md: estado verificado + deuda conocida.
const statusFile = path.join(REPO_ROOT, config.status?.file ?? "STATUS.md");
if (fs.existsSync(statusFile)) {
  const status = fs.readFileSync(statusFile, "utf8").split("\n").slice(0, 40).join("\n");
  lines.push("", "### STATUS.md (encabezado)", status);
} else {
  lines.push(`- ⚠️ Falta \`${config.status?.file ?? "STATUS.md"}\`: nadie sabe qué está verificado.`);
}

// El recordatorio también sale del config: es lo último que el agente lee al abrir la
// sesión, así que nombrar el comando de gate de OTRO stack lo vuelve ruido.
lines.push(
  "",
  // Vacío cuenta como ausente: la plantilla trae la clave con "" para que se llene.
  config.status?.reminder ||
    `Recordá: nada se entrega sin \`${config.gate?.command ?? "el gate"}\` verde · lecciones con \`/lesson\`.`,
);

allow(lines.join("\n"));
