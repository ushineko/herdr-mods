import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, untrackedDiff, sideBySide, wordChanges, foldContext, syntaxRuns, paintLine, patchText, createdText } from "../lib/diff.js";

const SAMPLE = `diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,4 @@ header
 one
-two
+TWO
+two and a half
 three
@@ -10,2 +11,2 @@
 ten
-eleven
\\ No newline at end of file
+eleven!
`;

test("meta lines before the first hunk", () => {
  const { rows } = parseDiff(SAMPLE);
  assert.deepEqual(rows.slice(0, 4).map((r) => r.kind), ["meta", "meta", "meta", "meta"]);
});

test("hunks number old and new lines", () => {
  const { rows } = parseDiff(SAMPLE);
  const body = rows.filter((r) => r.kind !== "meta");
  assert.deepEqual(body.slice(0, 6), [
    { kind: "hunk", text: "@@ -1,3 +1,4 @@ header", old: null, new: null },
    { kind: "ctx", text: "one", old: 1, new: 1 },
    { kind: "del", text: "two", old: 2, new: null },
    { kind: "add", text: "TWO", old: null, new: 2 },
    { kind: "add", text: "two and a half", old: null, new: 3 },
    { kind: "ctx", text: "three", old: 3, new: 4 },
  ]);
  const second = body.slice(6);
  assert.equal(second[0].kind, "hunk");
  assert.deepEqual(second[1], { kind: "ctx", text: "ten", old: 10, new: 11 });
  assert.deepEqual(second[2], { kind: "del", text: "eleven", old: 11, new: null });
  assert.equal(second[3].kind, "note");
  assert.deepEqual(second[4], { kind: "add", text: "eleven!", old: null, new: 12 });
});

test("counts added and removed lines", () => {
  const { added, removed } = parseDiff(SAMPLE);
  assert.equal(added, 3);
  assert.equal(removed, 2);
});

test("empty diff", () => {
  assert.deepEqual(parseDiff(""), { rows: [], added: 0, removed: 0 });
  assert.deepEqual(parseDiff(null), { rows: [], added: 0, removed: 0 });
});

test("untracked file: every line added", () => {
  const d = untrackedDiff("a\nb\n");
  assert.equal(d.added, 2);
  assert.equal(d.removed, 0);
  assert.deepEqual(d.rows[1], { kind: "add", text: "a", old: null, new: 1 });
  assert.deepEqual(d.rows[2], { kind: "add", text: "b", old: null, new: 2 });
});

test("sideBySide: removed and added runs paired line by line; context on both sides", () => {
  const { rows } = parseDiff("@@ -1,4 +1,4 @@\n a\n-b\n-c\n+B\n d\n+e\n");
  const pairs = sideBySide(rows);
  assert.deepEqual(pairs.map((p) => p.hunk ? "hunk" : `${p.left?.text ?? "∅"}|${p.right?.text ?? "∅"}`), ["hunk", "a|a", "b|B", "c|∅", "d|d", "∅|e"]);
});

test("wordChanges: the changed words of a pair; a rewrite marked whole", () => {
  assert.deepEqual(wordChanges("const total = a + b;", "const total = a - b;"), { old: [[16, 17]], new: [[16, 17]] });
  assert.deepEqual(wordChanges("return x", "return x, y"), { old: [], new: [[8, 11]] });
  assert.deepEqual(wordChanges("alpha beta", "gamma delta epsilon"), { old: [[0, 10]], new: [[0, 19]] });
});

test("foldContext: a long unchanged run folds, keeping 3 lines each side; an opened fold stays open", () => {
  const ctx = Array.from({ length: 20 }, (_, i) => ({ kind: "ctx", text: `l${i}`, old: i + 1, new: i + 1 }));
  const rows = [{ kind: "hunk", text: "@@" }, ...ctx, { kind: "add", text: "x", old: null, new: 21 }];
  const folded = foldContext(rows);
  const fold = folded.find((r) => r.kind === "fold");
  assert.equal(fold.count, 14);
  assert.equal(folded.length, 1 + 3 + 1 + 3 + 1);
  assert.equal(foldContext(rows, new Set([fold.id])).length, rows.length);
  assert.equal(foldContext(rows.slice(0, 8)).some((r) => r.kind === "fold"), false, "a short run stays");
});

test("syntaxRuns and paintLine: keywords, strings, numbers, comments; changed ranges cut the runs", () => {
  assert.deepEqual(syntaxRuns('if x == "a" { return 42 } // done', "go").map((r) => [r.text, r.kind]),
    [["if", "keyword"], [" x == ", null], ['"a"', "string"], [" { ", null], ["return", "keyword"], [" ", null], ["42", "number"], [" } ", null], ["// done", "comment"]]);
  assert.deepEqual(paintLine("return x", "js", [[7, 8]]), [{ text: "return", kind: "keyword", changed: false }, { text: " ", kind: null, changed: false }, { text: "x", kind: null, changed: true }]);
  assert.deepEqual(syntaxRuns("# note", "py"), [{ text: "# note", kind: "comment" }]);
});

// Claude Code's structuredPatch as logged for an Edit (spec 025 R4), drawn through parseDiff.
test("patchText: an edit's hunks read back with their line numbers", () => {
  const hunks = [{ oldStart: 224, oldLines: 3, newStart: 224, newLines: 4, lines: [" a", "-b", "+B", "+c", " d"] }];
  const { rows, added, removed } = parseDiff(patchText(hunks));
  assert.equal(added, 2);
  assert.equal(removed, 1);
  assert.deepEqual(rows.map((r) => [r.kind, r.old, r.new, r.text]), [
    ["hunk", null, null, "@@ -224,3 +224,4 @@"],
    ["ctx", 224, 224, "a"], ["del", 225, null, "b"], ["add", null, 225, "B"], ["add", null, 226, "c"], ["ctx", 226, 227, "d"],
  ]);
  assert.equal(patchText(null), "");
});

test("createdText: a new file as added lines from 1, cut at max", () => {
  const { rows, added } = parseDiff(createdText("x\ny\nz\n", 2));
  assert.deepEqual(rows.filter((r) => r.kind === "add").map((r) => [r.new, r.text]), [[1, "x"], [2, "y"]]);
  assert.equal(added, 2);
  assert.equal(rows[0].text, "@@ -0,0 +1,3 @@");
});
