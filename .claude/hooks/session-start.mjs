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
import { readInput, loadConfig, allow, tareaActiva, rutaDeEstado, REPO_ROOT } from "./harness.mjs";

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

// Alerta: la rama ya está atrás de la base. Sin `fetch` —la red no se paga en cada sesión—:
// con las refs que hay, que es lo mismo que va a ver el agente si arranca a trabajar ahora.
// Es la mitad temprana del freno de sincronía; la otra mitad, con red, es el pre-push.
const sync = config.workflow?.sync;
const base = config.workflow?.baseBranch;
if (sync?.enabled && base && branch && branch !== "HEAD") {
  const ref = `${sync.remote ?? "origin"}/${base}`;
  const atras = Number(git(["rev-list", "--count", `HEAD..${ref}`])) || 0;
  if (atras) {
    lines.push(
      branch === base
        ? `- ⚠️ \`${branch}\` local está ${atras} commit(s) atrás de \`${ref}\`: una rama abierta desde acá nace vieja. \`git pull --ff-only\` antes de abrirla.`
        : `- ⚠️ \`${branch}\` está ${atras} commit(s) atrás de \`${ref}\`: ponete al día antes de seguir (\`${sync.command ?? `git rebase ${ref}`}\`), no en el PR.`,
    );
  }
}

// Alerta: el pre-commit del repo tiene que estar realmente instalado (no .sample).
const hooksPath = git(["config", "core.hooksPath"]);
if (hooksPath !== ".githooks") {
  // El comando de instalación sale del config: `npm run hooks:install` no existe en un
  // repo de .NET o de Java, y un aviso que nombra un comando inexistente se ignora.
  const instalar = config.gate?.installHooksCommand ?? "git config core.hooksPath .githooks";
  lines.push(`- ⚠️ pre-commit NO instalado (\`core.hooksPath\` ≠ \`.githooks\`). Corré \`${instalar}\`.`);
}

// Alerta: gate pendiente de una sesión anterior.
const marker = rutaDeEstado(config.gate?.marker ?? ".git/gate-dirty");
if (fs.existsSync(marker)) {
  lines.push(`- ⚠️ Gate pendiente de una sesión anterior: corré \`${config.gate?.command ?? "node scripts/gate.mjs"}\`.`);
}

// La tarea declarada que quedó abierta: es lo primero que hay que retomar, y sin decirlo el
// agente arranca otra cosa y `protected-paths` lo frena sin que entienda por qué.
const tarea = tareaActiva(config);
if (tarea) {
  const sinEvidencia = (tarea.criterios ?? []).filter((c) => !c.evidencia).length;
  lines.push(
    `- Tarea abierta: **${tarea.item}** · alcance: ${tarea.alcance?.length ? tarea.alcance.map((a) => `\`${a.ruta}\``).join(", ") : "SIN DECLARAR"} · ` +
      `${tarea.criterios?.length ?? 0} criterio(s), ${sinEvidencia} sin evidencia. \`node scripts/task.mjs status\`.`,
  );
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
