#!/usr/bin/env node
/**
 * ¿Los artefactos de trabajo están donde el equipo decidió que estuvieran?
 *
 *   node scripts/artifacts-check.mjs              # señal del gate
 *   node scripts/artifacts-check.mjs --dir <ruta> # contra otro directorio (self-test)
 *
 * Un equipo decide si los specs, planes y tareas viven **en el repo** o **en el gestor
 * de trabajo**. Las dos opciones son defendibles; lo que no es defendible es tener las
 * dos a medias, que es donde se termina sin un freno: alguien deja un `plan.md` "por
 * ahora", y seis meses después la mitad del trabajo está en un lado y la mitad en el otro,
 * sin que nadie sepa cuál manda.
 *
 * **No toca la red.** Es una comprobación de sistema de archivos contra `tracker` del
 * config, así que corre en el gate y en CI igual, y sirve para GitHub, GitLab, Azure
 * Boards, Jira o lo que use el equipo: este script no conoce ninguna forja.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".claude", "harness.config.json"), "utf8"));
const tracker = config.tracker ?? {};

const dirFlag = process.argv.indexOf("--dir");
const raiz = dirFlag !== -1 ? path.resolve(process.argv[dirFlag + 1]) : REPO_ROOT;
const specsDir = tracker.specsDir ?? "specs";
const permitidos = new Set(tracker.allowedInRepo ?? []);

if (!tracker.artifactsIn) {
  console.log("artifacts-check: omitido (el config no declara `tracker.artifactsIn`).");
  process.exit(0);
}

const abs = path.join(raiz, specsDir);

// Decisión «en el repo»: lo único verificable es que el directorio exista. Que el
// contenido esté completo lo juzga una persona (el `reviewer`), no una máquina.
if (tracker.artifactsIn === "repo") {
  if (!fs.existsSync(abs)) {
    console.error(
      `artifacts-check: el config dice que los artefactos viven en el repo, pero \`${specsDir}/\` no existe.\n` +
        "O se crea el directorio, o `tracker.artifactsIn` está mintiendo.",
    );
    process.exit(1);
  }
  console.log(`artifacts-check: OK — artefactos en el repo (\`${specsDir}/\`).`);
  process.exit(0);
}

// Decisión «en el gestor de trabajo»: nada bajo specsDir salvo lo explícitamente
// permitido (un README que explique dónde buscar, típicamente).
if (!fs.existsSync(abs)) {
  console.log(`artifacts-check: OK — artefactos en el gestor de trabajo (no hay \`${specsDir}/\`).`);
  process.exit(0);
}

const intrusos = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else {
      const rel = path.relative(raiz, p).split(path.sep).join("/");
      if (!permitidos.has(rel)) intrusos.push(rel);
    }
  }
};
walk(abs);

if (intrusos.length) {
  console.error(
    `artifacts-check: ${intrusos.length} artefacto(s) en el repo, y este equipo decidió que viven en el gestor de trabajo:\n` +
      intrusos.map((f) => `  - ${f}`).join("\n") +
      `\n\nO se mueven al gestor (donde se pueden asignar y cerrar), o se agregan a\n` +
      "`tracker.allowedInRepo` con su motivo. Tener las dos cosas a medias es el estado que este freno evita.",
  );
  process.exit(1);
}

console.log(`artifacts-check: OK — \`${specsDir}/\` sin artefactos sueltos.`);
