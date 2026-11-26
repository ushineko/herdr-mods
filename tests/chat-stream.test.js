import { test } from "node:test";
import assert from "node:assert/strict";
import { live } from "../mods/ushi-naruse/stream.js";

const RULE = "─".repeat(60);
const box = [RULE, "❯ ", RULE, "  ⏵⏵ bypass permissions on (shift+tab to cycle)"];
const NOTICE = " ".repeat(60) + "Update available! Run: brew upgrade claude-code";

test("live: an update notice over the message box is not part of the reply", () => {
  const screen = ["❯ fix it", "", "⏺ The fix is in. Tests pass.", "  Next I'll install it.", NOTICE, ...box].join("\n");
  assert.deepEqual(live(screen, "claude"), { kind: "text", text: "The fix is in. Tests pass. Next I'll install it.", raw: ["The fix is in. Tests pass.", "Next I'll install it."] });
});

test("live: nor in a running command's output", () => {
  const screen = ["❯ check", "", "⏺ Bash(ls)", "  ⎿  a.js", "     b.js", NOTICE, ...box].join("\n");
  const r = live(screen, "claude");
  assert.equal(r.kind, "run");
  assert.ok(!r.out.some((l) => /Update available/.test(l)), JSON.stringify(r.out));
});

test("live: a reply's own indented lines stay; without a notice nothing changes", () => {
  const screen = ["❯ show", "", "⏺ Here:", "", "  ```", "      deep()", "  ```", ...box].join("\n");
  assert.match(live(screen, "claude").text, /deep\(\)/);
  const plain = ["❯ hi", "", "⏺ Hello.", ...box].join("\n");
  assert.equal(live(plain, "claude").text, "Hello.");
});
