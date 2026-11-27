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

// Claude Code's multi-question form (AskUserQuestion), as the screen shows it
// (v2.1.326, 2026-11-27; rules shortened).
const RULE_LINE = "─".repeat(60);
const FORM_Q1 = [
  RULE_LINE,
  "←  ☐ Scope  ☐ Approach  ✔ Submit  →",
  "",
  "│ Which parts of the viewer should the next round of work cover, given the remaining budget and the fact that Windows has not been checked in a real window yet?",
  "",
  "❯ 1. Only the notebook viewer, because it is the most used and the cheapest to finish",
  "     Limits this round to the notebook viewer, which keeps the budget small and the scope easy to verify.",
  "  2. The notebook viewer and the diff, since they share the Markdown renderer and the colour code",
  "     Covers two viewers that reuse the same Markdown renderer and colour code, so one fix serves both.",
  "  3. Type something.",
  RULE_LINE,
  "  4. Chat about this",
  "",
  "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
].join("\n");

const FORM_REVIEW = [
  RULE_LINE,
  "←  ☒ Scope  ☒ Approach  ✔ Submit  →",
  "",
  "Review your answers",
  "",
  " │ ● Which parts of the viewer should the next round of work cover, given the remaining budget?",
  "   → The notebook viewer and the diff, since they share the Markdown renderer and the colour code",
  " ● How should the work be checked before it is committed?",
  "   → Unit tests and screenshots on every machine, read back one by one",
  "",
  "Ready to submit your answers?",
  "",
  "❯ 1. Submit answers",
  "  2. Cancel",
].join("\n");

test("parsePrompt: a form's question without its tab bar or │; each option's description apart from its label", () => {
  const q = parsePrompt(FORM_Q1);
  assert.equal(q.question, "Which parts of the viewer should the next round of work cover, given the remaining budget and the fact that Windows has not been checked in a real window yet?");
  assert.deepEqual(q.options, [
    "Only the notebook viewer, because it is the most used and the cheapest to finish",
    "The notebook viewer and the diff, since they share the Markdown renderer and the colour code",
    "Type something.",
  ]);
  assert.deepEqual(q.details, [
    "Limits this round to the notebook viewer, which keeps the budget small and the scope easy to verify.",
    "Covers two viewers that reuse the same Markdown renderer and colour code, so one fix serves both.",
    "",
  ]);
  assert.equal(q.selected, 0);
  assert.deepEqual(q.tabs, [{ label: "Scope", done: false, current: true }, { label: "Approach", done: false, current: false }, { label: "Submit", done: false, current: false }]);
});

test("parsePrompt: a form's review page lists each question with its answer", () => {
  const q = parsePrompt(FORM_REVIEW);
  assert.equal(q.title, "Review your answers");
  assert.deepEqual(q.review, [
    { question: "Which parts of the viewer should the next round of work cover, given the remaining budget?", answer: "The notebook viewer and the diff, since they share the Markdown renderer and the colour code" },
    { question: "How should the work be checked before it is committed?", answer: "Unit tests and screenshots on every machine, read back one by one" },
  ]);
  assert.equal(q.question, "Ready to submit your answers?");
  assert.deepEqual(q.options, ["Submit answers", "Cancel"]);
  assert.deepEqual(q.tabs.map((x) => [x.label, x.done, x.current]), [["Scope", true, false], ["Approach", true, false], ["Submit", false, true]]);
});

const FORM_MULTI = (marker) => [
  RULE_LINE,
  "←  ☒ Pick  ☐ Last  ✔ Submit  →",
  "",
  "Which did you notice?",
  "",
  `${marker === 0 ? "❯" : " "} 1. [✔] Height change`,
  "         The box moved",
  "  2. [ ] Raw text",
  "         Plain lines flashed",
  "  3. [ ] Type something",
  marker === "next" ? "❯    Next" : "     Next",
  RULE_LINE,
  "  4. Chat about this",
  "",
  "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
].join("\n");

test("parsePrompt: a pick-any question's boxes, and Next as its own item", () => {
  const q = parsePrompt(FORM_MULTI(0));
  assert.deepEqual(q.options, ["Height change", "Raw text", "Type something"]);
  assert.deepEqual(q.checks, [true, false, false]);
  assert.deepEqual(q.details, ["The box moved", "Plain lines flashed", ""]);
  assert.equal(q.next, true);
  assert.equal(q.selected, 0);
  // Next selected: past the last choice.
  const n = parsePrompt(FORM_MULTI("next"));
  assert.equal(n.next, true);
  assert.equal(n.selected, 3);
  assert.deepEqual(n.options, ["Height change", "Raw text", "Type something"]);
});
