import { test } from "node:test";
import assert from "node:assert/strict";
import { chatEntries, strayChats } from "../lib/chat-entries.js";

const claude = { key: "claude", name: "Claude Code", installed: true, run: ["claude"] };
const codex = { key: "codex", name: "Codex", installed: true, run: ["codex", "--no-daemon"] };
const cursor = { key: "cursor", name: "Cursor", installed: true, run: ["agent"] };

test("both agents installed: one entry each, Claude first, others left out", () => {
  const got = chatEntries({ platform: "linux", python: true, agents: [codex, cursor, claude] });
  assert.deepEqual(got.map((e) => e.label), ["New Claude Code chat", "New Codex chat"]);
  assert.deepEqual(got[1].run, ["codex", "--no-daemon"]);
});

test("Windows offers no chat", () => {
  assert.deepEqual(chatEntries({ platform: "windows", python: true, agents: [claude, codex] }), []);
});

test("no python3 on the machine: no chat", () => {
  assert.deepEqual(chatEntries({ platform: "macos", python: false, agents: [claude] }), []);
});

test("an agent not installed there is left out", () => {
  const got = chatEntries({ platform: "macos", python: true, agents: [claude, { ...codex, installed: false }] });
  assert.deepEqual(got.map((e) => e.key), ["claude"]);
  assert.deepEqual(chatEntries({ platform: "macos", python: true, agents: undefined }), []);
});

const term = (address, pane, state = "live") => ({ address, state, labels: pane ? { "hm.chat": pane } : {} });

test("an agent whose chat pane is gone ends after the grace time, not before", () => {
  const missing = new Map(), seen = new Set();
  const terms = [term("t1", "p1"), term("t2", "p2"), term("t3", null)];
  assert.deepEqual(strayChats(terms, ["p1", "p2", "px"], missing, 0, 3000, seen), [], "both chats open");
  assert.deepEqual(strayChats(terms, ["p1", "px"], missing, 1000, 3000, seen), [], "first seen missing: wait");
  assert.deepEqual(strayChats(terms, ["p1", "px"], missing, 2000, 3000, seen), [], "still within grace");
  assert.deepEqual(strayChats(terms, ["p1", "px"], missing, 4000, 3000, seen), ["t2"]);
});

test("a chat pane never seen in this run (an app restart that renamed it) ends nothing", () => {
  const missing = new Map(), seen = new Set();
  const terms = [term("t1", "p-old")];
  for (const now of [0, 5000, 60000]) assert.deepEqual(strayChats(terms, ["p-new"], missing, now, 3000, seen), []);
});

test("a pane that comes back clears the wait; no panes listed decides nothing", () => {
  const missing = new Map(), seen = new Set();
  const terms = [term("t1", "p1")];
  strayChats(terms, ["p1"], missing, 0, 3000, seen);
  strayChats(terms, ["px"], missing, 1000, 3000, seen);
  assert.deepEqual(strayChats(terms, ["p1"], missing, 5000, 3000, seen), [], "back in time");
  assert.deepEqual(strayChats(terms, ["px"], missing, 6000, 3000, seen), [], "missing again: a new wait");
  assert.deepEqual(strayChats(terms, [], missing, 60000, 3000, seen), [], "no panes: no decision");
  assert.deepEqual(strayChats([term("t1", "p1", "exited")], ["px"], new Map(), 0, 3000, new Set(["p1"])), [], "only live agents");
});
