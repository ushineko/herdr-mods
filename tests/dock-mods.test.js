import { test } from "node:test";
import assert from "node:assert/strict";
import { modTabName, isModTab, modOfTab, dockMods, dockModIcon, modNamesFrom } from "../lib/dock-mods.js";

test("a mod subtab's name round-trips and is told from a terminal's", () => {
  assert.equal(modTabName("jira-viewer"), "mod:jira-viewer");
  assert.equal(isModTab("mod:jira-viewer"), true);
  assert.equal(isModTab("dock-t1abc"), false);
  assert.equal(isModTab(null), false);
  assert.equal(modOfTab("mod:jira-viewer"), "jira-viewer");
  assert.equal(modOfTab("dock-t1abc"), null);
});

test("dockMods: only mods with a dock entry, in name order, with a safe icon name", () => {
  const got = dockMods([
    { name: "nav", json: '{"place":"none"}' },
    { name: "zeta", json: '{"dock":{"title":"Zeta","icon":"../../etc/passwd"}}' },
    { name: "jira-viewer", json: '{"dock":{"title":" Jira ","icon":"icon"}}' },
    { name: "broken", json: "{" },
    { name: "notitle", json: '{"dock":{"icon":"x"}}' },
    { name: "../x", json: '{"dock":{"title":"X"}}' },
  ]);
  assert.deepEqual(got, [{ mod: "jira-viewer", title: "Jira", icon: "icon" }, { mod: "zeta", title: "Zeta", icon: "icon" }]);
  assert.equal(dockModIcon(got[0]), "mods/jira-viewer/icon.svg");
});

test("modNamesFrom: the names under the mods folder, nothing else", () => {
  const dir = "/home/x/.config/herdr-app/mods";
  assert.deepEqual(modNamesFrom(`${dir}/jira-viewer/mod.json\n${dir}/nav/mod.json\n/etc/mod.json\n${dir}/a b/mod.json\n`, dir), ["jira-viewer", "nav"]);
  assert.deepEqual(modNamesFrom("", dir), []);
});
