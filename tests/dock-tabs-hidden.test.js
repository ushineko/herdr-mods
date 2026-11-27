import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXED, hiddenIn, isHidden, hide, show, moveTo, forget, visibleNames, otherDock } from "../lib/dock-tabs-hidden.js";

test("hide is refused when the subtab would be shown nowhere, else recorded once", () => {
  const r1 = hide({}, "dock-bottom", "dock-t1", false);
  assert.equal(r1.ok, false);
  assert.deepEqual(r1.state, {});
  const r2 = hide({}, "dock-bottom", "dock-t1", true);
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.state, { "dock-bottom": ["dock-t1"] });
  assert.deepEqual(hide(r2.state, "dock-bottom", "dock-t1", true).state, r2.state, "hidden twice is hidden once");
  assert.equal(isHidden(r2.state, "dock-bottom", "dock-t1"), true);
  assert.equal(isHidden(r2.state, "dock-right", "dock-t1"), false);
  assert.deepEqual(hiddenIn(r2.state, "dock-bottom"), ["dock-t1"]);
  assert.deepEqual(hiddenIn(null, "dock-bottom"), []);
  assert.deepEqual(hiddenIn({ "dock-bottom": "junk" }, "dock-bottom"), []);
});

test("show, move and forget", () => {
  let s = hide({}, "dock-bottom", "dock-t1", true).state;
  s = show(s, "dock-bottom", "dock-t1");
  assert.deepEqual(s, { "dock-bottom": [] });
  s = moveTo({}, "dock-bottom", "dock-right", "mod:jira-viewer");
  assert.deepEqual(s, { "dock-right": [], "dock-bottom": ["mod:jira-viewer"] });
  s = moveTo(s, "dock-right", "dock-bottom", "mod:jira-viewer");
  assert.deepEqual(s, { "dock-bottom": [], "dock-right": ["mod:jira-viewer"] });
  s = hide(s, "dock-bottom", FIXED, true).state;
  assert.deepEqual(forget(s, "mod:jira-viewer"), { "dock-bottom": [FIXED], "dock-right": [] });
  assert.equal(otherDock("dock-bottom"), "dock-right");
  assert.equal(otherDock("dock-right"), "dock-bottom");
});

test("visibleNames: hidden names are left out, the fixed subtab stays when nothing else would show", () => {
  const names = ["dock-t1", "mod:jira-viewer"];
  assert.deepEqual(visibleNames(names, {}, "dock-bottom"), { fixed: true, names });
  const s = { "dock-bottom": [FIXED], "dock-right": ["mod:jira-viewer"] };
  assert.deepEqual(visibleNames(names, s, "dock-bottom"), { fixed: false, names });
  assert.deepEqual(visibleNames(names, s, "dock-right"), { fixed: true, names: ["dock-t1"] });
  assert.deepEqual(visibleNames([], { "dock-bottom": [FIXED] }, "dock-bottom"), { fixed: true, names: [] }, "never empty");
  assert.deepEqual(visibleNames(["dock-t1"], { "dock-bottom": [FIXED, "dock-t1"] }, "dock-bottom"), { fixed: true, names: [] });
});
