import { test } from "node:test";
import assert from "node:assert/strict";
import { findItems, wordScore, quickFind } from "../lib/quick-find.js";

const spaces = [
  { id: "sp1", name: "herdr-mods", machine: null, tabs: [{ id: "tbA", name: "1" }, { id: "tbS", name: "2", settled: true }] },
  { id: "w/sp2", name: "platform-backend", machine: "njv-cachyos-work", tabs: [{ id: "w/tbB", name: "1" }] },
  { id: "w/sp3", name: "jira-viewer", machine: "njv-cachyos-work", tabs: [{ id: "w/tbC", name: "1" }] },
];
const panes = [
  { tab: "tbA", pane: "p1", terminal: "t1", title: "zsh", focused: true },
  { tab: "w/tbB", pane: "w/p2", terminal: "w/t7", title: "ap-25565 upstream mr status" },
  { tab: "w/tbC", pane: "w/p3", terminal: "w/t9", title: "jira gate fields" },
];
const terms = [
  { address: "t1", title: "~/git/herdr-mods", cwd: "/u/git/herdr-mods", program: { name: "zsh" } },
  { address: "w/t7", title: "ap-25565 upstream mr status", cwd: "/h/git/platform-backend", program: { name: "Claude Code" } },
  { address: "w/t9", title: "jira gate fields", cwd: "/h/git/jira-viewer", program: { name: "Claude Code" } },
  { address: "t4", state: "live", title: "mr-status.sh", cwd: "/u/git/hayami", labels: { "nt.stack": "p1", "nt.title": "mr-status.sh" }, program: { name: "zsh" } },
];
const order = [{ key: "w/tbC", at: 30 }, { key: "w/tbB", at: 20 }, { key: "tbA", at: 10 }];

test("findItems: tabs (settled ones out), spaces, machines, nested tabs, with their steps", () => {
  const items = findItems({ spaces, panes, terms, order });
  assert.deepEqual(items.map((x) => x.key).sort(), ["machine:njv-cachyos-work", "nested:t4", "space:sp1", "space:w/sp2", "space:w/sp3", "tab:tbA", "tab:w/tbB", "tab:w/tbC"].sort());
  const nested = items.find((x) => x.kind === "nested");
  assert.deepEqual(nested.steps, [["space.select", { id: "sp1" }], ["tab.select", { id: "tbA" }], ["pane.focus", { pane: "p1" }]]);
  assert.deepEqual(nested.nested, { pane: "p1", terminal: "t4" });
  const machine = items.find((x) => x.kind === "machine");
  assert.deepEqual(machine.steps, [["space.select", { id: "w/sp3" }]], "its most recently used space");
});

test("wordScore: start, word start, anywhere, letters in order, no match", () => {
  assert.equal(wordScore("plat", "platform-backend").score, 100);
  assert.equal(wordScore("back", "platform-backend").score, 80);
  assert.equal(wordScore("form", "platform-backend").score, 60);
  assert.ok(wordScore("pfb", "platform-backend").score <= 30);
  assert.equal(wordScore("xyz", "platform-backend"), null);
});

test("quickFind: every word must match; the title ranks first; ties by use; empty: recent tabs first", () => {
  const items = findItems({ spaces, panes, terms, order });
  // "mr-status.sh" starts with "mr": above a title where "mr" starts a later word.
  assert.deepEqual(quickFind(items, "mr stat").slice(0, 2).map((x) => x.key), ["nested:t4", "tab:w/tbB"]);
  assert.equal(quickFind(items, "upstream mr")[0].key, "tab:w/tbB");
  assert.equal(quickFind(items, "upstream mr")[0].mark, 9, "where the title matched");
  assert.deepEqual(quickFind(items, "jira gate").map((x) => x.key), ["tab:w/tbC"]);
  assert.equal(quickFind(items, "zzz").length, 0);
  assert.deepEqual(quickFind(items, "").slice(0, 3).map((x) => x.key), ["tab:w/tbC", "tab:w/tbB", "tab:tbA"]);
  assert.equal(quickFind(items, "space plat")[0].key, "space:w/sp2");
});
