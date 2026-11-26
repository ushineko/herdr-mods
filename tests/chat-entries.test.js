import { test } from "node:test";
import assert from "node:assert/strict";
import { chatEntries, strayChats, orphanedHidden, toSettle, toRename, localId, agentsToKeep, visibleNeighbour, parseAgentLookup, withLoginAgents, platformFrom, platformOf } from "../lib/chat-entries.js";

const claude = { key: "claude", name: "Claude Code", installed: true, run: ["claude"] };
const codex = { key: "codex", name: "Codex", installed: true, run: ["codex", "--no-daemon"] };
const cursor = { key: "cursor", name: "Cursor", installed: true, run: ["agent"] };

test("both agents installed: one entry each, Claude first, others left out", () => {
  const got = chatEntries({ platform: "linux", python: true, agents: [codex, cursor, claude] });
  assert.deepEqual(got.map((e) => e.label), ["New Claude Code chat", "New Codex chat"]);
  assert.deepEqual(got[1].run, ["codex", "--no-daemon"]);
});

test("Windows offers Claude Code's chat, with no python3", () => {
  // Windows (spec 014): no python3 needed; Claude Code only, Codex isn't ported.
  assert.deepEqual(chatEntries({ platform: "windows", python: false, agents: [claude, codex] }).map((e) => e.key), ["claude"]);
  assert.deepEqual(chatEntries({ platform: null, python: true, agents: [claude] }), [], "unknown system");
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

const hidden = (address, chatTab, tab) => ({ address, state: "live", labels: { "chat.tab": chatTab, "herdr.tab": tab } });

test("a hidden agent terminal whose chat tab lost its chat is shown again, after the grace time", () => {
  const missing = new Map(), seen = new Set();
  const terms = [hidden("t1", "tbA", "tbH1"), hidden("m/t2", "tbB", "tbH2")];
  assert.deepEqual(orphanedHidden(terms, ["tbA", "m/tbB"], missing, 0, 3000, seen), [], "both chats open");
  assert.deepEqual(orphanedHidden(terms, ["m/tbB"], missing, 1000, 3000, seen), [], "within grace");
  assert.deepEqual(orphanedHidden(terms, ["m/tbB"], missing, 4500, 3000, seen), [{ address: "t1", tab: "tbH1" }]);
  assert.deepEqual(orphanedHidden(terms, ["tbX"], new Map(), 0, 3000, seen).length, 0, "remote: first seen missing");
});

test("a terminal shown beside its chat, or a chat tab never seen in this run, is left alone", () => {
  const seen = new Set();
  assert.deepEqual(orphanedHidden([hidden("t1", "tbA", "tbA")], ["tbZ"], new Map(), 0, 0, new Set(["tbA"])), [], "back in the chat's tab");
  const missing = new Map();
  for (const now of [0, 5000]) assert.deepEqual(orphanedHidden([hidden("t1", "tbA", "tbH")], ["tbZ"], missing, now, 3000, seen), []);
});

test("closing the last chat still shows its hidden terminal; nothing listed decides nothing", () => {
  const seen = new Set(["tbA"]);
  const terms = [hidden("t1", "tbA", "tbH")];
  const missing = new Map();
  orphanedHidden(terms, [], missing, 0, 3000, seen);
  assert.deepEqual(orphanedHidden(terms, [], missing, 4000, 3000, seen), [{ address: "t1", tab: "tbH" }]);
  const m2 = new Map();
  orphanedHidden(terms, [], m2, 0, 3000, seen, false);
  assert.deepEqual(orphanedHidden(terms, [], m2, 9000, 3000, seen, false), []);
});

test("pane ids match with or without their machine part (two windows on one machine)", () => {
  assert.equal(localId("njv-cachyos-default/p7"), "p7");
  assert.equal(localId("p7"), "p7");
  const missing = new Map(), seen = new Set();
  const terms = [term("t1", "njv-cachyos-default/p7")];
  strayChats(terms, ["p7"], missing, 0, 3000, seen);
  assert.deepEqual(strayChats(terms, ["p7"], missing, 9000, 3000, seen), [], "its own window sees the chat");
  strayChats(terms, ["px"], missing, 10000, 3000, seen);
  assert.deepEqual(strayChats(terms, ["px"], missing, 14000, 3000, seen), ["t1"]);
});

test("a hidden terminal's tab is settled in a window that shows it, while its chat is open", () => {
  const terms = [hidden("t1", "tbA", "tbH"), hidden("m/t2", "tbB", "tbG"), hidden("t3", "tbGone", "tbK")];
  const tabs = [{ id: "tbH", settled: false }, { id: "m/tbG", settled: true }, { id: "tbK", settled: false }];
  assert.deepEqual(toSettle(terms, ["tbA", "m/tbB"], tabs), ["tbH"]);
  assert.deepEqual(toSettle(terms, ["tbA"], [{ id: "tbH", settled: false, active: true }]), [], "shown: left alone");
});

test("a hidden terminal's numbered tab takes its chat tab's name; a numbered chat tab is not copied", () => {
  const terms = [hidden("t1", "tbA", "tbH"), hidden("t2", "tbB", "tbG"), hidden("t3", "tbC", "tbK")];
  const tabs = [{ id: "tbA", name: "hayami" }, { id: "tbH", name: "8" }, { id: "tbB", name: "7" }, { id: "tbG", name: "9" },
    { id: "tbC", name: "fynstall" }, { id: "tbK", name: "fynstall" }];
  assert.deepEqual(toRename(terms, tabs), [{ id: "tbH", name: "hayami" }]);
});

test("closing a tab keeps the agent its chat shows; a shell, or a tab without a chat, closes as usual", () => {
  const panes = [
    { pane: "m/pc", tab: "T", mod: "ushi-naruse" },
    { pane: "m/p1", tab: "T", terminal: "m/t1", program: { key: "claude" } },
    { pane: "m/p2", tab: "T", terminal: "m/t2", program: { key: "shell" } },
    { pane: "m/p3", tab: "U", terminal: "m/t3", program: { key: "claude" } },
    { pane: "m/p4", tab: "T", terminal: "m/t4", program: { key: "codex" } },
  ];
  const terms = [{ address: "m/t1", labels: { "ushi.chat": "pc" } }, { address: "m/t4", labels: { "ushi.chat": "pOther" } }];
  assert.deepEqual(agentsToKeep("T", panes, terms), ["m/t1"], "t4 belongs to another chat");
  assert.deepEqual(agentsToKeep("U", panes, terms), [], "no chat in U");
  assert.deepEqual(agentsToKeep("T", panes, [{ address: "m/t4", labels: {} }]), ["m/t1", "m/t4"], "unlabelled agents beside a chat");
});

test("closing the shown tab shows a visible neighbour, never a hidden terminal's tab", () => {
  const tabs = [{ id: "a" }, { id: "chat" }, { id: "hidden", settled: true }, { id: "readme" }];
  assert.equal(visibleNeighbour(tabs, "readme"), "chat", "left past the hidden tab");
  assert.equal(visibleNeighbour(tabs, "chat"), "readme", "right past the hidden tab");
  assert.equal(visibleNeighbour([{ id: "x" }, { id: "h", settled: true }], "x"), null);
  assert.equal(visibleNeighbour(tabs, "nope"), null);
});

test("parseAgentLookup: absolute paths of the chat agents only", () => {
  assert.deepEqual(parseAgentLookup("claude\t/opt/homebrew/bin/claude\ncodex\t\nnvim\t/usr/bin/nvim\nclaude2\tx\n"), { claude: "/opt/homebrew/bin/claude" });
  assert.deepEqual(parseAgentLookup("claude\tclaude: aliased to foo\n"), {}, "not a path");
  assert.deepEqual(parseAgentLookup(null), {});
});

test("withLoginAgents: a missing or uninstalled agent the login shell found becomes runnable by its path", () => {
  const list = [
    { key: "claude", name: "Claude Code", installed: false, run: ["claude"] },
    { key: "nvim", name: "Neovim", installed: true, run: ["nvim"] },
  ];
  const out = withLoginAgents(list, { claude: "/opt/homebrew/bin/claude", codex: "/usr/local/bin/codex" });
  assert.deepEqual(out.find((a) => a.key === "claude"), { key: "claude", name: "Claude Code", installed: true, run: ["/opt/homebrew/bin/claude"] });
  assert.deepEqual(out.find((a) => a.key === "nvim"), list[1], "others untouched");
  const codex = out.find((a) => a.key === "codex");
  assert.equal(codex.name, "Codex");
  assert.deepEqual([codex.installed, codex.run], [true, ["/usr/local/bin/codex"]]);
  const ok = [{ key: "claude", name: "Claude Code", installed: true, run: ["claude", "--x"] }];
  assert.deepEqual(withLoginAgents(ok, { claude: "/other/claude" }), ok, "one the app found stays as it is");
  assert.deepEqual(withLoginAgents([], {}), []);
});

test("platformFrom: uname tells macOS and Linux; PowerShell answering means Windows", () => {
  assert.equal(platformFrom({ code: 0, stdout: "Darwin\n" }, null), "macos");
  assert.equal(platformFrom({ code: 0, stdout: "Linux\n" }, null), "linux");
  assert.equal(platformFrom(null, { code: 0, stdout: "win\r\n" }), "windows");
  assert.equal(platformFrom({ code: 127, stdout: "" }, { code: 0, stdout: "win" }), "windows");
  assert.equal(platformFrom(null, null), null, "neither answered: unknown");
  assert.equal(platformFrom({ code: 0, stdout: "" }, null), null);
});

test("platformOf: this computer is the window's; another is probed once", async () => {
  const calls = [];
  const exec = async (cmd, args, { on }) => { calls.push(`${on}:${cmd}`); if (cmd === "sh") throw new Error("not installed"); return { code: 0, stdout: "win\r\n" }; };
  assert.equal(await platformOf(null, exec, "windows"), "windows");
  assert.equal(calls.length, 0);
  assert.equal(await platformOf("win-box", exec, "linux"), "windows");
  assert.equal(await platformOf("win-box", exec, "linux"), "windows");
  assert.deepEqual(calls, ["win-box:sh", "win-box:powershell"], "asked once");
});
