import { test } from "node:test";
import assert from "node:assert/strict";
import { chatPairs, stripEntries, stepEntry, moveIndex } from "../lib/chat-stack.js";

test("chatPairs: an agent away from its chat's tab pairs that tab with its own", () => {
  const terms = [
    { address: "t1", state: "live", labels: { "ushi.chat": "pc", "chat.tab": "tbC", "herdr.tab": "tbP" } },
    { address: "m/t2", state: "live", labels: { "ushi.chat": "pd", "chat.tab": "tbD", "herdr.tab": "tbQ" } },
    { address: "t3", state: "live", labels: { "ushi.chat": "pe", "herdr.tab": "tbE" } },
    { address: "t4", state: "live", labels: { "ushi.chat": "pf", "chat.tab": "tbF", "herdr.tab": "tbF" } },
    { address: "t5", state: "live", labels: { "chat.tab": "tbG", "herdr.tab": "tbH" } },
    { address: "t6", state: "ended", labels: { "ushi.chat": "pg", "chat.tab": "tbI", "herdr.tab": "tbJ" } },
  ];
  const pairs = chatPairs(terms);
  assert.deepEqual([...pairs.keys()], ["tbP", "m/tbQ"], "beside its chat, no chat, or ended: no pair");
  assert.deepEqual(pairs.get("tbP"), { chat: "tbC", terminal: "t1" });
  assert.deepEqual(pairs.get("m/tbQ"), { chat: "m/tbD", terminal: "m/t2" }, "ids with the machine part");
});

const members = [{ address: "t1", base: true }, { address: "t7" }, { address: "t8" }];

test("stripEntries: the chat first, then the stack, one entry active", () => {
  const onChat = stripEntries(members, "chat", "t7");
  assert.deepEqual(onChat.map((e) => e.kind === "chat" ? "chat" : e.address), ["chat", "t1", "t7", "t8"]);
  assert.deepEqual(onChat.map((e) => e.active), [true, false, false, false]);
  assert.deepEqual(stripEntries(members, "term", "t7").map((e) => e.active), [false, false, true, false]);
  assert.equal(stripEntries(members, "term", "t1")[1].base, true, "the agent's own terminal");
  assert.deepEqual(stripEntries([{ address: "t1", base: true }], "chat", "t1").length, 2, "no nested terminals: chat and agent");
});

test("stepEntry: next and previous cross between the chat and the terminals, wrapping", () => {
  assert.equal(stepEntry(stripEntries(members, "chat", "t1"), 1).address, "t1");
  assert.equal(stepEntry(stripEntries(members, "chat", "t1"), -1).address, "t8");
  assert.equal(stepEntry(stripEntries(members, "term", "t8"), 1).kind, "chat");
  assert.equal(stepEntry(stripEntries(members, "term", "t1"), -1).kind, "chat");
  assert.equal(stepEntry([{ kind: "chat", active: true }], 1), null);
});

test("moveIndex: a move passes one visible tab, skipping hidden ones, wrapping", () => {
  const tabs = [
    { id: "a", index: 1 }, { id: "h", index: 2, settled: true }, { id: "C", index: 3 },
    { id: "P", index: 4 }, { id: "b", index: 5 },
  ];
  const hidden = new Set(["P"]);
  assert.equal(moveIndex(tabs, "C", -1, hidden), 1, "past the settled tab, onto a");
  assert.equal(moveIndex(tabs, "C", 1, hidden), 5, "past the chat's partner, onto b");
  assert.equal(moveIndex(tabs, "b", 1, hidden), 1, "wraps to the front");
  assert.equal(moveIndex(tabs, "a", -1, hidden), 5, "wraps to the end");
  assert.equal(moveIndex([{ id: "a", index: 1 }, { id: "h", index: 2, settled: true }], "a", 1, hidden), null, "nothing visible to pass");
  assert.equal(moveIndex(tabs, "nope", 1, hidden), null);
});
