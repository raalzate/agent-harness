#!/usr/bin/env node
/**
 * Launch one coder as a MAIN session inside its own worktree, outside the repo root.
 *
 *   node scripts/coder-spawn.mjs --unit <slug> --branch <branch> --brief <file>            dry-run: what would happen
 *   node scripts/coder-spawn.mjs --unit <slug> --branch <branch> --brief <file> --apply    do it
 *
 * Why not only `isolation: worktree` from the Agent tool: a subagent cannot launch subagents, so a
 * coder started that way cannot ask the `librarian` or the `explorer`; and Claude Code puts those
 * worktrees under the repo root. Here the coder is the main session of its own process: it can
 * delegate, its hooks are anchored to ITS worktree (the session opens inside it, docs/worktrees.md
 * rule 2), and the folder lives next to the repo, not inside it (rule 1).
 *
 * Everything specific comes from `coder` in the config: the command that runs the agent (the brief
 * goes by stdin, never interpolated into argv), where worktrees go, what prepares one before the
 * agent measures anything (`setupCommand`: dependencies a worktree does not bring). The branch has
 * to match `workflow.branchPattern`, and the base is `workflow.baseBranch`.
 *
 * The run's verdict is the coder's own `ENTREGA:` line (`subagentOutput.contracts.coder.mustMatch`):
 * without it the run failed, whatever the exit code — an agent that closes without its verdict
 * hands back an opinion. The full transcript goes to `.git/` (P7), never to the source tree.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, CONFIG_PATH, prepararLanzamiento, rutaDeEstado } from "../.claude/hooks/harness.mjs";
const lanzarSync = (argv, opciones) => spawnSync(...prepararLanzamiento(argv, opciones));

const fallar = (msg) => {
  console.error(`coder-spawn: ${msg}`);
  process.exit(1);
};

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
} catch {
  fallar("no readable config.");
}
const spec = config.coder;
if (!spec?.command?.length) fallar("the config declares no `coder.command`: there is no agent to launch.");

const args = process.argv.slice(2);
const opcion = (n) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};
const unidad = opcion("--unit");
const rama = opcion("--branch");
const brief = opcion("--brief");
const aplicar = args.includes("--apply");

if (!unidad || !/^[a-z0-9][a-z0-9._-]*$/.test(unidad)) fallar("`--unit <slug>` is required (lowercase, digits, . _ -): it names the worktree folder.");
if (!rama) fallar("`--branch <branch>` is required.");
if (!brief || !fs.existsSync(brief)) fallar("`--brief <file>` is required and must exist: the spec slice, criteria, scope and the files that belong to other coders.");

const patron = config.workflow?.branchPattern;
if (patron) {
  let re;
  try {
    re = new RegExp(patron);
  } catch {
    fallar("`workflow.branchPattern` does not compile.");
  }
  if (!re.test(rama)) fallar(`branch \`${rama}\` does not match \`workflow.branchPattern\` (${patron}): commit-msg and CI would reject it later.`);
}

const base = config.workflow?.baseBranch ?? "main";
const git = (...a) => spawnSync("git", a, { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
// The freshest base there is: the remote one when it exists (a branch from a days-old local main is
// how PRs start with conflicts). No fetch here: the network is the caller's decision.
const desde = git("rev-parse", "--verify", "-q", `origin/${base}`).status === 0 ? `origin/${base}` : base;

const dirWt = path.resolve(REPO_ROOT, spec.worktreeDir || "..");
const destino = path.join(dirWt, `wt-${unidad}`);
const rel = path.relative(REPO_ROOT, destino);
if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) fallar(`\`coder.worktreeDir\` puts the worktree INSIDE the repo root (${rel}): every scan would read it as the repo's own (docs/gotchas.md).`);
if (fs.existsSync(destino)) fallar(`\`${destino}\` already exists: one unit, one worktree. Resume it there, or remove it (without --force) first.`);
if (git("rev-parse", "--verify", "-q", `refs/heads/${rama}`).status === 0) fallar(`branch \`${rama}\` already exists: two coders never share a branch.`);

const setup = Array.isArray(spec.setupCommand) && spec.setupCommand.length ? spec.setupCommand : null;
const plan = [
  `git worktree add ${destino} -b ${rama} ${desde}`,
  ...(setup ? [`(in the worktree) ${setup.join(" ")}`] : []),
  `(in the worktree) ${spec.command.join(" ")} < ${brief}`,
];
if (!aplicar) {
  console.log(`coder-spawn: DRY-RUN — nothing created. With --apply:\n${plan.map((p) => `  ${p}`).join("\n")}`);
  process.exit(0);
}

const alta = git("worktree", "add", destino, "-b", rama, desde);
if (alta.status !== 0) fallar(`git worktree add failed: ${`${alta.stderr}`.trim().split("\n")[0]}`);

const enWt = (argv, input) =>
  lanzarSync(argv, {
    cwd: destino,
    input,
    encoding: "utf8",
    timeout: Number(spec.timeoutMs) > 0 ? Number(spec.timeoutMs) : 3600000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });

if (setup) {
  const s = enWt(setup);
  // A setup that failed invalidates the run: the coder would measure a tree without its dependencies.
  if (s.status !== 0) fallar(`setupCommand failed in ${destino} (${s.error?.code ?? `exit ${s.status}`}): the worktree stays for inspection; remove it without --force.`);
}

const r = enWt(spec.command, fs.readFileSync(brief, "utf8"));
const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
try {
  const log = rutaDeEstado(path.posix.join(".git", "coder-runs", `${unidad}.log`));
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, salida);
  console.log(`coder-spawn: transcript → ${log}`);
} catch {
  /* a transcript that could not be written is less evidence, not a failed run */
}

const contrato = config.subagentOutput?.contracts?.coder?.mustMatch;
let veredicto = null;
if (contrato) {
  try {
    veredicto = salida.match(new RegExp(contrato))?.[0] ?? null;
  } catch {
    fallar("`subagentOutput.contracts.coder.mustMatch` does not compile.");
  }
}
if (r.error) fallar(`the agent did not run (${r.error.code ?? r.error.message}). Worktree: ${destino}.`);
if (contrato && !veredicto) fallar(`the coder closed WITHOUT its verdict line (\`${contrato}\`), exit ${r.status}: that is an opinion, not a delivery. Worktree: ${destino}.`);
console.log(`coder-spawn: ${unidad} · ${rama} · ${destino}\n${veredicto ?? `exit ${r.status}`}`);
process.exit(r.status === 0 ? 0 : 1);
