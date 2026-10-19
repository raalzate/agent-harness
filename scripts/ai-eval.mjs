#!/usr/bin/env node
/**
 * ai-eval — the AI evaluation of the subagents, run by promptfoo.
 *
 * `scripts/reviewer-eval.mjs` runs each reviewer case ONCE and reads only the verdict. That hid a
 * rotten label: an innocent case the config had overtaken was rejected 3/3 — rightly — and with
 * one run the rate (5/6) stayed above the threshold. Measuring a probabilistic judge needs
 * repeats, and a k/n per case tells the two failures apart:
 *
 *  - 0/n: wrong every time. Look at the LABEL before blaming the agent.
 *  - 0 < k < n: unstable. That is the judge, and it is what the rate is for.
 *
 * It also covers the subagents nobody had measured (gate-runner, ci-investigator, explorer) and
 * reports the quality of the answer with an llm-rubric judge, informative only.
 *
 * promptfoo is a RUNNER, not a dependency: it is invoked as `aiEval.runner` (npx, pinned
 * version), never installed in package.json. Without it, or on a node older than it needs, the
 * eval is SKIPPED — and skipped is not green. The verdict is ours: this script reads promptfoo's
 * JSON output and computes the rate per suite against `aiEval.minScore`; promptfoo's own exit
 * code (100 when any assertion fails) does not decide anything.
 *
 * Agnostic: agents, commands, context, cases, rubrics and thresholds come from `aiEval`. The
 * verdict line of each agent is its `subagentOutput.contracts` pattern (the reviewer's comes
 * from `reviewerEval`, with its cases): one definition of "verdict", read by the hook and here.
 *
 * NOT a gate signal (expensive, not deterministic, needs an account). Run it by hand when an
 * agent's prompt changes; see docs/evaluaciones.md.
 *
 *   node scripts/ai-eval.mjs                     # every suite
 *   node scripts/ai-eval.mjs --only=<agent>      # one suite
 *   node scripts/ai-eval.mjs --case=<name>       # one case
 *   node scripts/ai-eval.mjs --repeat=<n>        # override aiEval.repeat
 *   node scripts/ai-eval.mjs --keep              # keep the run dir to open it with `promptfoo view`
 *   [--config <path>]                            # bait configs of the self-test (P7)
 *
 * Exit: 0 = every suite at or above minScore, or SKIPPED · 1 = a suite below minScore (RED), a
 * CLI that did not answer (BROKEN: infrastructure, not the agent) or a misdeclared suite.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existeEjecutable } from "../.claude/hooks/harness.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROVIDER = path.join(REPO_ROOT, "scripts", "eval", "ai-provider.mjs");
const args = process.argv.slice(2);
const flag = (name) => {
  const withEquals = args.find((a) => a.startsWith(`${name}=`));
  if (withEquals) return withEquals.slice(name.length + 1);
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
};
const configPath = flag("--config") ? path.resolve(flag("--config")) : path.join(REPO_ROOT, ".claude", "harness.config.json");
// Bait configs resolve their files next to themselves; the real one, against the repo root.
const base = flag("--config") ? path.dirname(configPath) : REPO_ROOT;
const ONLY = flag("--only");
const CASE = flag("--case");
const KEEP = args.includes("--keep");

const fail = (msg) => {
  console.error(`ai-eval: ${msg}`);
  process.exit(1);
};
const skipped = (msg) => {
  console.log(`ai-eval: SKIPPED — ${msg} Skipped is not green.`);
  process.exit(0);
};

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {
  skipped("no readable config.");
}
const spec = config.aiEval;
if (!spec?.runner?.length || !(spec.suites ?? []).length) skipped("the repo declares no `aiEval.runner` and `aiEval.suites`.");

const newer = (have, need) => {
  const a = String(have).split(".").map(Number);
  const b = String(need).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};
if (spec.minNode && !newer(process.versions.node, spec.minNode))
  skipped(`the runner needs node >= ${spec.minNode} and this is node ${process.versions.node}.`);
if (!existeEjecutable(spec.runner[0])) skipped(`\`${spec.runner[0]}\` (aiEval.runner) is not installed on this machine.`);

// ---- suites, resolved from the config -------------------------------------------------------

const DEFAULT_PROMPT = "{input}";
const suites = [];
for (const s of spec.suites) {
  if (ONLY && s.agent !== ONLY) continue;
  let { command, context, prompt, verdictPattern, cases } = s;
  if (s.casesFrom) {
    // The reviewer's cases, command, context and verdict already live in `reviewerEval`.
    const from = config[s.casesFrom];
    if (!from?.cases) fail(`the suite \`${s.agent}\` takes its cases from \`${s.casesFrom}\`, which declares none.`);
    command ??= from.command;
    context ??= from.context;
    prompt ??= from.prompt;
    verdictPattern ??= from.verdictPattern;
    cases = from.cases.map((c) => ({ ...c, input: c.input ?? c.diff }));
  }
  command ??= (spec.command ?? []).map((a) => a.split("{agent}").join(s.agent));
  verdictPattern ??= config.subagentOutput?.contracts?.[s.agent]?.mustMatch;
  if (!command.length) fail(`the suite \`${s.agent}\` has no command (aiEval.command).`);
  if (!existeEjecutable(command[0])) skipped(`\`${command[0]}\` (the command of \`${s.agent}\`) is not installed on this machine.`);
  const resolved = [];
  for (const c of cases ?? []) {
    if (CASE && c.name !== CASE) continue;
    if (c.expect && !verdictPattern) fail(`«${c.name}» expects \`${c.expect}\`, but \`${s.agent}\` has no verdict pattern (subagentOutput.contracts).`);
    let input;
    try {
      input = fs.readFileSync(path.join(base, c.input), "utf8");
    } catch {
      fail(`the case «${c.name}» points at \`${c.input}\`, which does not exist.`);
    }
    const rubric = c.rubric ?? s.rubrics?.[String(c.expect ?? "").toLowerCase()] ?? s.rubric;
    resolved.push({ ...c, input, rubric });
  }
  if (resolved.length) suites.push({ agent: s.agent, command, context: context ?? [], prompt: prompt ?? DEFAULT_PROMPT, verdictPattern, cases: resolved });
}
if (!suites.length) fail(`no case matches${ONLY ? ` --only=${ONLY}` : ""}${CASE ? ` --case=${CASE}` : ""}.`);

// ---- the promptfoo config, generated in a temporary dir (never in this tree, P7) -------------

const repeat = Number(flag("--repeat") ?? spec.repeat ?? 1);
const timeoutMs = spec.timeoutMs ?? 300000;
const providerId = `file://${PROVIDER.split(path.sep).join("/")}`;
const tests = suites.flatMap((s, i) =>
  s.cases.map((c) => ({
    description: `${s.agent} · ${c.name}`,
    // One pass: an input that happens to contain `{input}` is not expanded twice.
    vars: { suite: i, prompt: s.prompt.replace(/\{(input|diff)\}/g, () => c.input) },
    metadata: { suite: i, case: c.name },
    // Weight 0: the rubric is reported, it does not decide. The verdict is computed below.
    assert: c.rubric ? [{ type: "llm-rubric", metric: "quality", weight: 0, value: c.rubric }] : [],
  })),
);
const pfConfig = {
  description: "harness AI eval (generated by scripts/ai-eval.mjs from aiEval)",
  prompts: ["{{prompt}}"],
  providers: [{ id: providerId, label: "agent", config: { role: "agent", base, timeoutMs, suites: suites.map(({ agent, command, context }) => ({ agent, command, context })) } }],
  tests,
};
if (tests.some((t) => t.assert.length)) {
  if (!spec.grader?.length) fail("there are rubrics but no `aiEval.grader`: the rubric needs a judge.");
  pfConfig.defaultTest = { options: { provider: { id: providerId, config: { role: "grader", command: spec.grader, timeoutMs } } } };
}
const run = fs.mkdtempSync(path.join(os.tmpdir(), "harness-ai-eval-"));
const cfgFile = path.join(run, "promptfooconfig.json");
const outFile = path.join(run, "results.json");
fs.writeFileSync(cfgFile, JSON.stringify(pfConfig, null, 2));

const calls = tests.length * repeat;
console.log(`AI evaluation — ${suites.length} suite(s), ${tests.length} case(s) × ${repeat} = ${calls} agent call(s), via \`${spec.runner.join(" ")}\`\n`);
const r = spawnSync(
  spec.runner[0],
  [...spec.runner.slice(1), "eval", "-c", cfgFile, "--no-cache", "--no-share", "-j", String(spec.concurrency ?? 1), "--repeat", String(repeat), "-o", outFile],
  {
    cwd: run,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === "win32",
    // promptfoo keeps its database under PROMPTFOO_CONFIG_DIR: in the run dir, not in ~/.promptfoo.
    env: { ...process.env, PROMPTFOO_CONFIG_DIR: path.join(run, ".promptfoo"), ...(spec.env ?? {}) },
  },
);
const cleanup = () => {
  if (KEEP) console.log(`\nRun kept in ${run} · PROMPTFOO_CONFIG_DIR=${path.join(run, ".promptfoo")} ${spec.runner.join(" ")} view`);
  else fs.rmSync(run, { recursive: true, force: true });
};

let rows;
try {
  rows = JSON.parse(fs.readFileSync(outFile, "utf8")).results.results;
} catch {
  const tail = `${r.stderr ?? ""}${r.stdout ?? ""}`.trim().split("\n").slice(-5).join("\n");
  cleanup();
  fail(`AI EVAL BROKEN — the runner wrote no results (exit ${r.status ?? r.error?.code}).\n${tail}`);
}

// ---- our verdict ------------------------------------------------------------------------------

const broken = rows.filter((x) => x.error || x.response?.error || !String(x.response?.output ?? "").trim());
if (broken.length) {
  const first = broken[0];
  console.error(
    `AI EVAL BROKEN — ${broken.length}/${rows.length} call(s) got no answer (first: «${first.testCase?.description}»: ${first.error ?? first.response?.error ?? "empty output"}).\n` +
      "That is the infrastructure (key, quota, network, timeout), not the agent: fix it and run again. Broken is neither green nor skipped.",
  );
  cleanup();
  process.exit(1);
}

function judge(s, c, output) {
  if (c.expect) {
    const m = new RegExp(s.verdictPattern, "i").exec(output);
    const said = (m?.[1] ?? "").toLowerCase();
    if (!said) return "no verdict line";
    if (said !== String(c.expect).toLowerCase()) return `said «${said}», expected «${String(c.expect).toLowerCase()}»`;
  }
  if (c.mustCite && !output.includes(c.mustCite)) return `does not cite ${c.mustCite}`;
  for (const p of c.mustMatch ?? []) if (!new RegExp(p, "im").test(output)) return `missing /${p}/`;
  for (const p of c.mustNotMatch ?? []) if (new RegExp(p, "im").test(output)) return `has /${p}/`;
  return "";
}

let red = false;
for (const [i, s] of suites.entries()) {
  let hits = 0;
  let total = 0;
  const lines = [];
  for (const c of s.cases) {
    const mine = rows.filter((x) => x.testCase?.metadata?.suite === i && x.testCase?.metadata?.case === c.name);
    const misses = [];
    const quality = [];
    for (const x of mine) {
      const why = judge(s, c, String(x.response.output));
      if (why) misses.push(why);
      // The rubric score lives in the grading of each row: weight-0 metrics read 0 in namedScores.
      const q = (x.gradingResult?.componentResults ?? []).find((p) => p.assertion?.type === "llm-rubric");
      if (typeof q?.score === "number") quality.push(q.score);
    }
    const k = mine.length - misses.length;
    hits += k;
    total += mine.length;
    const q = quality.length ? `quality ${(quality.reduce((a, b) => a + b, 0) / quality.length).toFixed(2)}` : "quality -";
    const note =
      !misses.length ? "" : k === 0 ? ` — ${misses[0]}; wrong every time: check the label before blaming the agent` : ` — unstable: ${misses[0]}`;
    lines.push(`  ${k === mine.length ? "✓" : "✗"} ${k}/${mine.length}  ${q}  ${c.name}${note}`);
  }
  const rate = total ? hits / total : 0;
  const min = Number(spec.minScore ?? 1);
  const ok = rate + 1e-9 >= min;
  if (!ok) red = true;
  console.log(`${s.agent} — ${hits}/${total} (${Math.round(rate * 100)} %) · min ${Math.round(min * 100)} % ${ok ? "" : "· BELOW"}`);
  for (const l of lines) console.log(l);
  console.log("");
}
cleanup();
if (red) {
  console.error(
    "AI EVAL RED — a suite is below minScore. Read the ✗ cases: a 0/n is usually a label the config overtook; " +
      "an unstable one is the agent's prompt. What is not done is lowering the threshold so it passes.",
  );
  process.exit(1);
}
console.log("AI EVAL GREEN — every suite at or above minScore.");
