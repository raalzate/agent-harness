#!/usr/bin/env node
/**
 * Instala los hooks de git de este repo: `core.hooksPath=.githooks`.
 *
 * Era una línea en `package.json` con `&&` y comillas simples — que en `cmd.exe` de Windows no
 * significan lo que significan en bash: el comando fallaba o dejaba el `echo` pegado al valor.
 * El comando que instala los frenos es el último que puede darse el lujo de no correr en una
 * plataforma.
 *
 * Los hooks en sí son scripts de shell, y eso está bien: git los ejecuta con el bash que trae
 * Git for Windows. Lo que no puede depender de un shell es el camino hasta ellos.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIR = ".githooks";

if (!fs.existsSync(path.join(REPO_ROOT, DIR))) {
  console.error(`No existe \`${DIR}/\`: no hay hooks que instalar.`);
  process.exit(1);
}

const r = spawnSync("git", ["config", "core.hooksPath", DIR], { cwd: REPO_ROOT, stdio: "inherit" });
if (r.status !== 0) {
  console.error("No pude escribir `core.hooksPath`. ¿Estás dentro de un repo git?");
  process.exit(1);
}

console.log(`hooks de git instalados (core.hooksPath=${DIR})`);
if (process.platform === "win32") {
  // Un aviso que aparece una vez, cuando sirve: los hooks corren bajo el bash de Git for
  // Windows. Si alguien instaló git sin él, los hooks no fallan: no corren.
  console.log("En Windows los hooks corren con el bash que trae Git for Windows. Verificá: `git --exec-path`.");
}
