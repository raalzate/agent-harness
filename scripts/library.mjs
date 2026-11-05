#!/usr/bin/env node
/**
 * The library: the repo's documentation indexed by KIND and shelved by CONCEPT.
 *
 *   node scripts/library.mjs index                 build the catalog and the appendix (re-index)
 *   node scripts/library.mjs check                 gate signal: the index is in sync and the shelves hold
 *   node scripts/library.mjs query "<topic>"       ranked hits, each with WHERE it matched
 *        [--kind table|graph|document] [--base <id>] [--limit n] [--json]
 *   node scripts/library.mjs lookup <path>         read one entry the way its kind is read
 *        [--where <column>=<value>]  (table)   [--node <id> --depth n]  (graph)   [--section "<heading>"]  (document)
 *   node scripts/library.mjs migrate [--apply]     dry-run by default: what moves to which shelf
 *
 *   --root <dir>     run against another repo (self-test)   --config <file>   another config (self-test)
 *
 * Why it exists: the agent reads docs the way it reads code without an index — opens ten files to
 * find one row of a table. Three kinds are read differently, so they are indexed differently:
 *   · graph    — JSON with nodes and edges: structured, answers "what is connected to X"
 *   · table    — a markdown file that holds ONLY tables (headings allowed): structured, answers
 *                "which row has X" without reading prose
 *   · document — any other markdown: unstructured, answered by section
 * and every entry lives in exactly ONE knowledge base: a base whose files overlap another's is a
 * concept nobody delimited, and the check says so.
 *
 * Generic on purpose (P4): roots, kinds, keys of the graph format and the bases themselves come
 * from `library` in `.claude/harness.config.json`. Without that key every command is a no-op that
 * says so: a harness that is not configured never blocks anyone (P5).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HARNESS_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// ── arguments ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);
const VALUED = new Set(["root", "config", "kind", "base", "limit", "where", "node", "depth", "section"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && VALUED.has(argv[i - 1].slice(2))));
const [command = "help", ...rest] = positional;

const ROOT = path.resolve(flag("root") ?? HARNESS_ROOT);
const CONFIG_FILE = path.resolve(flag("config") ?? path.join(ROOT, ".claude", "harness.config.json"));

// ── config ───────────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return null;
  }
}
const config = loadConfig();
const lib = config?.library;
if (!lib) {
  // Fail open: no key, no library. Said out loud so nobody reads it as "checked".
  console.log("library: skipped (the config does not declare `library`).");
  process.exit(0);
}

const KINDS = {
  graph: { extensions: [".json"], nodesKey: "nodes", edgesKey: "edges", idKey: "id", labelKey: "label", typeKey: "type", fromKey: "from", toKey: "to", ...lib.kinds?.graph },
  table: { extensions: [".md"], ...lib.kinds?.table },
  document: { extensions: [".md"], ...lib.kinds?.document },
};
const SRC = toPosix(lib.root ?? "docs").replace(/\/+$/, "");
const APPENDIX = toPosix(lib.appendix ?? `${SRC}/INDEX.md`);
const CATALOG = toPosix(lib.catalog ?? ".claude/library/catalog.json");
const BASES = lib.bases ?? [];
const IGNORE = (lib.ignore ?? []).map(globToRegex);
const STOPWORDS = new Set((lib.query?.stopwords ?? []).map(normalize));
const LIMIT = Number(flag("limit") ?? lib.query?.limit ?? 8);

// ── small helpers ────────────────────────────────────────────────────────────
function toPosix(p) {
  return String(p).split(path.sep).join("/");
}
const abs = (rel) => path.join(ROOT, rel);
const read = (rel) => fs.readFileSync(abs(rel), "utf8");

/** `*` is one path segment, `**` any number of them. The same dialect as `task.scope`. */
function globToRegex(glob) {
  let re = "";
  const g = toPosix(glob);
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      re += ".*";
      i += 1;
      if (g[i + 1] === "/") i += 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Lowercase, no diacritics: "Índice" and "indice" are the same word to a reader. */
function normalize(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** A light stem: plural and gender endings do not change the topic. Language-neutral enough. */
function stem(word) {
  return word.length > 5 ? word.replace(/(es|s|a|o)$/, "") : word;
}

function tokens(text) {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map(stem);
}

/**
 * Synonyms: the ranking matches words, not meaning, so «despliegue» never found «deploy». Each
 * group in `library.query.synonyms` is one concept; a term that belongs to a group matches any
 * word of it. Natural-language words, so they live in the config, not here.
 */
const SYNONYMS = (lib.query?.synonyms ?? []).map((group) => [...new Set(group.flatMap((w) => tokens(w)))]);

/** Each search term becomes its alternatives: itself plus its synonym group, if it has one. */
function expand(words) {
  return [...new Set(words)].map((q) => {
    const group = SYNONYMS.find((alts) => alts.some((a) => a.startsWith(q) || q.startsWith(a)));
    return group ? [...new Set([q, ...group])] : [q];
  });
}

/** How many search terms (any of their alternatives) appear at the start of a word of `text`. */
function countTerms(text, terms) {
  const words = tokens(text ?? "");
  return terms.filter((alts) => words.some((w) => alts.some((q) => w.startsWith(q)))).length;
}

// ── classification: one file → one kind ──────────────────────────────────────
const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSeparator = (l) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(l);
const isHeading = (l) => /^\s{0,3}#{1,6}\s/.test(l);

function splitRow(line) {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** Tables of a markdown text: each with the heading above it, its columns and its rows. */
function parseTables(text) {
  const lines = text.split(/\r?\n/);
  const tables = [];
  let heading = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (isHeading(lines[i])) heading = lines[i].replace(/^\s*#+\s*/, "").trim();
    if (isRow(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const t = { heading, line: i + 1, columns: splitRow(lines[i]), rows: [] };
      let j = i + 2;
      for (; j < lines.length && isRow(lines[j]); j += 1) t.rows.push({ line: j + 1, cells: splitRow(lines[j]) });
      tables.push(t);
      i = j - 1;
    }
  }
  return tables;
}

/** Only headings, table lines and blank lines: anything else is prose, and prose is a document. */
function isTableOnly(text) {
  const lines = text.split(/\r?\n/);
  let sawTable = false;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (!l.trim() || isHeading(l)) continue;
    if (!isRow(l)) return false;
    if (isSeparator(l)) sawTable = true;
  }
  return sawTable;
}

function parseGraph(text) {
  const k = KINDS.graph;
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { graph: false, error: `it is not valid JSON (${e.message})` };
  }
  if (!data || typeof data !== "object" || !Array.isArray(data[k.nodesKey])) return { graph: false };
  const problems = [];
  const ids = new Set();
  for (const n of data[k.nodesKey]) {
    const id = n?.[k.idKey];
    if (id === undefined || id === null || id === "") problems.push(`a node without \`${k.idKey}\``);
    else if (ids.has(String(id))) problems.push(`node \`${id}\` is declared twice`);
    else ids.add(String(id));
  }
  const edges = Array.isArray(data[k.edgesKey]) ? data[k.edgesKey] : [];
  if (data[k.edgesKey] !== undefined && !Array.isArray(data[k.edgesKey])) problems.push(`\`${k.edgesKey}\` is not an array`);
  for (const e of edges) {
    for (const end of [k.fromKey, k.toKey]) {
      if (!ids.has(String(e?.[end]))) problems.push(`edge ${e?.[k.fromKey]} → ${e?.[k.toKey]} points to node \`${e?.[end]}\`, which does not exist`);
    }
  }
  return { graph: true, data, nodes: data[k.nodesKey], edges, problems };
}

function documentShape(text, rel) {
  const lines = text.split(/\r?\n/);
  const headings = [];
  let inFence = false;
  let summary = "";
  let para = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (isHeading(l)) {
      headings.push({ level: l.trim().match(/^#+/)[0].length, text: l.replace(/^\s*#+\s*/, "").trim(), line: i + 1 });
      if (para.length && !summary) summary = para.join(" ");
      para = [];
      continue;
    }
    if (!summary) {
      if (!l.trim() || isRow(l) || /^\s*(>|<|[-*]\s|\d+\.\s)/.test(l)) {
        if (para.length) summary = para.join(" ");
        para = [];
      } else para.push(l.trim());
    }
  }
  if (!summary && para.length) summary = para.join(" ");
  const title = headings.find((h) => h.level === 1)?.text ?? path.basename(rel).replace(/\.[^.]+$/, "");
  return { title, headings, summary: clip(stripMarkdown(summary), 220) };
}

function stripMarkdown(s) {
  return s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
}
function clip(s, n) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/** The kind of a file, or a reason why it has none. Order matters: graph, then table, then document. */
function classify(rel) {
  const ext = path.extname(rel).toLowerCase();
  const text = read(rel);
  if (KINDS.graph.extensions.includes(ext)) {
    const g = parseGraph(text);
    if (g.graph) return { kind: "graph", text, graph: g };
    if (!KINDS.table.extensions.includes(ext) && !KINDS.document.extensions.includes(ext))
      return { kind: null, why: g.error ?? `it is ${ext} but has no \`${KINDS.graph.nodesKey}\` array: not a graph. Give it the graph shape, or add it to \`library.ignore\`` };
  }
  if (KINDS.table.extensions.includes(ext) && isTableOnly(text)) return { kind: "table", text };
  if (KINDS.document.extensions.includes(ext)) return { kind: "document", text };
  return { kind: null, why: "no kind takes this extension" };
}

// ── the catalog ──────────────────────────────────────────────────────────────
function walk(dirRel) {
  const out = [];
  const dirAbs = abs(dirRel);
  if (!fs.existsSync(dirAbs)) return out;
  for (const e of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    const rel = `${dirRel}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

const KIND_EXTENSIONS = new Set(Object.values(KINDS).flatMap((k) => k.extensions));

/** Files the library is responsible for: kind extensions under the root, minus what it writes itself. */
function candidates() {
  return walk(SRC)
    .filter((rel) => KIND_EXTENSIONS.has(path.extname(rel).toLowerCase()))
    .filter((rel) => rel !== APPENDIX && rel !== CATALOG && !IGNORE.some((re) => re.test(rel)))
    .sort();
}

function basesOf(rel) {
  return BASES.filter((b) => (b.dir && rel.startsWith(`${SRC}/${b.dir}/`)) || (b.include ?? []).some((g) => globToRegex(g).test(rel))).map((b) => b.id);
}

/**
 * Build the catalog from disk. Only fields that change when the MEANING changes go in (title,
 * summary, headings, columns, node types): no line numbers, no hashes. Otherwise every typo fixed
 * in a paragraph would leave the index stale and the check would bite more than it should (P3).
 */
function build() {
  const entries = [];
  const errors = [];
  for (const rel of candidates()) {
    const c = classify(rel);
    const bases = basesOf(rel);
    if (!c.kind) {
      errors.push(`${rel}: unclassified — ${c.why}`);
      continue;
    }
    if (bases.length === 0) errors.push(`${rel}: on no shelf — no base in \`library.bases\` takes it (\`node scripts/library.mjs migrate\` suggests one)`);
    if (bases.length > 1) errors.push(`${rel}: on two shelves (${bases.join(", ")}) — two bases claim the same file, so neither concept is delimited`);
    const entry = { path: rel, kind: c.kind, base: bases[0] ?? null };
    if (c.kind === "graph") {
      const g = c.graph;
      for (const p of g.problems) errors.push(`${rel}: broken graph — ${p}`);
      const k = KINDS.graph;
      entry.title = String(g.data.title ?? path.basename(rel, path.extname(rel)));
      entry.summary = clip(String(g.data.description ?? ""), 220);
      entry.nodes = g.nodes.length;
      entry.edges = g.edges.length;
      entry.nodeTypes = [...new Set(g.nodes.map((n) => n?.[k.typeKey]).filter(Boolean).map(String))].sort();
    } else if (c.kind === "table") {
      const d = documentShape(c.text, rel);
      const tables = parseTables(c.text);
      entry.title = d.title;
      entry.summary = clip(tables.map((t) => `${t.heading ?? "tabla"} (${t.rows.length})`).join(" · "), 220);
      entry.tables = tables.map((t) => ({ heading: t.heading, columns: t.columns, rows: t.rows.length }));
    } else {
      const d = documentShape(c.text, rel);
      entry.title = d.title;
      entry.summary = d.summary;
      entry.headings = d.headings.filter((h) => h.level <= 3).map((h) => h.text);
    }
    entries.push(entry);
  }
  for (const b of BASES) {
    if (!b.id || !b.concept) errors.push(`base \`${b.id ?? "?"}\`: needs \`id\` and \`concept\` — a shelf without a concept is a folder`);
    if (!entries.some((e) => e.base === b.id)) errors.push(`base \`${b.id}\`: empty — a concept with no documents is a promise, not a shelf`);
  }
  const ids = BASES.map((b) => b.id);
  for (const id of ids.filter((x, i) => ids.indexOf(x) !== i)) errors.push(`base \`${id}\`: declared twice`);
  const catalog = {
    $comment: "GENERATED by `node scripts/library.mjs index`. Do not edit: re-index.",
    root: SRC,
    bases: BASES.map((b) => ({ id: b.id, concept: b.concept, scope: b.scope ?? "", entries: entries.filter((e) => e.base === b.id).length })),
    entries,
  };
  return { catalog, errors };
}

const KIND_LABEL = { graph: "grafo", table: "tabla", document: "documento" };

/** The appendix: the human face of the catalog. Links are relative to where the appendix lives. */
function renderAppendix(catalog) {
  const from = path.posix.dirname(APPENDIX);
  const link = (rel) => path.posix.relative(from, rel) || path.posix.basename(rel);
  const count = (kind) => catalog.entries.filter((e) => e.kind === kind).length;
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|");
  const out = [
    "# Índice de la biblioteca",
    "",
    "> GENERADO por `node scripts/library.mjs index`: no se edita a mano. Lo consulta el subagente",
    "> `librarian`; lo verifica la señal del gate `library index (docs)`.",
    "",
    `${catalog.entries.length} entradas en ${catalog.bases.length} bases · ${count("document")} documentos (no estructurado) · ${count("table")} tablas · ${count("graph")} grafos (estructurado).`,
    "",
    "## Bases de conocimiento",
    "",
    "| Base | Concepto | Qué NO entra | Entradas |",
    "|---|---|---|---|",
    ...catalog.bases.map((b) => `| [${cell(b.id)}](#${b.id}) | ${cell(b.concept)} | ${cell(b.scope)} | ${b.entries} |`),
  ];
  for (const b of catalog.bases) {
    out.push("", `## ${b.id}`, "", `**${b.concept}**`, "", "| Entrada | Tipo | Qué contiene |", "|---|---|---|");
    for (const e of catalog.entries.filter((x) => x.base === b.id)) {
      const extra = e.kind === "graph" ? ` (${e.nodes} nodos, ${e.edges} aristas)` : "";
      out.push(`| [${cell(e.title)}](${link(e.path)}) | ${KIND_LABEL[e.kind]}${extra} | ${cell(e.summary)} |`);
    }
  }
  return `${out.join("\n")}\n`;
}

const catalogText = (catalog) => `${JSON.stringify(catalog, null, 2)}\n`;

function write(rel, text) {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  fs.writeFileSync(abs(rel), text);
}

// ── commands ─────────────────────────────────────────────────────────────────
function cmdIndex() {
  const { catalog, errors } = build();
  write(CATALOG, catalogText(catalog));
  write(APPENDIX, renderAppendix(catalog));
  console.log(`library: indexed ${catalog.entries.length} entries in ${catalog.bases.length} bases → ${CATALOG} · ${APPENDIX}`);
  if (errors.length) {
    console.error(`library: ${errors.length} problem(s) the check will reject:\n${errors.map((e) => `  ✗ ${e}`).join("\n")}`);
    process.exit(1);
  }
}

function cmdCheck() {
  const { catalog, errors } = build();
  const stale = [];
  const onDisk = (rel) => (fs.existsSync(abs(rel)) ? read(rel).replace(/\r\n/g, "\n") : null);
  if (onDisk(CATALOG) !== catalogText(catalog)) stale.push(CATALOG);
  if (onDisk(APPENDIX) !== renderAppendix(catalog)) stale.push(APPENDIX);
  if (stale.length) errors.push(`stale index: ${stale.join(" and ")} do not match the documents. An index that lies is worse than none — re-index with \`node scripts/library.mjs index\``);
  if (errors.length) {
    console.error(`library: RED — ${errors.length} problem(s):\n${errors.map((e) => `  ✗ ${e}`).join("\n")}`);
    process.exit(1);
  }
  const by = (k) => catalog.entries.filter((e) => e.kind === k).length;
  console.log(`library: OK — ${catalog.entries.length} entries (${by("document")} documents · ${by("table")} tables · ${by("graph")} graphs) in ${catalog.bases.length} bases, index in sync.`);
}

function loadCatalog() {
  if (!fs.existsSync(abs(CATALOG))) {
    console.error(`library: there is no catalog yet (${CATALOG}). Index first: \`node scripts/library.mjs index\`.`);
    process.exit(1);
  }
  return JSON.parse(read(CATALOG));
}

/** Where a topic matched inside one entry: sections, rows or nodes — the kind decides. */
function locate(entry, terms) {
  const text = fs.existsSync(abs(entry.path)) ? read(entry.path) : "";
  const hit = (s) => countTerms(s, terms);
  if (entry.kind === "table") {
    return parseTables(text)
      .flatMap((t) => t.rows.map((r) => ({ score: hit(r.cells.join(" ")) + hit(t.heading ?? ""), where: `${entry.path}:${r.line}`, text: clip(r.cells.join(" | "), 160) })))
      .filter((x) => x.score > 0);
  }
  if (entry.kind === "graph") {
    const g = parseGraph(text);
    if (!g.graph) return [];
    const k = KINDS.graph;
    return g.nodes
      .map((n) => {
        const id = String(n[k.idKey]);
        const links = g.edges.filter((e) => String(e[k.fromKey]) === id || String(e[k.toKey]) === id).map((e) => (String(e[k.fromKey]) === id ? `→ ${e[k.toKey]}` : `← ${e[k.fromKey]}`));
        return { score: hit(`${id} ${n[k.labelKey] ?? ""} ${n[k.typeKey] ?? ""}`), where: `${entry.path}#${id}`, text: clip(`${n[k.labelKey] ?? id}${n[k.typeKey] ? ` [${n[k.typeKey]}]` : ""} ${links.join(" ")}`, 160) };
      })
      .filter((x) => x.score > 0);
  }
  // A document: score each section by its heading and its body.
  const lines = text.split(/\r?\n/);
  const sections = [];
  let cur = { heading: entry.title, line: 1, body: [] };
  let inFence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    if (isHeading(l) && !inFence) {
      if (cur.body.some((b) => b.trim()) || cur.line !== 1) sections.push(cur);
      cur = { heading: l.replace(/^\s*#+\s*/, "").trim(), line: i + 1, body: [] };
    } else cur.body.push(l);
  });
  sections.push(cur);
  return sections
    .map((s) => ({ score: hit(s.heading) * 3 + Math.min(hit(s.body.join(" ")), 3), where: `${entry.path}:${s.line}`, text: s.heading }))
    .filter((x) => x.score > 0);
}

function cmdQuery() {
  const topic = rest.join(" ").trim();
  if (!topic) {
    console.error('library: query needs a topic — `node scripts/library.mjs query "<topic>"`.');
    process.exit(2);
  }
  const terms = expand(tokens(topic));
  const catalog = loadCatalog();
  const concept = Object.fromEntries(BASES.map((b) => [b.id, `${b.concept} ${(b.keywords ?? []).join(" ")}`]));
  const kind = flag("kind");
  const base = flag("base");
  // A boost says "this kind of question lives on that shelf" («qué se decidió» → the ADRs). It
  // only reorders entries that already matched: it never brings in one with nothing on the topic.
  const boosts = (lib.query?.boosts ?? []).filter((b) => {
    try {
      return new RegExp(b.when, "i").test(topic);
    } catch {
      return false;
    }
  });
  const scored = catalog.entries
    .filter((e) => (!kind || e.kind === kind) && (!base || e.base === base))
    .map((e) => {
      const count = (s) => countTerms(s, terms);
      const meta = count(e.title) * 5 + count(e.summary) * 2 + count((e.headings ?? []).join(" ")) * 2 + count(concept[e.base]) * 2 + count((e.tables ?? []).flatMap((t) => [t.heading, ...t.columns]).join(" ")) * 3 + count((e.nodeTypes ?? []).join(" ")) * 3;
      const where = locate(e, terms).sort((a, b) => b.score - a.score).slice(0, 4);
      const found = meta + where.reduce((s, w) => s + w.score, 0);
      const boost = found > 0 ? boosts.filter((b) => b.base === e.base).reduce((s, b) => s + Number(b.score ?? 0), 0) : 0;
      return { ...e, score: found + boost, where };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, LIMIT);
  if (has("json")) {
    console.log(JSON.stringify({ topic, terms: terms.map((t) => t.join("|")), hits: scored }, null, 2));
    return;
  }
  if (!scored.length) {
    console.log(`library: nothing on "${topic}" (terms: ${terms.map((t) => t.join("|")).join(", ") || "none"}). Say so — do not answer from memory.`);
    return;
  }
  console.log(`library: "${topic}" → ${scored.length} hit(s)`);
  for (const e of scored) {
    console.log(`\n[${e.kind}] ${e.path} · base ${e.base} · score ${e.score}\n  ${e.title}${e.summary ? ` — ${e.summary}` : ""}`);
    for (const w of e.where) console.log(`    ${w.where}  ${w.text}`);
  }
}

function cmdLookup() {
  const rel = toPosix(rest[0] ?? "");
  if (!rel || !fs.existsSync(abs(rel))) {
    console.error(`library: lookup needs an existing entry path (got \`${rel}\`).`);
    process.exit(2);
  }
  const c = classify(rel);
  if (c.kind === "table") {
    const where = flag("where");
    const [col, val] = where ? [where.slice(0, where.indexOf("=")), where.slice(where.indexOf("=") + 1)] : [];
    for (const t of parseTables(c.text)) {
      const ci = col ? t.columns.findIndex((x) => normalize(x) === normalize(col)) : -1;
      if (col && ci === -1) continue;
      const rows = t.rows.filter((r) => !col || normalize(r.cells[ci] ?? "").includes(normalize(val)));
      if (!rows.length) continue;
      console.log(`## ${t.heading ?? "(tabla)"} — ${rel}:${t.line}\n| ${t.columns.join(" | ")} |`);
      for (const r of rows) console.log(`| ${r.cells.join(" | ")} |   ← ${rel}:${r.line}`);
    }
    return;
  }
  if (c.kind === "graph") {
    const k = KINDS.graph;
    const g = c.graph;
    const start = flag("node");
    if (!start) {
      console.log(`${rel}: ${g.nodes.length} nodes, ${g.edges.length} edges. Pass --node <id> for a neighbourhood.`);
      return;
    }
    const depth = Number(flag("depth") ?? 1);
    const seen = new Set([start]);
    let frontier = [start];
    const shown = [];
    for (let d = 0; d < depth; d += 1) {
      const next = [];
      for (const e of g.edges) {
        const [a, b] = [String(e[k.fromKey]), String(e[k.toKey])];
        if (frontier.includes(a) || frontier.includes(b)) {
          shown.push(e);
          for (const x of [a, b]) if (!seen.has(x)) (seen.add(x), next.push(x));
        }
      }
      frontier = next;
    }
    const byId = new Map(g.nodes.map((n) => [String(n[k.idKey]), n]));
    if (!byId.has(start)) {
      console.error(`library: node \`${start}\` is not in ${rel}.`);
      process.exit(2);
    }
    for (const id of seen) {
      const n = byId.get(id);
      console.log(`node ${id}: ${n?.[k.labelKey] ?? ""}${n?.[k.typeKey] ? ` [${n[k.typeKey]}]` : ""}`);
    }
    for (const e of new Set(shown)) console.log(`edge ${e[k.fromKey]} → ${e[k.toKey]}${e[k.labelKey] ? ` (${e[k.labelKey]})` : ""}`);
    return;
  }
  const want = flag("section");
  const lines = c.text.split(/\r?\n/);
  // A `# comment` inside a code fence is not a heading.
  let fence = false;
  const headingAt = lines.map((l) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    return !fence && isHeading(l);
  });
  const start = want ? lines.findIndex((l, i) => headingAt[i] && normalize(l).includes(normalize(want))) : 0;
  if (start === -1) {
    console.error(`library: no section matching "${want}" in ${rel}.`);
    process.exit(2);
  }
  const level = want ? lines[start].trim().match(/^#+/)[0].length : 0;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) if (want && headingAt[i] && lines[i].trim().match(/^#+/)[0].length <= level) (end = i), (i = lines.length);
  console.log(`${rel}:${start + 1}-${end}`);
  console.log(lines.slice(start, end).join("\n"));
}

// ── migrate: dry-run by default (P9) ─────────────────────────────────────────
function protectedPattern(rel) {
  return (config.protectedPaths ?? []).find((p) => {
    try {
      return new RegExp(p.pattern).test(rel);
    } catch {
      return false;
    }
  });
}

function suggestBase(rel) {
  const words = new Set(tokens(`${rel} ${read(rel).slice(0, 4000)}`));
  const ranked = BASES.map((b) => ({ id: b.id, score: tokens(`${b.id} ${b.concept} ${(b.keywords ?? []).join(" ")}`).filter((t) => words.has(t)).length })).sort((a, b) => b.score - a.score);
  return ranked[0]?.score ? ranked[0].id : null;
}

function plan() {
  const steps = [];
  for (const rel of candidates()) {
    const bases = basesOf(rel);
    if (bases.length !== 1) {
      steps.push({ action: "shelve", path: rel, base: suggestBase(rel), why: bases.length ? `claimed by ${bases.join(", ")}` : "on no shelf" });
      continue;
    }
    const b = BASES.find((x) => x.id === bases[0]);
    if (!b.dir || rel.startsWith(`${SRC}/${b.dir}/`)) continue;
    const to = `${SRC}/${b.dir}/${rel.slice(SRC.length + 1)}`;
    const prot = protectedPattern(rel);
    if (prot) steps.push({ action: "skip", path: rel, to, why: `protected path — ${prot.reason}` });
    else if (fs.existsSync(abs(to))) steps.push({ action: "skip", path: rel, to, why: "the target already exists: never overwrite" });
    else steps.push({ action: "move", path: rel, to });
  }
  return steps;
}

function git(args) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

/**
 * Rewrite every reference to a moved file: relative links (`](x)`, `href=`, `src=`) are resolved
 * from the file's OLD place and rewritten from its NEW one, and repo-root paths in prose are
 * replaced outright. A move that leaves a dangling link is how docs rot; P10 would catch it, but
 * the move should not need catching.
 */
function rewriteReferences(moves) {
  const map = new Map(moves.map((m) => [m.path, m.to]));
  const back = new Map(moves.map((m) => [m.to, m.path]));
  const ls = git(["ls-files", "-z"]);
  const files = (ls.status === 0 ? ls.stdout.split("\0").filter(Boolean).map((f) => map.get(f) ?? f) : []).filter((f) => fs.existsSync(abs(f)));
  const touched = [];
  for (const now of files) {
    const buf = fs.readFileSync(abs(now));
    if (buf.includes(0)) continue; // binary
    const was = back.get(now) ?? now;
    let text = buf.toString("utf8");
    const before = text;
    text = text.replace(/(\]\(|href="|src=")([^)"#\s]+)([^)"\s]*)/g, (m, open, target, anchor) => {
      if (/^[a-z]+:|^\/|^#/i.test(target)) return m;
      const oldTarget = path.posix.normalize(path.posix.join(path.posix.dirname(was), target));
      const newTarget = map.get(oldTarget) ?? oldTarget;
      if (newTarget === oldTarget && now === was) return m;
      if (!fs.existsSync(abs(newTarget)) && !map.has(oldTarget)) return m;
      const rel = path.posix.relative(path.posix.dirname(now), newTarget) || path.posix.basename(newTarget);
      return `${open}${rel}${anchor}`;
    });
    for (const [from, to] of map) {
      text = text.replace(new RegExp(`(^|[^\\w./-])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-])`, "g"), `$1${to}`);
    }
    if (text !== before) {
      fs.writeFileSync(abs(now), text);
      touched.push(now);
    }
  }
  return touched;
}

function cmdMigrate() {
  const steps = plan();
  const apply = has("apply");
  if (!steps.length) {
    console.log("library: nothing to migrate — every entry is on exactly one shelf, in its place.");
    return;
  }
  console.log(`library: migration plan (${apply ? "APPLY" : "dry-run"}) — ${steps.length} step(s)`);
  for (const s of steps) {
    if (s.action === "move") console.log(`  move    ${s.path} → ${s.to}`);
    else if (s.action === "skip") console.log(`  skip    ${s.path} (${s.why})`);
    else console.log(`  shelve  ${s.path} (${s.why}) → suggested base: ${s.base ?? "none fits — a new base?"}. Add it to that base's \`include\` in the config.`);
  }
  if (!apply) {
    console.log("\nDry-run: nothing moved. Review the list, then `node scripts/library.mjs migrate --apply`.");
    return;
  }
  // Reversibility first (P9): only from a clean tree, so `git restore` + `git clean` undo it all.
  const st = git(["status", "--porcelain"]);
  if (st.status !== 0 || st.stdout.trim()) {
    console.error("library: --apply refused — the working tree is not clean (or this is not a git repo). Commit first so the migration can be undone.");
    process.exit(2);
  }
  const moves = steps.filter((s) => s.action === "move");
  for (const m of moves) {
    fs.mkdirSync(path.dirname(abs(m.to)), { recursive: true });
    fs.renameSync(abs(m.path), abs(m.to));
  }
  const touched = rewriteReferences(moves);
  console.log(`library: moved ${moves.length} file(s), rewrote references in ${touched.length} file(s).`);
  cmdIndex();
}

const COMMANDS = { index: cmdIndex, check: cmdCheck, query: cmdQuery, lookup: cmdLookup, migrate: cmdMigrate };
if (!COMMANDS[command]) {
  console.log("usage: node scripts/library.mjs index | check | query \"<topic>\" | lookup <path> | migrate [--apply]");
  process.exit(command === "help" ? 0 : 2);
}
COMMANDS[command]();
