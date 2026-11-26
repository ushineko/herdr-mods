import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeWindow, contextMeter } from "../lib/chat-context.js";

test("claudeWindow: current families 1M, older 200k, [1m] always 1M, unknown null", () => {
  for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-opus-4-8", "claude-sonnet-5"])
    assert.equal(claudeWindow(m), 1_000_000, m);
  for (const m of ["claude-opus-4-6", "claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001", "claude-3-5-sonnet"])
    assert.equal(claudeWindow(m), 200_000, m);
  assert.equal(claudeWindow("claude-sonnet-4-5[1m]"), 1_000_000);
  assert.equal(claudeWindow("gpt-5.5"), null);
  assert.equal(claudeWindow(null), null);
});

test("contextMeter: percent and sizes; the log's window wins; levels", () => {
  assert.deepEqual(contextMeter({ used: 123_456, window: null }, "claude-opus-5-5"), { text: "12% · 123k / 1M", percent: 12, level: "ok" });
  assert.deepEqual(contextMeter({ used: 150_000, window: 200_000 }, "claude-opus-5-5"), { text: "75% · 150k / 200k", percent: 75, level: "high" });
  assert.equal(contextMeter({ used: 190_000, window: 200_000 }).level, "full");
  assert.deepEqual(contextMeter({ used: 5_400, window: 258_400 }, "gpt-5.5"), { text: "2% · 5k / 258k", percent: 2, level: "ok" }, "Codex reports its window");
  assert.deepEqual(contextMeter({ used: 42_000, window: null }, "some-model"), { text: "42k tokens", percent: null, level: "ok" });
  assert.equal(contextMeter({ used: 0 }), null);
  assert.equal(contextMeter(null), null);
  assert.equal(contextMeter({ used: 1_500_000, window: 1_000_000 }).percent, 100);
});
