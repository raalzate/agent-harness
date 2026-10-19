/**
 * ai-provider — the promptfoo provider behind `scripts/ai-eval.mjs`. promptfoo loads it with
 * `file://` and calls `callApi` once per test and repeat; it never runs inside this repo.
 *
 * Two roles, one class, because both are "run a CLI with the prompt on stdin":
 *   - agent: the subagent under test. It runs in a NEW temporary directory with a copy of only
 *     its suite's `context`. The reviewer that ran the gate on its own and left a marker in the
 *     human's session (docs/gotchas.md) is why: what the agent touches, it touches in a tree
 *     that is thrown away (P7).
 *   - grader: the llm-rubric judge. No context, runs in the system temp dir.
 *
 * Everything specific (commands, context, timeouts) comes from the provider `config` that
 * ai-eval.mjs writes from `aiEval`; this file knows no agent and no model.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function run(command, cwd, input, timeoutMs) {
  const [cmd, ...args] = command;
  return new Promise((resolve) => {
    // shell on Windows: a CLI installed by npm is a .cmd that spawn does not find without it.
    const child = spawn(cmd, args, { cwd, shell: process.platform === "win32" });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr, error });
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, signal });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export default class AiEvalProvider {
  constructor(options = {}) {
    this.config = options.config ?? {};
  }

  id() {
    return this.config.role === "grader" ? "ai-eval-grader" : "ai-eval-agent";
  }

  async callApi(prompt, context = {}) {
    const { role, base, suites = [], command, timeoutMs = 300000 } = this.config;
    if (role === "grader") return this.answer(await run(command, os.tmpdir(), prompt, timeoutMs));

    const suite = suites[Number(context.vars?.suite)];
    if (!suite) return { error: `ai-eval: test without a known suite (vars.suite = ${context.vars?.suite})` };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-ai-eval-agent-"));
    try {
      for (const rel of suite.context ?? []) {
        const from = path.join(base, rel);
        if (!fs.existsSync(from)) return { error: `ai-eval: the context of \`${suite.agent}\` names \`${rel}\`, which does not exist` };
        fs.cpSync(from, path.join(dir, rel), { recursive: true });
      }
      return this.answer(await run(suite.command, dir, prompt, timeoutMs));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // A CLI that failed without answering did not judge anything: it is an error for promptfoo
  // (and BROKEN for ai-eval), never an output to grade.
  answer(r) {
    if (r.stdout.trim()) return { output: r.stdout };
    const why = r.error?.code ?? (r.signal ? `killed (${r.signal}), timeout?` : r.stderr.trim().split("\n").pop() || `exit ${r.status}`);
    return { error: `ai-eval: the CLI did not answer (${why})` };
  }
}
