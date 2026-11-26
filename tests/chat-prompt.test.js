import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrompt } from "../mods/ushi-naruse/prompt.js";

test("parsePrompt: a menu's question, options and the selected one", () => {
  const screen = [
    "Do you trust the files in this folder?",
    "",
    "❯ 1. Yes, proceed",
    "  2. No, exit",
    "",
    "Enter to confirm · Esc to cancel",
  ].join("\n");
  assert.deepEqual(parsePrompt(screen), { question: "Do you trust the files in this folder?", options: ["Yes, proceed", "No, exit"], selected: 0 });
});

test("parsePrompt: a command's echo and its output are not a menu", () => {
  const screen = [
    "✻ Baked for 1m 5s · done 1:26 PM",
    "",
    "❯ /login",
    "  ⎿  Login interrupted",
    "",
    "────────────────────────────────────────",
    "❯ ",
    "────────────────────────────────────────",
  ].join("\n");
  assert.equal(parsePrompt(screen), null);
  // The echo last on screen (as the panel read it after /login was interrupted): the
  // old parser made it a menu of "/login" and "⎿ Login interrupted".
  assert.equal(parsePrompt(["✻ Baked for 1m 5s · done 1:26 PM", "", "❯ /login", "  ⎿  Login interrupted", ""].join("\n")), null);
});
