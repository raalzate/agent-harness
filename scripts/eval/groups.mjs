/**
 * The three groups of the deterministic eval, grouped by WHEN the piece acts (the same groups
 * as docs/guias-y-sensores.md):
 *
 *  - guides:  before the agent decides — what reaches it from the prompt, and whether every
 *             reason a guard gives says what to do next;
 *  - rules:   before a tool runs — block, approve or allow;
 *  - signals: after acting — closing the turn, right after a write, a subagent closing, a commit.
 *
 * Every runner returns rows with the same shape: { group, id, kind, lang, expected, actual,
 * pass, note, ... }. Scoring and reporting live in harness-eval.mjs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runEvent, strictest, isolated, inPool, installedConfig, hookName, seed, exec } from "./hooks.mjs";

const broken = (runs) => runs.find((r) => r.status !== 0 && r.status !== 2);
const brokenReason = (r) => `${hookName(r)} exit ${r.status}: ${r.stderr.trim().slice(0, 200)}`;
const exists = (root, rel) => Boolean(rel) && fs.existsSync(path.join(root, rel));
const latencies = (runs) => runs.map((r) => r.ms);

/** The session history of a case: today, earlier human prompts, in order. */
async function replay(root, events, history) {
  for (const step of history ?? []) await runEvent(root, events.prompt, { prompt: step.text });
}

// ── rules ────────────────────────────────────────────────────────────────────

export async function runRules(root, set, items) {
  return inPool(items, async (it) => {
    const decideIn = async (where) => {
      await replay(where, set.events, it.before);
      // `{root}` in an argument is the root of the evaluated repo: Claude Code sends absolute
      // paths, and the set cannot know where the temp dir lives.
      const tool_input = JSON.parse(JSON.stringify(it.args).split("{root}").join(where.split("\\").join("/")));
      const runs = await runEvent(where, set.events.tool, { tool_name: it.tool, tool_input }, it.tool);
      return { ...strictest(runs), latencies: latencies(runs) };
    };
    const d = it.before?.length || it.state ? await isolated(root, it.state, decideIn) : await decideIn(root);
    const caught = d.decision === "block" || d.decision === "approve";
    const pass = d.decision === "error" ? false : it.expected === "allow" ? d.decision === "allow" : it.gap ? !caught : caught;
    return {
      group: "rules",
      id: it.id,
      kind: it.category,
      variant: it.variant,
      lang: it.lang ?? null,
      expected: it.expected,
      actual: d.decision,
      pass,
      hook: d.hook,
      reason: d.reason,
      gap: it.gap ?? null,
      note: it.note,
      latencies: d.latencies,
    };
  });
}

// ── guides ───────────────────────────────────────────────────────────────────

async function guide(where, set, config, it) {
  const runs = await runEvent(where, set.events.prompt, { prompt: it.text });
  const row = { group: "guides", id: it.id, kind: it.type, lang: it.lang ?? null, expected: it.expected, note: it.note, latencies: latencies(runs) };
  const bad = broken(runs);
  if (bad) return { ...row, actual: "error", pass: false, detail: brokenReason(bad) };
  if (it.type === "intent") {
    // The question marker is what `action-guard` reads; without the key, nothing marks it.
    const actual = exists(where, config?.askFirst?.marker) ? "question" : "action";
    return { ...row, actual, pass: actual === it.expected };
  }
  const said = runs.map((r) => r.stdout.trim()).filter(Boolean).join("\n");
  const actual = said ? "injects" : "silent";
  const missing = (it.contains ?? []).filter((c) => !said.includes(c));
  const pass = it.expected === "silent" ? !said : Boolean(said) && !missing.length;
  return { ...row, actual, pass, detail: missing.length ? `missing ${missing.join(", ")}` : said.split("\n")[0]?.slice(0, 120) };
}

export async function runGuides(root, set, items) {
  const config = installedConfig(root);
  // A prompt can leave the question marker, so guides never run on the base install (the rules
  // run there at the same time). `intent` reads that marker: one private copy per case. The
  // routing cases only read what was said: they share one copy, which saves dozens of copies.
  return isolated(root, null, (shared) =>
    inPool(items, (it) =>
      it.type === "intent" || it.state ? isolated(shared, it.state, (where) => guide(where, set, config, it)) : guide(shared, set, config, it),
    ),
  );
}

/**
 * Every reason a guard gave in the rules run, judged as a guide: it is the only thing the agent
 * reads when it is stopped, and «blocked» without «what to do» is retried as is.
 */
