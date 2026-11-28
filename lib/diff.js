// Parse `git diff --no-color` output for one file into rows the viewer draws.
// Pure: no herdr imports.

/**
 * @returns {{ rows: Array<{ kind: "meta"|"hunk"|"add"|"del"|"ctx"|"note", text: string, old: number|null, new: number|null }>, added: number, removed: number }}
 */
export function parseDiff(text) {
  const rows = [];
  let added = 0, removed = 0, oldNo = 0, newNo = 0, inHunk = false;
  const lines = String(text ?? "").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: line, old: null, new: null });
    } else if (!inHunk) {
      rows.push({ kind: "meta", text: line, old: null, new: null });
    } else if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), old: null, new: newNo++ });
      added++;
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", text: line.slice(1), old: oldNo++, new: null });
      removed++;
    } else if (line.startsWith("\\")) {
      rows.push({ kind: "note", text: line, old: null, new: null });
    } else {
      rows.push({ kind: "ctx", text: line.slice(1), old: oldNo++, new: newNo++ });
    }
  }
  return { rows, added, removed };
}

/** An untracked file shown as a diff against nothing: every line added. */
export function untrackedDiff(text) {
  const body = String(text ?? "");
  const lines = body.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return {
    rows: [
      { kind: "hunk", text: `@@ -0,0 +1,${lines.length} @@ (untracked)`, old: null, new: null },
      ...lines.map((l, i) => ({ kind: "add", text: l, old: null, new: i + 1 })),
    ],
    added: lines.length,
    removed: 0,
  };
}

// ---- spec 017 R2: side by side, word changes, folding, syntax colours ----------

/**
 * The diff's rows as side-by-side pairs: [{ hunk } | { fold } | { left, right }], each
 * side a row or null. Within a hunk, a run of removed lines and the run of added lines
 * after it are paired line by line (the longer run's rest against nothing);
 * unchanged and note lines sit on both sides. Fold rows pass through.
 */
export function sideBySide(rows) {
  const out = [];
  let dels = [], adds = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) out.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = []; adds = [];
  };
  for (const r of rows) {
    if (r.kind === "del") { if (adds.length) flush(); dels.push(r); continue; }
    if (r.kind === "add") { adds.push(r); continue; }
    flush();
    if (r.kind === "hunk") out.push({ hunk: r });
    else if (r.kind === "fold") out.push({ fold: r });
    else if (r.kind !== "meta") out.push({ left: r, right: r });
  }
  flush();
  return out;
}

/** Words, runs of spaces, and single other characters: what a word change compares. */
const tokens = (s) => String(s ?? "").match(/[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]/g) ?? [];

/**
 * Which parts of a changed line pair differ: { old: [[start, end]], new: [[start,
 * end]] }, character ranges, from the longest common run of words. Lines too far
 * apart (under a third in common) are marked whole, as a rewrite.
 */
export function wordChanges(a, b) {
  const x = tokens(a), y = tokens(b);
  if (x.length * y.length > 250000) return { old: [[0, String(a).length]], new: [[0, String(b).length]] };
  const L = Array.from({ length: x.length + 1 }, () => new Int32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--)
    L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const same = (t) => t.filter((s) => /\S/.test(s)).join("").length;
  let i = 0, j = 0, pa = 0, pb = 0, common = 0;
  const old = [], neu = [];
  const mark = (list, from, to) => { if (to <= from) return; const last = list[list.length - 1]; if (last && last[1] === from) last[1] = to; else list.push([from, to]); };
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { if (/\S/.test(x[i])) common += x[i].length; pa += x[i].length; pb += y[j].length; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { mark(old, pa, pa + x[i].length); pa += x[i++].length; }
    else { mark(neu, pb, pb + y[j].length); pb += y[j++].length; }
  }
  while (i < x.length) { mark(old, pa, pa + x[i].length); pa += x[i++].length; }
  while (j < y.length) { mark(neu, pb, pb + y[j].length); pb += y[j++].length; }
  if (common * 3 < Math.max(same(x), same(y))) return { old: [[0, String(a).length]], new: [[0, String(b).length]] };
  return { old, new: neu };
}

/**
 * Long runs of unchanged lines folded: a run longer than keep*2+min keeps `keep`
 * lines at each end and the rest becomes { kind: "fold", id, count, rows } (the rows
 * it hides), unless its id is in `open`. Ids are stable for the same diff.
 */
