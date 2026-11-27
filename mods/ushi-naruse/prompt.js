// Reads a question an agent asks on its terminal screen (a trust or
// permission prompt): the question's text and its choices, if it has any.

const MARKER = /^(\s*)([❯›>])\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const HINT = /(Enter to (confirm|select)|Esc to (cancel|exit)|↑\/↓|to navigate)/i;
const RULE = /^\s*[─━—\-▔▁═]{8,}\s*$/;
// ushi-naruse: a command's output under its echo ("❯ /login" then "⎿ Login
// interrupted"): never a choice, so an echo and its answer don't read as a menu.
const OUTPUT = /^\s*[⎿└]/;

// A menu waiting at the bottom of the screen: its hint line ("Enter to confirm ·
// Esc to cancel") is among the last lines. "form" when ←/→ change its values,
// which a pick-one list can't show.
export function menuAtBottom(screen) {
  let lines = (screen ?? "").split("\n").filter((l) => l.trim());
  // Claude keeps its input box (a rule, ❯, a rule, its footer) under the menu.
  const rules = lines.flatMap((l, i) => (RULE.test(l) ? [i] : []));
  const box = rules.at(-2);
  if (box !== undefined && lines.length - box <= 6 && /^\s*❯/.test(lines[box + 1] ?? "")) lines = lines.slice(0, box);
  const hint = lines.slice(-2).find((l) => HINT.test(l));
  return hint ? (/←|→|to change/.test(hint) ? "form" : "menu") : null;
}

// A pick-any question: its choices' boxes, and the item that goes on to the next question.
const CHECK = /^\[([ ✔✓x])\]\s*/;
const NEXT = /^(Next|Submit)$/;

// A multi-question form's tab bar ("←  ☒ Scope  ☐ Approach  ✔ Submit  →"): its tabs,
// each { label, done }; the one shown is the first not done (Submit once all are).
const TABS = /^\s*(?:←\s*)?((?:[☐☒✔]\s+[^☐☒✔→]+?\s*){2,})(?:→\s*)?$/;
function parseTabs(line) {
  const m = TABS.exec(line ?? "");
  if (!m) return null;
  const tabs = [...m[1].matchAll(/([☐☒✔])\s+([^☐☒✔]+?)\s*(?=[☐☒✔]|$)/g)].map((x) => ({ label: x[2].trim(), done: x[1] !== "☐", submit: x[1] === "✔" }));
  const at = tabs.findIndex((x) => !x.done);
  return tabs.map((x, i) => ({ label: x.label, done: x.done && !x.submit, current: at < 0 ? x.submit : i === at }));
}

// The text above a menu: the form's tabs, a review page's questions and answers ("●
// question" then "→ answer"), and the question itself. A "│" bar the form draws at
// the left of a line is not text.
function aboveMenu(lines) {
  let tabs = null, split = -1;
  const text = [], review = [];
  for (const raw of lines) {
    const t = parseTabs(raw);
    if (t) { tabs = t; continue; }
    const l = raw.replace(/^\s*│\s?/, " ");
    const q = /^\s*●\s+(.*)$/.exec(l), a = /^\s*→\s+(.*)$/.exec(l);
    if (q) {
      if (split < 0) split = text.length;
      review.push({ question: q[1].trim(), answer: "" });
    } else if (a && review.length) review.at(-1).answer = a[1].trim();
    // A review line wrapped: deeper than the list, straight under it.
    else if (review.length && text.length === split && /^\s{3,}\S/.test(l)) {
      const last = review.at(-1);
      if (last.answer) last.answer += " " + l.trim(); else last.question += " " + l.trim();
    } else text.push(l);
  }
  // Text before the review list is its title; after it, the question.
  return review.length
    ? { tabs, title: reflow(text.slice(0, split)), review, question: reflow(text.slice(split)) }
    : { tabs, title: "", review, question: reflow(text) };
}

