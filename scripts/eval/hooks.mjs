/**
 * The plumbing of the deterministic eval: install the harness in a temporary repo and run its
 * hooks exactly as Claude Code would (payload on stdin, cwd at the repo root, the exit-code
 * contract of docs/decisions/0004-contrato-de-hooks.md).
 *
 * Nothing here knows about cases: groups.mjs decides what to run and how to read it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

/** Writes {path: content} under `root`. Paths are relative to the temporary repo. */
export function seed(root, files) {
  for (const [rel, content] of Object.entries(files ?? {})) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/** A fresh install: `git init`, `harness-init --apply`, an optional config on top, the toy repo. */
export function install({ repoRoot, profile, configPath, files }) {
  // realpath: on macOS the temp dir sits behind a symlink, and the hook's root comes resolved.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "harness-eval-")));
  spawnSync("git", ["init", "-q"], { cwd: root });
  const init = ["scripts/harness-init.mjs", root, "--apply", ...(profile ? ["--profile", profile] : [])];
  const r = spawnSync(process.execPath, init, { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`harness-init failed (exit ${r.status}): ${`${r.stderr}${r.stdout}`.trim().slice(-400)}`);
  if (configPath) fs.copyFileSync(configPath, path.join(root, ".claude", "harness.config.json"));
  seed(root, files);
  return root;
}

/** The installed config, read the way the hooks read it. Broken = null (the hooks let it pass). */
export function installedConfig(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, ".claude", "harness.config.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Runs `fn` on a private copy of the install with `state` seeded. Every case that leaves or
 * reads session state (a marker, a ledger, a staged file) gets one: the marker a question leaves
 * would block every edit that comes after it.
 */
export async function isolated(root, state, fn) {
  const copy = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "harness-eval-case-")));
  try {
    await fs.promises.cp(root, copy, { recursive: true });
    seed(copy, state);
    return await fn(copy);
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

/** The hooks settings.json runs for `event` and, when the event has a matcher, for `tool`. */
export function hooksFor(root, event, tool) {
  const settings = JSON.parse(fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"));
  return (settings.hooks?.[event] ?? [])
    .filter((g) => !g.matcher || tool === undefined || new RegExp(`^(?:${g.matcher})$`).test(tool))
    .flatMap((g) => (g.hooks ?? []).filter((h) => h.type === "command").map((h) => h.command));
}

/**
 * Runs a process without blocking the event loop. Never throws. Asynchronous on purpose: a
 * `spawnSync` here stalls the whole pool, so the cases run in series and every latency measured
 * meanwhile includes the wait (a 1 s commit showed up as a 17 s p95).
 */
export function exec(executable, argv, { cwd, input = "" } = {}) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const child = spawn(executable, argv, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => resolve({ status: null, stdout, stderr: e.message, ms: 0 }));
    child.on("close", (status) => resolve({ status, stdout, stderr, ms: Number(process.hrtime.bigint() - t0) / 1e6 }));
    // A hook may decide without reading all of stdin and exit: the write then fails with EPIPE.
    // Unhandled, that error killed the whole eval (CI on main); the exit code is what counts.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** Runs one hook command with `payload` on stdin, at the repo root. Never throws. */
export async function runHook(root, command, payload) {
  const [cmd, ...rest] = command.split(/\s+/);
  const executable = cmd === "node" ? process.execPath : cmd;
  return { command, ...(await exec(executable, rest, { cwd: root, input: JSON.stringify(payload) })) };
}

/**
 * Every hook of `event` (filtered by `tool`), in parallel like Claude Code runs them.
 * `payload` is the event-specific input; the common fields are added here.
 */
export async function runEvent(root, event, payload, tool) {
  const input = { cwd: root, session_id: "harness-eval", hook_event_name: event, ...payload };
  return Promise.all(hooksFor(root, event, tool).map((c) => runHook(root, c, input)));
}

export const hookName = (run) => path.basename(run.command.split(/\s+/).pop());

/**
 * The decision of ONE hook, under the Claude Code contract: exit 2 blocks (stderr is the
 * reason); exit 0 with `permissionDecision` decides that; exit 0 with nothing lets it through.
 * Any other exit is a broken hook: Claude Code treats it as a non-blocking error —the tool
 * runs—, and the eval reports it red.
 */
export function decisionOf(run) {
  if (run.status === 2) return { decision: "block", reason: run.stderr.trim() };
  if (run.status !== 0) return { decision: "error", reason: `exit ${run.status}: ${run.stderr.trim().slice(0, 200)}` };
  try {
    const out = JSON.parse(run.stdout.trim().split("\n").pop() || "{}");
    const d = out?.hookSpecificOutput?.permissionDecision;
    const reason = out?.hookSpecificOutput?.permissionDecisionReason ?? "";
    if (d === "deny") return { decision: "block", reason };
    if (d === "ask") return { decision: "approve", reason };
  } catch {
    // stdout that is not JSON: context for the agent, not a decision
  }
  return { decision: "allow", reason: "" };
}

// Several hooks on the same call: the strictest wins, as in Claude Code (deny > ask).
const RANK = { error: 3, block: 2, approve: 1, allow: 0 };

/** The combined decision of several runs, with the hook that made it. */
export function strictest(runs) {
  let final = { decision: "allow", reason: "", hook: null };
  for (const r of runs) {
    const d = decisionOf(r);
    if (RANK[d.decision] > RANK[final.decision]) final = { ...d, hook: hookName(r) };
  }
  return final;
}

/** A pool the size of the machine: a hundred node start-ups in series are seconds of gate. */
export async function inPool(items, fn, n = os.availableParallelism?.() ?? os.cpus().length) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}