export function judgeReasons(set, ruleRows) {
  const crit = set.guides.reasonCriteria;
  const nextStep = crit.nextStep.map((p) => new RegExp(p, "iu"));
  const rows = [];
  for (const r of ruleRows.filter((x) => (x.actual === "block" || x.actual === "approve") && !x.gap)) {
    const text = String(r.reason ?? "");
    const long = text.length >= crit.minLength;
    const says = nextStep.some((re) => re.test(text));
    rows.push({
      group: "guides",
      id: `reason-${r.id}`,
      kind: "reason",
      lang: null,
      expected: "explains",
      actual: long && says ? "explains" : "vague",
      pass: long && says,
      note: `the reason ${r.hook} gives for ${r.id}`,
      detail: long ? (says ? "" : "says what and why, not what to do next") : `shorter than ${crit.minLength} characters`,
      latencies: [],
    });
  }
  return rows;
}

// ── signals ──────────────────────────────────────────────────────────────────

/** Applies a Write/Edit to disk, so PostToolUse sees the tool's effect (the lint reads the file). */
function applyWrite(root, tool, args) {
  const rel = args.file_path;
  if (!rel) return;
  const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
  if (!abs.startsWith(root)) return; // outside the repo: not the eval's business to write there
  if (tool === "Write") {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, args.content ?? "");
  } else if (tool === "Edit" && fs.existsSync(abs)) {
    fs.writeFileSync(abs, fs.readFileSync(abs, "utf8").replace(args.old_string ?? "", args.new_string ?? ""));
  }
}

/** A real `git commit` through the installed git hooks. */
async function commit(root, staged, message) {
  const git = (argv) => exec("git", ["-c", "core.hooksPath=.githooks", "-c", "user.name=harness-eval", "-c", "user.email=eval@example.test", ...argv], { cwd: root });
  const msgDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-eval-msg-"));
  try {
    const file = path.join(msgDir, "COMMIT_EDITMSG");
    fs.writeFileSync(file, `${message}\n`);
    const add = await git(["add", "-f", "--", ...Object.keys(staged)]);
    if (add.status !== 0) return { status: null, out: add.stderr, ms: 0 };
    const r = await git(["commit", "-q", "-F", file]);
    return { status: r.status, out: `${r.stdout}${r.stderr}`.trim(), ms: r.ms };
  } finally {
    fs.rmSync(msgDir, { recursive: true, force: true });
  }
}

export async function runSignals(root, set, items) {
  const config = installedConfig(root);
  const gateMarker = config?.gate?.marker;
  // A subagent closing only reads what it said: no copy. Everything else leaves or reads state.
  const readOnly = (it) => it.type === "subagent-end" && !it.state;
  return inPool(items, (it) => (readOnly(it) ? signal(root, it) : isolated(root, it.state, (where) => signal(where, it))));

  async function signal(where, it) {
    {
      const row = { group: "signals", id: it.id, kind: it.type, lang: it.lang ?? null, expected: it.expected, note: it.note };
      if (it.type === "commit") {
        seed(where, it.staged);
        const r = await commit(where, it.staged, it.message);
        if (r.status === null) return { ...row, actual: "error", pass: false, detail: `git add failed: ${r.out.trim().slice(0, 160)}`, latencies: [] };
        const actual = r.status === 0 ? "passes" : "blocks";
        return { ...row, actual, pass: actual === it.expected, detail: r.out.split("\n")[0]?.slice(0, 160), latencies: [r.ms] };
      }
      let runs;
      if (it.type === "after-edit") {
        applyWrite(where, it.tool, it.args);
        runs = await runEvent(where, set.events.afterTool, { tool_name: it.tool, tool_input: it.args, tool_response: { success: true }, ...it.payload }, it.tool);
      } else {
        runs = await runEvent(where, it.type === "turn-end" ? set.events.turnEnd : set.events.subagentEnd, { ...it.payload });
      }
      const bad = broken(runs);
      if (bad) return { ...row, actual: "error", pass: false, detail: brokenReason(bad), latencies: latencies(runs) };
      const stopped = runs.some((r) => r.status === 2);
      const actual =
        it.type === "turn-end" ? (stopped ? "asks-gate" : "closes")
        : it.type === "subagent-end" ? (stopped ? "returns" : "closes")
        : stopped ? "warns" : exists(where, gateMarker) ? "marks-gate" : "passes";
      return { ...row, actual, pass: actual === it.expected, latencies: latencies(runs) };
    }
  }
}