// { question, options: [text], selected } or null when the screen has no menu. A
// form adds what it shows: `details` (each option's description, "" for none),
// `tabs` ([{ label, done, current }]), and on its review page `title` and `review`
// ([{ question, answer }]); a pick-any question `checks` (each choice ticked or not)
// and `next` (an item under the choices that goes on; `selected` is options.length
// while it is the one selected).
export function parsePrompt(screen) {
  // A ✔ marks the current choice; read it as an indent, so its line lines up.
  const current = new Set();
  const lines = (screen ?? "").split("\n").map((l, i) => {
    const m = /^(\s*(?:[❯›>]\s+)?)[✔✓]\s/.exec(l);
    if (!m) return l;
    current.add(i);
    return m[1] + "  " + l.slice(m[0].length);
  });
  const at = lines.findLastIndex((l) => MARKER.test(l) && !HINT.test(l));
  if (at < 0) return null;
  // Unselected options sit where the marker's text starts; deeper lines continue one.
  // (The marker and one space: on a pick-any question's Next, more spaces follow it.)
  const indent = /^\s*[❯›>]\s/.exec(lines[at])[0].length;
  const depth = (l) => l.length - l.trimStart().length;
  const isOption = (l) => !OUTPUT.test(l) && (MARKER.test(l) || (l.trim() && depth(l) === indent && !HINT.test(l) && !RULE.test(l)));
  const continues = (l) => l.trim() && !OUTPUT.test(l) && depth(l) > indent && !HINT.test(l) && !RULE.test(l);

  let first = at;
  while (first > 0 && (isOption(lines[first - 1]) || continues(lines[first - 1]))) first--;
  while (first < at && !isOption(lines[first])) first++;
  let last = at;
  while (last + 1 < lines.length && (isOption(lines[last + 1]) || continues(lines[last + 1]))) last++;
  const options = [], details = [], numbered = [], checks = [];
  let selected = 0, next = false;
  for (let i = first; i <= last; i++) {
    const l = lines[i];
    let text = l.replace(MARKER, "").replace(NUMBER, "").trim();
    // A pick-any question's own step on ("Next"): an item under its options, not one.
    if (!NUMBER.test(l.replace(MARKER, "")) && NEXT.test(text) && options.length) {
      next = true;
      if (i === at) selected = options.length;
      continue;
    }
    // A pick-any question's box before each choice: [ ] or [✔].
    const box = isOption(l) ? CHECK.exec(text) : null;
    if (box) text = text.slice(box[0].length).trim();
    // A numbered option's deeper lines are its description (Claude Code's questions);
    // an unnumbered one's are its label wrapped.
    if (!isOption(l)) {
      const n = options.length - 1;
      if (numbered[n]) details[n] = (details[n] ? details[n] + " " : "") + text;
      else options[n] += " " + text;
      continue;
    }
    if (i === at) selected = options.length;
    numbered[options.length] = NUMBER.test(l.replace(MARKER, ""));
    checks.push(box ? box[1] !== " " : null);
    options.push(current.has(i) ? `${text} ✓` : text);
    details.push("");
  }
  if (options.length < 2) return null;

  // The question: what's above the options, back to the last rule line.
  let top = first;
  while (top > 0 && !RULE.test(lines[top - 1])) top--;
  const above = aboveMenu(lines.slice(top, first));
  const out = { question: above.question, options, selected };
  if (details.some(Boolean)) out.details = details;
  if (checks.some((c) => c !== null)) out.checks = checks;
  if (next) out.next = true;
  if (above.tabs) out.tabs = above.tabs;
  if (above.review.length) Object.assign(out, { title: above.title, review: above.review });
  return out;
}

// Terminal-wrapped text as paragraphs.
export function reflow(lines) {
  return lines.map((l) => l.trim()).join("\n").replace(/\n{2,}/g, "\u0000").replace(/\n/g, " ")
    .split("\u0000").map((p) => p.trim()).filter(Boolean).join("\n\n");
}

// The keys that move the selection from `from` to `to` and confirm it.
export function choose(from, to) {
  const keys = Array(Math.abs(to - from)).fill(to > from ? "down" : "up");
  return [...keys, "enter"];
}
