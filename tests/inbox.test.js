import { test } from "node:test";
import assert from "node:assert/strict";
import { inboxSections, inboxBadge, inboxRow } from "../lib/inbox.js";

const a = (status, title, spaceName) => ({ status, title, spaceName });

test("inboxSections: Needs you, Done, Working in that order; idle and empty sections left out", () => {
  const got = inboxSections([a("idle", "x", "s"), a("working", "w", "s"), a("blocked", "b2", "zeta"), a("blocked", "b1", "alpha")]);
  assert.deepEqual(got.map((s) => [s.title, s.agents.map((x) => x.title)]), [["Needs you", ["b1", "b2"]], ["Working", ["w"]]]);
});

test("inboxBadge: waiting agents win; else finished ones; else nothing", () => {
  assert.deepEqual(inboxBadge([a("done"), a("blocked"), a("blocked")]), { kind: "needs", count: 2 });
  assert.deepEqual(inboxBadge([a("done"), a("working")]), { kind: "done", count: 1 });
  assert.equal(inboxBadge([a("working"), a("idle")]), null);
  assert.equal(inboxBadge([]), null);
});

test("inboxRow: the conversation's title, the project folder, what it's doing", () => {
  const agent = { status: "working", title: "claude-code chat", chat: true, program: { name: "Claude Code" } };
  const term = { title: "Herdr-mods follow and tab bugs", cwd: "/Users/me/git/sysadmin", foreground: { cwd: "/Users/me/git/herdr-mods" }, report: { msg: "Running the tests" } };
  assert.deepEqual(inboxRow(agent, term), { title: "Herdr-mods follow and tab bugs (chat)", project: "herdr-mods", doing: "Running the tests" });
});

test("inboxRow: a generic title falls back to the agent's name; a Windows folder; a state word", () => {
  const agent = { status: "blocked", title: "Claude Code", program: { name: "Claude Code" } };
  assert.deepEqual(inboxRow(agent, { title: "claude.exe", cwd: "C:\\Users\\me\\git\\sanshoku\\" }), { title: "Claude Code", project: "sanshoku", doing: "Waiting for you" });
  assert.deepEqual(inboxRow({ status: "done", title: "Codex" }, null), { title: "Codex", project: null, doing: "Finished" });
});
