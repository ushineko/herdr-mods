import { test } from "node:test";
import assert from "node:assert/strict";
import { isNative, nativeHere, stackMembers, shownMember, stepMember, stripGroups } from "../lib/native-stack.js";

const all = [
  { pane: "q", terminal: "t9", stack: null },
  { pane: "p3", terminal: "t3", stack: { id: "st", index: 2, shown: false } },
  { pane: "p1", terminal: "t1", stack: { id: "st", index: 0, shown: false } },
  { pane: "p2", terminal: "t2", stack: { id: "st", index: 1, shown: true } },
  { pane: "x", terminal: "t8", stack: { id: "other", index: 0, shown: true } },
];

test("isNative: a fork window's entries carry a stack key, a released window's don't", () => {
  assert.equal(isNative({ pane: "p", stack: null }), true);
  assert.equal(isNative({ pane: "p" }), false);
  assert.equal(isNative(undefined), false);
});

test("stackMembers: the pane's stack in index order; [] outside a stack", () => {
  assert.deepEqual(stackMembers(all, "p3").map((m) => m.pane), ["p1", "p2", "p3"]);
  assert.deepEqual(stackMembers(all, "q"), []);
  assert.deepEqual(stackMembers(all, "nope"), []);
});

test("shownMember and stepMember: the shown one, and next/previous wrapping", () => {
  const m = stackMembers(all, "p1");
  assert.equal(shownMember(m).pane, "p2");
  assert.equal(stepMember(m, 1).pane, "p3");
  assert.equal(stepMember(m, 2).pane, "p1");
  assert.equal(stepMember(m, -1).pane, "p1");
  assert.equal(stepMember([m[0]], 1), null);
});

test("stripGroups: a chat and its agent's member first, the rest in order", () => {
  const members = [
    { pane: "m/pz", terminal: "m/tz", stack: { id: "s", index: 0 } },
    { pane: "m/pa", terminal: "m/ta", stack: { id: "s", index: 1 } },
    { pane: "m/pc", terminal: null, mod: "ushi-naruse", stack: { id: "s", index: 2 } },
  ];
  const terms = [{ address: "m/ta", labels: { "ushi.chat": "pc" } }, { address: "m/tz", labels: {} }];
  const g = stripGroups(members, terms);
  assert.equal(g.chat.pane, "m/pc");
  assert.equal(g.agent.pane, "m/pa");
  assert.deepEqual(g.rest.map((m) => m.pane), ["m/pz"]);
  const lone = stripGroups(members, [{ address: "m/ta", labels: { "ushi.chat": "pOther" } }]);
  assert.equal(lone.chat, null, "a chat whose agent isn't in the stack is an ordinary member");
  assert.equal(lone.rest.length, 3);
});

test("nativeHere: this machine's panes, or panes already in a native stack", () => {
  assert.equal(nativeHere({ pane: "p1", stack: null }), true);
  assert.equal(nativeHere({ pane: "njv-mbp-m1/p1", stack: null }), false, "another machine's pane: label-based");
  assert.equal(nativeHere({ pane: "njv-mbp-m1/p1", stack: { id: "st", index: 0, shown: true } }), true, "already native: drawn natively");
  assert.equal(nativeHere({ pane: "p1" }), false, "a released window");
});