export function foldContext(rows, open = new Set(), keep = 3, min = 4) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length > keep * 2 + min) {
      const id = `${run[0].old ?? ""}:${run[0].new ?? ""}`;
      if (open.has(id)) out.push(...run);
      else out.push(...run.slice(0, keep), { kind: "fold", id, count: run.length - keep * 2, rows: run.slice(keep, -keep), old: null, new: null, text: "" }, ...run.slice(-keep));
    } else out.push(...run);
    run = [];
  };
  for (const r of rows) {
    if (r.kind === "ctx") { run.push(r); continue; }
    flush();
    out.push(r);
  }
  flush();
  return out;
}

// A small, generic highlighter: comments, strings, numbers and keywords for the
// common languages; the rest plain. Enough to read a diff by.
const KEYWORDS = new Set(("if else elif for while do switch case default break continue return function func fn def class struct enum interface " +
  "type let const var import from export as package use mod pub impl trait new delete try catch finally throw throws raise with yield async await " +
  "public private protected static final void int bool string true false null nil None True False undefined this self super in of is not and or " +
  "match where lambda goto select defer go chan map range local then end until begin echo fi esac done").split(" "));
const COMMENT = { "#": ["py", "sh", "bash", "zsh", "rb", "yaml", "yml", "toml", "conf", "r", "pl", "ps1", "mk", "makefile", "dockerfile"], "//": ["js", "ts", "jsx", "tsx", "mjs", "cjs", "go", "rs", "c", "h", "cpp", "hpp", "cc", "java", "kt", "swift", "cs", "scala", "dart", "php", "jsonc", "zig"], "--": ["sql", "lua", "hs"] };
const commentOf = (lang) => Object.entries(COMMENT).find(([, l]) => l.includes(lang))?.[0] ?? null;

/** A line's syntax runs: [{ text, kind: "comment"|"string"|"number"|"keyword"|null }]. */
export function syntaxRuns(line, lang) {
  const s = String(line ?? ""), c = commentOf(String(lang ?? "").toLowerCase());
  const out = [];
  const push = (text, kind) => { if (!text) return; const last = out[out.length - 1]; if (last && last.kind === kind) last.text += text; else out.push({ text, kind }); };
  let i = 0;
  while (i < s.length) {
    if (c && s.startsWith(c, i)) { push(s.slice(i), "comment"); break; }
    if (s.startsWith("/*", i) && commentOf(lang) === "//") { const e = s.indexOf("*/", i + 2); const end = e < 0 ? s.length : e + 2; push(s.slice(i, end), "comment"); i = end; continue; }
    const q = s[i];
    if (q === '"' || q === "'" || q === "`") {
      let j = i + 1;
      while (j < s.length && s[j] !== q) j += s[j] === "\\" ? 2 : 1;
      push(s.slice(i, Math.min(j + 1, s.length)), "string"); i = Math.min(j + 1, s.length); continue;
    }
    const w = /^[A-Za-z_][A-Za-z0-9_]*|^\d[\d_.xXa-fA-F]*/.exec(s.slice(i));
    if (w) { push(w[0], /^\d/.test(w[0]) ? "number" : KEYWORDS.has(w[0]) ? "keyword" : null); i += w[0].length; continue; }
    push(q, null); i++;
  }
  return out;
}

/**
 * A line's runs to draw: its syntax runs split where its changed ranges (wordChanges)
 * start and end, each run { text, kind, changed }.
 */
export function paintLine(line, lang, changed = []) {
  const out = [];
  let at = 0;
  for (const run of syntaxRuns(line, lang)) {
    let start = at;
    const end = at + run.text.length;
    const cuts = new Set([start, end]);
    for (const [a, b] of changed) { if (a > start && a < end) cuts.add(a); if (b > start && b < end) cuts.add(b); }
    const points = [...cuts].sort((p, q) => p - q);
    for (let k = 0; k < points.length - 1; k++) {
      const [p, q] = [points[k], points[k + 1]];
      out.push({ text: String(line).slice(p, q), kind: run.kind, changed: changed.some(([a, b]) => p >= a && q <= b) });
    }
    at = end;
  }
  return out;
}

/**
 * An edit's change as unified diff text for parseDiff: Claude Code's `structuredPatch`
 * hunks ({ oldStart, oldLines, newStart, newLines, lines: [" x", "-y", "+z"] }).
 */
export function patchText(hunks) {
  return (Array.isArray(hunks) ? hunks : []).map((h) =>
    [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...(h.lines ?? [])].join("\n")).join("\n");
}

/** A new file's first `max` lines as an all-added diff. */
export function createdText(content, max = 200) {
  const lines = String(content ?? "").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const shown = lines.slice(0, max);
  return [`@@ -0,0 +1,${lines.length} @@`, ...shown.map((l) => "+" + l)].join("\n");
}
