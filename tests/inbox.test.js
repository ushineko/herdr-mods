import { test } from "node:test";
import assert from "node:assert/strict";
import { inboxSections, inboxBadge, inboxRow, sessionOfHome, homeOfSession, parseSiblings, showSteps } from "../lib/inbox.js";

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

test("sessionOfHome and homeOfSession: this setup's naming", () => {
  assert.equal(sessionOfHome("/home/me/.config/herdr-app"), "default");
  assert.equal(sessionOfHome("/home/me/.config/herdr-app-work/"), "work");
  assert.equal(sessionOfHome("/tmp/elsewhere"), null);
  assert.equal(homeOfSession("work", "/home/me/.config/"), "/home/me/.config/herdr-app-work");
  assert.equal(homeOfSession("default", "/home/me/.config"), "/home/me/.config/herdr-app");
});

test("parseSiblings: another window's agents as rows; idle ones and bad lines left out", () => {
  const get = (address, state, extra = {}) => ({ address, status: { app: "claude-code", state, msg: extra.msg }, title: extra.title, cwd: "/home/me/git/platform-backend", where: "platform-backend / 2" });
  const text = [
    JSON.stringify({ session: "work", home: "/home/me/.config/herdr-app-work", agents: [get("t7", "blocked", { title: "ap-25565 mr status", msg: "Allow Bash?" }), get("t9", "idle")] }),
    "noise",
  ].join("\n");
  assert.deepEqual(parseSiblings(text), [{
    session: "work", home: "/home/me/.config/herdr-app-work", title: "Work window",
    agents: [{ address: "t7", status: "blocked", where: "platform-backend / 2", steps: [["agent.focus", { terminal: "t7" }]], machine: null, title: "ap-25565 mr status", project: "platform-backend", doing: "Allow Bash?" }],
  }]);
});

test("showSteps: a chat's agent is shown as its chat (space, the chat's tab, its pane); others by agent.focus", () => {
  const chat = { address: "t7", labels: { "ushi.chat": "pba4", "chat.tab": "tb4d", "herdr.space": "spcf", "herdr.tab": "tb0c" } };
  assert.deepEqual(showSteps(chat), [["space.select", { id: "spcf" }], ["tab.select", { id: "tb4d" }], ["pane.focus", { pane: "pba4" }]]);
  assert.deepEqual(showSteps({ address: "t9", labels: {} }), [["agent.focus", { terminal: "t9" }]]);
});

test("parseSiblings: an agent on a machine the other window's core added carries the machine", () => {
  const g = { address: "win11-kvm/t18", status: { state: "working", msg: "Reading" }, title: "fix the dock", cwd: "C:\\Users\\me\\git\\sysadmin", labels: {} };
  const [w] = parseSiblings(JSON.stringify({ session: "default", home: "/h/.config/herdr-app", agents: [g] }));
  assert.equal(w.agents[0].machine, "win11-kvm");
  assert.equal(w.agents[0].project, "sysadmin");
});
