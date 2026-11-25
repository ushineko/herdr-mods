import { test } from "node:test";
import assert from "node:assert/strict";
import { plainText, quote, commandOf, menuFor, unwrapPastes } from "../lib/chat-text.js";

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

test("unwrapPastes: the paste tags Claude Code logs go, the pasted text stays", () => {
  const logged = '\n\n<pasted_content id="b483">\n> a quoted reply\n\n(this is from the menu)\n</pasted_content id="b483">\n';
  assert.equal(unwrapPastes(logged), "> a quoted reply\n\n(this is from the menu)");
  assert.equal(unwrapPastes('see <pasted_content id="a1">\nx\n</pasted_content> and more'), "see \nx\n and more");
  assert.equal(unwrapPastes("no paste here <b>bold</b>"), "no paste here <b>bold</b>");
});
