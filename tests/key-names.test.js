import { test } from "node:test";
import assert from "node:assert/strict";
import { keyFor, dockTooltip } from "../lib/key-names.js";

const bindings = [
  { keys: "ctrl-shift-y", action: "layout.toggle:dock-right" },
  { keys: "alt-shift-y", action: "layout.toggle", args: { id: "dock-bottom" } },
  { keys: "cmd-k", action: "app.palette" },
];

test("keyFor: a binding given whole or as action + id, written per platform", () => {
  assert.equal(keyFor(bindings, "layout.toggle:dock-right", "linux"), "Ctrl+Shift+Y");
  assert.equal(keyFor(bindings, "layout.toggle:dock-bottom", "linux"), "Alt+Shift+Y");
  assert.equal(keyFor(bindings, "layout.toggle:dock-right", "macos"), "⌃⇧Y");
  assert.equal(keyFor(bindings, "app.palette", "macos"), "⌘K");
  assert.equal(keyFor(bindings, "app.palette", "windows"), "Super+K");
});

test("keyFor: null for an unbound action, and without bindings", () => {
  assert.equal(keyFor(bindings, "layout.toggle:dock-left", "linux"), null);
  assert.equal(keyFor(null, "app.palette", "linux"), null);
});

test("dockTooltip: Hide for a shown dock, Show for a hidden one, the key in brackets when there is one", () => {
  assert.equal(dockTooltip("dock-right", true, "Ctrl+Shift+Y"), "Hide the right dock (Ctrl+Shift+Y)");
  assert.equal(dockTooltip("dock-bottom", false, "Alt+Shift+Y"), "Show the bottom dock (Alt+Shift+Y)");
  assert.equal(dockTooltip("dock-bottom", false, null), "Show the bottom dock");
});
