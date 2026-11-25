import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, untrackedDiff } from "../lib/diff.js";

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
