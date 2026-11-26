import { test } from "node:test";
import assert from "node:assert/strict";
import { plainText, quote, commandOf, menuFor, unwrapPastes, keepLineBreaks, joinLines } from "../lib/chat-text.js";

test("plainText drops Markdown marks and keeps words, code and line breaks", () => {
  const md = [
    "## Fix",
    "Set **res.statusCode** to `404` when [the lookup](src/x.js) misses; *only* then.",
    "",
    "```js",
    "const a = b * c * d; // **not** touched",
    "```",
    "",
    "> quoted line",
    "- keep_snake_case and a_b",
  ].join("\n");
  assert.equal(plainText(md), [
    "Fix",
    "Set res.statusCode to 404 when the lookup misses; only then.",
    "",
    "const a = b * c * d; // **not** touched",
    "",
    "quoted line",
    "- keep_snake_case and a_b",
  ].join("\n"));
});

test("quote prefixes every line and leaves room to type", () => {
  assert.equal(quote("one\n\ntwo\n"), "> one\n>\n> two\n\n");
});

test("commandOf: a shell command, an argv, else the input as JSON", () => {
  assert.equal(commandOf({ command: "git status", description: "x" }), "git status");
  assert.equal(commandOf({ cmd: ["ls", "-la"] }), "ls -la");
  assert.equal(commandOf({ file_path: "/a" }), '{\n  "file_path": "/a"\n}');
  assert.equal(commandOf(null), "");
});

test("menuFor: entries per target; a selection comes first; no side chat without it", () => {
  const ids = (m) => m.map((x) => x.sep ? "|" : x.id);
  assert.deepEqual(ids(menuFor({ kind: "user", text: "hi" })), ["copy", "edit"]);
  assert.deepEqual(ids(menuFor({ kind: "assistant", text: "a" }, { selection: "sel" })),
    ["copy-selection", "|", "copy", "copy-plain", "|", "quote", "ask-side"]);
  assert.deepEqual(ids(menuFor({ kind: "assistant" }, { side: false })), ["copy", "copy-plain", "|", "quote"]);
  assert.deepEqual(ids(menuFor({ kind: "tool", item: { result: "out" } })), ["copy-command", "copy-output", "|", "show-terminal"]);
  assert.deepEqual(ids(menuFor({ kind: "tool", item: { result: null } })), ["copy-command", "|", "show-terminal"]);
  assert.equal(menuFor({ kind: "tools", items: [1, 2] })[0].label, "Copy commands");
  assert.deepEqual(menuFor(null), []);
});

test("menuFor: Stop for background work still running, and only then", () => {
  const ids = (m) => m.map((x) => x.sep ? "|" : x.id);
  const running = { bg: { status: "running" } }, done = { bg: { status: "completed" }, result: "r" };
  assert.deepEqual(ids(menuFor({ kind: "tool", item: running })), ["copy-command", "|", "show-terminal", "|", "stop-task"]);
  assert.ok(!ids(menuFor({ kind: "tool", item: done })).includes("stop-task"));
  assert.equal(menuFor({ kind: "tools", items: [running, running, done] }).at(-1).label, "Stop 2 background tasks");
  assert.ok(!ids(menuFor({ kind: "tools", items: [done, {}] })).includes("stop-task"));
});

test("unwrapPastes: the paste tags Claude Code logs go, the pasted text stays", () => {
  const logged = '\n\n<pasted_content id="b483">\n> a quoted reply\n\n(this is from the menu)\n</pasted_content id="b483">\n';
  assert.equal(unwrapPastes(logged), "> a quoted reply\n\n(this is from the menu)");
  assert.equal(unwrapPastes('see <pasted_content id="a1">\nx\n</pasted_content> and more'), "see \nx\n and more");
  assert.equal(unwrapPastes("no paste here <b>bold</b>"), "no paste here <b>bold</b>");
});

test("keepLineBreaks: lines inside a paragraph stay lines; code and blank lines are left alone", () => {
  assert.equal(keepLineBreaks("1 — one\n2 — two\n\nnext para"), "1 — one  \n2 — two\n\nnext para");
  assert.equal(keepLineBreaks("intro\n```js\na\nb\n```\nafter"), "intro\n```js\na\nb\n```\nafter");
  assert.equal(keepLineBreaks("~~~~text\nx\ny\n~~~~"), "~~~~text\nx\ny\n~~~~");
  assert.equal(keepLineBreaks("already  \nbroken"), "already  \nbroken");
  assert.equal(keepLineBreaks("- a\n- b"), "- a  \n- b");
});

test("joinLines: a reply seen in parts joins where the parts overlap; no overlap gives null", () => {
  const first = ["Intro line", "1. one", "2. two", "3. three"];
  assert.deepEqual(joinLines(first, ["2. two", "3. three", "4. four", "5. five"]),
    ["Intro line", "1. one", "2. two", "3. three", "4. four", "5. five"]);
  assert.deepEqual(joinLines(first, ["3. three"]), first, "nothing new: the same lines");
  assert.equal(joinLines(first, ["", "9. nine"]), null, "a blank line alone is no overlap");
  assert.equal(joinLines(first, ["x", "y"]), null);
  assert.deepEqual(joinLines(first, []), first);
  assert.deepEqual(joinLines([...first, "", ""], ["2. two", "3. three", "4. four"]), [...first, "4. four"],
    "blank lines that ended the earlier read don't block the overlap");
});
