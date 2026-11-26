import { test } from "node:test";
import assert from "node:assert/strict";
import { plainText, quote, commandOf, menuFor, unwrapPastes, keepLineBreaks, joinLines, sentHistory, recallStep, panelLinks, linkBareUrls } from "../lib/chat-text.js";

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

test("sentHistory: the user's messages and commands, newest first, repeats in a row once", () => {
  const entries = [
    { kind: "user", text: "first" },
    { kind: "assistant", text: "ok" },
    { kind: "user", command: true, text: "/model opus" },
    { kind: "user", text: "  second  " },
    { kind: "user", text: "second" },
    { kind: "tools", items: [] },
    { kind: "user", text: "" },
  ];
  assert.deepEqual(sentHistory(entries, ["third"]), ["third", "second", "/model opus", "first"]);
  assert.deepEqual(sentHistory(null), []);
});

test("recallStep: up walks back, down returns to the draft; an edit starts over", () => {
  const h = ["c", "b", "a"];
  let s = recallStep(null, -1, "draft", h);
  assert.deepEqual(s, { pos: 0, draft: "draft", shown: "c" });
  s = recallStep(s, -1, "c", h);
  assert.equal(s.shown, "b");
  s = recallStep(s, -1, "b", h);
  assert.equal(s.shown, "a");
  assert.equal(recallStep(s, -1, "a", h), null, "nothing older");
  s = recallStep(s, 1, "a", h);
  assert.equal(s.shown, "b");
  s = recallStep(recallStep(s, 1, "b", h), 1, "c", h);
  assert.deepEqual(s, { pos: -1, draft: "draft", shown: "draft" }, "back at the draft");
  assert.equal(recallStep(s, 1, "draft", h), null, "nothing newer than the draft");
  assert.equal(recallStep(null, 1, "x", h), null, "down without recalling");
  const edited = recallStep({ pos: 1, draft: "d", shown: "b" }, -1, "b!", h);
  assert.deepEqual(edited, { pos: 0, draft: "b!", shown: "c" }, "an edited recall is the new draft");
  assert.equal(recallStep(null, -1, "", []), null, "no history");
});

test("panelLinks: a wrapped login URL comes back whole; borders, indents and prose stay out", () => {
  const lines = [
    " Browser didn't open? Use the url below to sign in:",
    "",
    "   https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9",
    "   -ad8a-4d2e&response_type=code&redirect_uri=https%3A%2F%2Fconsole",
    "   .anthropic.com%2Foauth%2Fcode%2Fcallback&state=abc123",
    "",
    " Paste code here if prompted >",
  ];
  assert.deepEqual(panelLinks(lines), ["https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-ad8a-4d2e&response_type=code&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode%2Fcallback&state=abc123"]);
  assert.deepEqual(panelLinks(["│ see https://example.com/a. Then go on │", "│ next │"]), ["https://example.com/a"]);
  assert.deepEqual(panelLinks(["https://a.example/x", "https://b.example/y", "https://a.example/x"]), ["https://a.example/x", "https://b.example/y"]);
  assert.deepEqual(panelLinks(["no links here"]), []);
});

test("linkBareUrls: bare URLs become links; code, links and trailing punctuation stay as they are", () => {
  assert.equal(linkBareUrls("See https://example.com/a?b=1, then go."), "See <https://example.com/a?b=1>, then go.");
  assert.equal(linkBareUrls("(https://example.com/x)"), "(<https://example.com/x>)");
  assert.equal(linkBareUrls("[docs](https://example.com) and <https://example.org>"), "[docs](https://example.com) and <https://example.org>");
  assert.equal(linkBareUrls("run `curl https://example.com` here"), "run `curl https://example.com` here");
  assert.equal(linkBareUrls("```\nhttps://example.com\n```\nhttps://b.example"), "```\nhttps://example.com\n```\n<https://b.example>");
  assert.equal(linkBareUrls("no links"), "no links");
});
