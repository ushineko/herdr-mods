import { test } from "node:test";
import assert from "node:assert/strict";
import { tabEntry, recordTab, liveOrder, switcherList } from "../lib/tab-order.js";

const space = { id: "sp1", name: "herdr-mods", machine: null };

test("tabEntry: a chat's tab is titled after its agent's conversation, with the project", () => {
  const tab = { id: "tbA", name: "1" };
  const panes = [{ tab: "tbA", pane: "p1", mod: "ushi-naruse", title: "ushi-naruse", focused: true }];
  const terms = [{ address: "t1y", title: "Herdr-mods follow and tab bugs", cwd: "/u/sysadmin", foreground: { cwd: "/u/git/herdr-mods" }, labels: { "chat.tab": "tbA" }, program: { name: "Claude Code", icon: "icons/claude.svg", tint: false } }];
  assert.deepEqual(tabEntry(tab, space, panes, terms), {
    key: "tbA", tab: "tbA", space: "sp1", machine: null, tabName: "1", spaceName: "herdr-mods",
    title: "Herdr-mods follow and tab bugs", project: "herdr-mods", program: { name: "Claude Code", icon: "icons/claude.svg", tint: false }, chat: true,
  });
});

test("tabEntry: a shell's tab: its program's name when the title is a path; a remote space's machine", () => {
  const e = tabEntry({ id: "njv/tbB", name: "3" }, { id: "njv/sp2", name: "projects", machine: "njv-cachyos-default" },
    [{ tab: "njv/tbB", terminal: "njv/t5", title: "~/git/hayami", program: { name: "zsh", icon: null } }],
    [{ address: "njv/t5", title: "~/git/hayami", cwd: "/home/me/git/hayami", program: { name: "zsh", icon: null } }]);
  assert.equal(e.title, "zsh");
  assert.equal(e.project, "hayami");
  assert.equal(e.machine, "njv-cachyos-default");
});

test("recordTab: the shown tab moves to the front; the list is capped", () => {
  let o = [];
  o = recordTab(o, { key: "a" }, 1);
  o = recordTab(o, { key: "b" }, 2);
  o = recordTab(o, { key: "a" }, 3);
  assert.deepEqual(o.map((e) => [e.key, e.at]), [["a", 3], ["b", 2]]);
  for (let i = 0; i < 100; i++) o = recordTab(o, { key: `k${i}` }, i);
  assert.equal(o.length, 60);
});

test("liveOrder: recorded tabs in their order with today's details; gone ones out; new ones after", () => {
  const order = [{ key: "b", title: "old", at: 5 }, { key: "gone", at: 4 }, { key: "a", at: 3 }];
  const got = liveOrder(order, [{ key: "a", title: "A" }, { key: "b", title: "B" }, { key: "c", title: "C" }]);
  assert.deepEqual(got.map((e) => [e.key, e.title, e.at]), [["b", "B", 5], ["a", "A", 3], ["c", "C", 0]]);
});

test("switcherList: the shown tab first, then everything by when it was last shown, other windows included", () => {
  const own = [{ key: "a", at: 9 }, { key: "b", at: 5 }, { key: "c", at: 1 }];
  const others = [{ window: { title: "Work window" }, order: [{ key: "w1", at: 7 }, { key: "w2", at: 2 }] }];
  assert.deepEqual(switcherList(own, others).map((e) => e.key), ["a", "w1", "b", "w2", "c"]);
});
