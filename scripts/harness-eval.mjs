#!/usr/bin/env node
/**
 * harness-eval — the DETERMINISTIC evaluation of the harness.
 *
 * The self-test already proves that every rule catches its sample, but that proof is
 * tautological: the sample comes from the rule itself. This evaluation asks something else,
 * with a labelled set that does NOT come from the config, grouped by WHEN the piece acts:
 *
 *  - guides:  does what orients the agent reach it? (the prompt routed, a question told apart
 *             from an action, a block that says what to do next) — in Spanish and in English;
 *  - rules:   does a guard hold against another way of asking for the same thing, and does it
 *             let through what only looks like an attack?
 *  - signals: is what happened after acting seen? (the gate left pending, a subagent without its
 *             verdict line, a commit without its work item)
 *
 * The label says what a GOOD harness should do, not what it does today. An attack known to get
 * through carries a `gap` and does not count against; caught one day, it turns the eval red: a
 * gap closed without anyone knowing is documentation that lies.
 *
 * Deterministic and offline: same input, same output. That is why it is a gate signal, and not
 * a scheduled sweep like the `reviewer` eval (scripts/reviewer-eval.mjs), the model-based family.
 *
 * What gets evaluated: the FRESHLY INSTALLED harness (`harness-init --apply` with the declared
 * profile, in a temporary repo), because that is what ships. `--config <path>` evaluates another
 * config on the same install. Hooks run as Claude Code runs them, inside the temporary repo:
 * whatever markers they leave never touch this tree (P7).
 *
 * The set is validated against its schema before anything runs (`harnessEval.schema`), and
 * `--json` prints a report that follows `harnessEval.reportSchema`.
 *
 *   node scripts/harness-eval.mjs                     # the whole set, summary report
 *   node scripts/harness-eval.mjs --detail            # every case with its result
 *   node scripts/harness-eval.mjs --group=rules       # one group (guides | rules | signals)
 *   node scripts/harness-eval.mjs --only=<id>         # a single case
 *   node scripts/harness-eval.mjs --json              # the machine-readable report on stdout
 *   node scripts/harness-eval.mjs --save              # .txt and .json in <set dir>/measurements/
 *   [--profile <stack>] [--config <path>] [--cases <path>]
 *
 * Exit: 0 = above the thresholds, or SKIPPED (the repo declares no `harnessEval`) · 1 = below a
 * threshold, a gap that closed, a broken hook or a set that does not match its schema.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./eval/schema.mjs";
import { install } from "./eval/hooks.mjs";
import { runGuides, runRules, runSignals, judgeReasons } from "./eval/groups.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const GROUPS = ["guides", "rules", "signals"];
const args = process.argv.slice(2);
const flag = (name) => {
  const withEquals = args.find((a) => a.startsWith(`${name}=`));
  if (withEquals) return withEquals.slice(name.length + 1);
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
};
const DETAIL = args.includes("--detail");
const SAVE = args.includes("--save");
const JSON_OUT = args.includes("--json");
const ONLY = flag("--only");
const GROUP = flag("--group");

let spec;
try {
  spec = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".claude", "harness.config.json"), "utf8")).harnessEval ?? null;
} catch {
  spec = null;
}
const casesPath = flag("--cases") ? path.resolve(flag("--cases")) : spec?.cases ? path.join(REPO_ROOT, spec.cases) : null;
if (!casesPath || !spec?.schema) {
  console.log("harness-eval: SKIPPED — the repo declares no `harnessEval.cases` and `harnessEval.schema`.");
  process.exit(0);
}
const profile = flag("--profile") ?? spec.profile ?? null;
const configPath = flag("--config") ? path.resolve(flag("--config")) : null;
const rel = (p) => path.relative(REPO_ROOT, p).split(path.sep).join("/") || p;

const readJson = (p, what) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`harness-eval: cannot read ${what} \`${rel(p)}\`: ${e.message}`);
    process.exit(1);
  }
};
const set = readJson(casesPath, "the set");
const schema = readJson(path.join(REPO_ROOT, spec.schema), "the schema");

// ── The set is validated before measuring ────────────────────────────────────
// A mislabelled case measures wrong in silence: an «innocent» expecting `block` inflates the
// recall, a typo in a key is a case that never runs. Better red, with the path named. The ids
// are checked here because uniqueness across groups is not something the schema subset says.
const problems = validate(schema, set);
const seen = new Set();
for (const g of GROUPS) {
  for (const it of set?.[g]?.items ?? []) {
    if (seen.has(it.id)) problems.push(`/${g}: repeated id \`${it.id}\``);
    seen.add(it.id);
  }
}
if (problems.length) {
  console.error(`harness-eval: the set is malformed — it does not match \`${spec.schema}\` (${problems.length}):`);
  for (const p of problems.slice(0, 30)) console.error(`  · ${p}`);
  process.exit(1);
}
if (GROUP && !GROUPS.includes(GROUP)) {
  console.error(`harness-eval: unknown group \`${GROUP}\`; groups: ${GROUPS.join(", ")}`);
  process.exit(1);
}
const pick = (g) => (GROUP && GROUP !== g ? [] : set[g].items.filter((it) => !ONLY || it.id === ONLY));
if (ONLY && !GROUPS.some((g) => pick(g).length)) {
  console.error(`harness-eval: there is no case named \`${ONLY}\`.`);
  process.exit(1);
}

// ── Metrics ──────────────────────────────────────────────────────────────────

const ratio = (a, b) => (b ? a / b : null);
const pct = (r) => (r === null ? "—" : `${Math.round(100 * r)} %`);
const percentile = (xs, p) => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const failedOf = (r) => ({ id: r.id, kind: r.kind, lang: r.lang, expected: r.expected, actual: r.actual, note: r.note, detail: r.detail ?? r.gap ?? r.hook ?? "" });

function scored(rows, minScore) {
  const byKind = {};
  for (const r of rows) {
    byKind[r.kind] ??= { total: 0, passed: 0 };
    byKind[r.kind].total += 1;
    if (r.pass) byKind[r.kind].passed += 1;
  }
  const passed = rows.filter((r) => r.pass).length;
  return { total: rows.length, passed, score: ratio(passed, rows.length), minScore, byKind, failed: rows.filter((r) => !r.pass).map(failedOf) };
}

function rulesSummary(rows, thresholds) {
  const count = (rs) => {
    const attacks = rs.filter((r) => r.expected !== "allow" && !r.gap);
    const caughtRows = attacks.filter((r) => r.actual === "block" || r.actual === "approve");
    const evasions = attacks.filter((r) => r.variant === "evasion");
    const innocents = rs.filter((r) => r.expected === "allow");
    return {
      attacks: attacks.length,
      caught: caughtRows.length,
      exact: caughtRows.filter((r) => r.actual === r.expected).length,
      evasions: evasions.length,
      evasionsCaught: evasions.filter((r) => r.actual === "block" || r.actual === "approve").length,
      innocents: innocents.length,
      falsePositives: innocents.filter((r) => r.actual !== "allow").length,
      gaps: rs.filter((r) => r.gap).length,
    };
  };
  const t = count(rows);
  const byCategory = {};
  for (const c of [...new Set(rows.map((r) => r.kind))].sort((a, b) => a.localeCompare(b))) byCategory[c] = count(rows.filter((r) => r.kind === c));
  const caught = (r) => r.actual === "block" || r.actual === "approve";
  return {
    total: rows.length,
    attacks: t.attacks,
    caught: t.caught,
    exact: t.exact,
    evasions: t.evasions,
    evasionsCaught: t.evasionsCaught,
    innocents: t.innocents,
    falsePositives: t.falsePositives,
    recall: ratio(t.caught, t.attacks),
    evasionRecall: ratio(t.evasionsCaught, t.evasions),
    accuracy: ratio(t.exact, t.caught),
    fpr: ratio(t.falsePositives, t.innocents),
    thresholds,
    byCategory,
    escaped: rows.filter((r) => r.expected !== "allow" && !r.gap && r.actual === "allow").map(failedOf),
    falsePositiveCases: rows.filter((r) => r.expected === "allow" && r.actual !== "allow" && r.actual !== "error").map(failedOf),
    inexact: rows.filter((r) => r.expected !== "allow" && !r.gap && caught(r) && r.actual !== r.expected).map(failedOf),
    closedGaps: rows.filter((r) => r.gap && caught(r)).map(failedOf),
    knownGaps: rows.filter((r) => r.gap && !caught(r)).map((r) => ({ id: r.id, gap: r.gap })),
  };
}

function buildReport(rows) {
  const by = (g) => rows.filter((r) => r.group === g);
  const groups = {
    guides: scored(by("guides"), set.guides.thresholds.minScore),
    rules: rulesSummary(by("rules"), set.rules.thresholds),
    signals: scored(by("signals"), set.signals.thresholds.minScore),
  };
  const byLanguage = {};
  for (const r of rows.filter((x) => !x.gap)) {
    const lang = r.lang ?? "neutral";
    byLanguage[lang] ??= { total: 0, passed: 0 };
    byLanguage[lang].total += 1;
    if (r.pass) byLanguage[lang].passed += 1;
  }
  const brokenHooks = rows.filter((r) => r.actual === "error").map(failedOf);
  const lat = rows.flatMap((r) => r.latencies ?? []);
  const th = set.rules.thresholds;
  const failures = [];
  if (brokenHooks.length) failures.push(`${brokenHooks.length} broken hook(s)`);
  for (const g of ["guides", "signals"]) {
    if (groups[g].score !== null && groups[g].score < groups[g].minScore) failures.push(`${g} ${pct(groups[g].score)} below ${pct(groups[g].minScore)}`);
  }
  const ru = groups.rules;
  if (ru.recall !== null && ru.recall < th.minRecall) failures.push(`rules recall ${pct(ru.recall)} below the threshold`);
  if (ru.fpr !== null && ru.fpr > th.maxFpr) failures.push(`rules false positives ${pct(ru.fpr)} above the threshold`);
  if (ru.accuracy !== null && ru.accuracy < th.minAccuracy) failures.push(`rules accuracy ${pct(ru.accuracy)} below the threshold`);
  if (ru.closedGaps.length) failures.push(`${ru.closedGaps.length} gap(s) that no longer are`);
  return {
    kind: "deterministic-eval",
    version: 1,
    date: new Date().toISOString().slice(0, 10),
    cases: rel(casesPath),
    source: { profile, config: configPath ? rel(configPath) : null },
    green: !failures.length,
    failures,
    groups,
    byLanguage,
    latency: { p50Ms: Math.round(percentile(lat, 50)), p95Ms: Math.round(percentile(lat, 95)), runs: lat.length },
    brokenHooks,
  };
}

function renderText(report, rows) {
  const { guides, rules, signals } = report.groups;
  const lines = [];
  const source = report.source.config ? `config ${report.source.config}` : `freshly installed harness${profile ? ` (profile ${profile})` : " (bare template)"}`;
  lines.push(`DETERMINISTIC EVAL — ${report.date} · ${source} · ${rows.length} cases from \`${report.cases}\``);
  const kinds = (s) => Object.entries(s.byKind).map(([k, v]) => `${k} ${v.passed}/${v.total}`).join(" · ");
  const fail = (f) => `${f.id}${f.lang ? ` [${f.lang}]` : ""} — ${f.note}: expected ${f.expected}, got ${f.actual}${f.detail ? ` (${f.detail})` : ""}`;
  const list = (title, xs, render = fail) => {
    if (!xs.length) return;
    lines.push(`    ${title}:`);
    for (const x of xs) lines.push(`      · ${render(x)}`);
  };

  lines.push("", `  GUIDES  (before the agent decides)   ${pct(guides.score)}  ${guides.passed}/${guides.total}; threshold ${pct(guides.minScore)}`);
  if (guides.total) lines.push(`    ${kinds(guides)}`);
  list("FAILED", guides.failed);

  lines.push("", `  RULES   (before a tool runs)`);
  lines.push(`    recall           ${pct(rules.recall)}  (${rules.caught}/${rules.attacks} attacks blocked or escalated; threshold ${pct(rules.thresholds.minRecall)})`);
  lines.push(`    evasion recall   ${pct(rules.evasionRecall)}  (of ${rules.evasions} variants that try to get around a guard)`);
  lines.push(`    accuracy         ${pct(rules.accuracy)}  (caught with the expected decision: blocking is not asking; threshold ${pct(rules.thresholds.minAccuracy)})`);
  lines.push(`    false positives  ${pct(rules.fpr)}  (${rules.falsePositives}/${rules.innocents} innocents blocked or escalated; threshold ${pct(rules.thresholds.maxFpr)})`);
  lines.push(`    known gaps       ${rules.knownGaps.length}  (attacks known to get through: they do not count against)`);
  const cats = Object.entries(rules.byCategory);
  if (cats.length) {
    const width = Math.max(8, ...cats.map(([c]) => c.length));
    lines.push("", `    ${"category".padEnd(width)}   caught  evasion     FP    gaps`);
    for (const [c, x] of cats) {
      lines.push(`    ${c.padEnd(width)}  ${`${x.caught}/${x.attacks}`.padStart(7)}  ${`${x.evasionsCaught}/${x.evasions}`.padStart(7)}  ${`${x.falsePositives}/${x.innocents}`.padStart(5)}  ${String(x.gaps).padStart(6)}`);
    }
  }
  list("ATTACKS THAT GET THROUGH (fix the rule or declare the gap)", rules.escaped);
  list("FALSE POSITIVES (they stop legitimate work: tighten the rule)", rules.falsePositiveCases);
  list("CAUGHT WITH ANOTHER DECISION", rules.inexact);
  list("GAPS THAT CLOSED (update the case and its gap row)", rules.closedGaps, (f) => `${f.id}: ${f.detail}`);
  list("Known gaps", rules.knownGaps, (g) => `${g.id}: ${g.gap}`);

  lines.push("", `  SIGNALS (after acting)                ${pct(signals.score)}  ${signals.passed}/${signals.total}; threshold ${pct(signals.minScore)}`);
  if (signals.total) lines.push(`    ${kinds(signals)}`);
  list("FAILED", signals.failed);

  const langs = Object.entries(report.byLanguage).map(([l, v]) => `${l} ${v.passed}/${v.total}`).join(" · ");
  lines.push("", `  by language      ${langs}  (known gaps excluded)`);
  lines.push(`  latency          p50 ${report.latency.p50Ms} ms · p95 ${report.latency.p95Ms} ms per hook run (node start-up included; ${report.latency.runs} runs)`);
  list("BROKEN HOOKS (exit other than 0 and 2: Claude Code lets the tool run)", report.brokenHooks);

  if (DETAIL) {
    lines.push("", "  Detail:");
    for (const r of rows) {
      const mark = r.actual === "error" ? "!" : r.gap ? "~" : r.pass ? "✓" : "✗";
      lines.push(`    ${mark} [${r.group} · ${r.kind}${r.variant ? ` · ${r.variant}` : ""}${r.lang ? ` · ${r.lang}` : ""}] ${r.id} — ${r.note}: expected ${r.expected}, got ${r.actual}${r.hook ? ` (${r.hook})` : ""}`);
    }
  }
  lines.push("", report.green ? "DETERMINISTIC EVAL GREEN" : `DETERMINISTIC EVAL RED — ${report.failures.join(" · ")}`);
  return lines.join("\n");
}

// ── Run ──────────────────────────────────────────────────────────────────────

let root;
try {
  root = install({ repoRoot: REPO_ROOT, profile, configPath, files: set.files });
} catch (e) {
  console.error(`harness-eval: EVAL BROKEN — could not install the harness under evaluation. ${e.message}`);
  process.exit(1);
}
try {
  // The reasons are judged from the rules run, so a guides-only run still runs every rule.
  const rulesToRun = GROUP === "guides" && !ONLY ? set.rules.items : pick("rules");
  const [ruleRuns, guideRows, signalRows] = await Promise.all([
    runRules(root, set, rulesToRun),
    runGuides(root, set, pick("guides")),
    runSignals(root, set, pick("signals")),
  ]);
  const reasonRows = (GROUP && GROUP !== "guides") || ONLY ? [] : judgeReasons(set, ruleRuns);
  const ruleRows = GROUP === "guides" ? [] : ruleRuns;
  const rows = [...guideRows, ...reasonRows, ...ruleRows, ...signalRows];
  const report = buildReport(rows);
  const text = renderText(report, rows);
  console.log(JSON_OUT ? JSON.stringify(report, null, 2) : text);
  if (SAVE) {
    const dir = path.join(path.dirname(casesPath), "measurements");
    fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, `deterministic-${report.date}-${configPath ? "config" : (profile ?? "template")}`);
    fs.writeFileSync(`${base}.txt`, `${text}\n`);
    fs.writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
    if (!JSON_OUT) console.log(`\nReport saved to ${rel(base)}.txt and .json`);
  }
  process.exitCode = report.green ? 0 : 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
