#!/usr/bin/env node
/**
 * Worktrees where they cannot hurt the gate.
 *
 *   node scripts/worktree-check.mjs        gate signal: exit 1 = a worktree inside the root that git does not ignore
 *
 * A worktree under the repo root is read by every scan of the repo (link-check, lint, searches)
 * as if its files were the repo's own: the gate goes red far from the cause (docs/gotchas.md).
 * Claude Code's `isolation: worktree` puts them there by design, so the rule cannot be «never
 * inside»: it is «never inside AND visible». An ignored folder is invisible to every scan.
 *
 * Orphans — a worktree whose branch is already merged into the base — are a WARNING, never red:
 * a leftover folder costs disk, not correctness, and the remove belongs to a human (no `--force`).
 *
 * Reads `worktrees` from the config (and `workflow.baseBranch` for orphans). Without the key it
 * does nothing. No network: git only.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

let config;
try {
  config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".claude", "harness.config.json"), "utf8"));
} catch {
  console.log("worktree-check: no readable config — nothing to check.");
  process.exit(0);
}
const spec = config.worktrees;
if (!spec || spec.enabled === false) {
  console.log("worktree-check: `worktrees` is not declared or not enabled — nothing to check.");
  process.exit(0);
}

const git = (...args) => {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
  return { ok: r.status === 0, out: r.stdout ?? "", status: r.status };
};

const listado = git("worktree", "list", "--porcelain");
if (!listado.ok) {
  // No git, no list: that is not «no worktrees». Red, so a broken check is never read as green.
  console.error("worktree-check: `git worktree list` failed — without the list nothing is verified.");
  process.exit(1);
}

// Porcelain: blocks separated by a blank line, `worktree <path>` first, then `branch refs/heads/<b>`.
const worktrees = listado.out
  .split(/\r?\n\r?\n/)
  .map((bloque) => {
    const linea = (k) => bloque.split(/\r?\n/).find((l) => l.startsWith(`${k} `))?.slice(k.length + 1);
    return { ruta: linea("worktree"), rama: linea("branch")?.replace(/^refs\/heads\//, "") };
  })
  .filter((w) => w.ruta);

// realpath on both sides: on macOS /tmp is /private/tmp, and git reports the resolved one.
// `.native`: on Windows the temp folder can arrive as an 8.3 short name (`RUNNER~1`) that the JS
// realpath keeps, while git reports the long one (`runneradmin`) — the worktree then looked
// OUTSIDE the root and the check went green with a visible worktree (CI, windows-latest).
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
const raiz = real(REPO_ROOT);
const visibles = [];
const huerfanos = [];
const base = config.workflow?.baseBranch;

for (const w of worktrees) {
  const ruta = real(w.ruta);
  if (ruta === raiz) continue; // the main checkout
  const rel = path.relative(raiz, ruta);
  const adentro = rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  if (adentro && git("check-ignore", "-q", rel.split(path.sep).join("/") + "/").status !== 0) visibles.push(rel.split(path.sep).join("/"));
  if (base && w.rama && w.rama !== base && git("merge-base", "--is-ancestor", w.rama, base).ok) huerfanos.push(`${w.ruta} (${w.rama})`);
}

for (const h of huerfanos)
  console.log(`worktree-check: AVISO — ${h}: la rama ya está integrada en ${base}. Borralo sin --force: \`git worktree remove <ruta>\`.`);

if (visibles.length) {
  console.error(
    `worktree-check: ${visibles.length} worktree(s) DENTRO de la raíz y sin ignorar:\n` +
      visibles.map((v) => `  - ${v}`).join("\n") +
      "\n\nCada escaneo del repo los lee como archivos propios y el gate se pone rojo lejos de la causa.\n" +
      "Movelo fuera de la raíz (`git worktree move <ruta> ../<nombre>`) o ignorá su carpeta en `.gitignore`.",
  );
  process.exit(1);
}
console.log(`worktree-check: OK — ${worktrees.length - 1} worktree(s) además del principal, ninguno visible dentro de la raíz.`);
