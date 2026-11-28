// Reads a question an agent asks on its terminal screen (a trust or
// permission prompt): the question's text and its choices, if it has any.

const MARKER = /^(\s*)([❯›>])\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const HINT = /(Enter to (confirm|select)|Esc to (cancel|exit)|↑\/↓|to navigate)/i;
const RULE = /^\s*[─━—\-▔▁═]{8,}\s*$/;
// A dashed rule: Claude Code draws a command between two of them (herdr-mods spec 025).
const DASHED = /^\s*[╌┄┈╍]{8,}\s*$/;
// An option's preview, in a box to the right of the options; and the box's own lines.
const PREVIEW_BOX = /\s{2,}[┌│└].*$/;
const BOX_LINE = /^\s*([┌│└].*|Notes: press n to add notes)$/;
// A line drawn rather than written (spec 025 R6): box drawing, ASCII art, or columns.
const DRAWN = /[┌┐└┘├┤┬┴┼║╔╗╚╝]|^\s*[+|].*[+|]\s*$|[-=]{3,}[+>|]|[+<|][-=]{3,}|\S {3,}\S/;
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
  let tabs = null, split = -1, fenced = false;
  const text = [], review = [];
  for (const raw of lines) {
    const t = parseTabs(raw);
    if (t) { tabs = t; continue; }
    // Between dashed rules: a command, as written (a "\u0001" mark keeps it whole).
    if (DASHED.test(raw)) { fenced = !fenced; continue; }
    const l = raw.replace(/^\s*│\s?/, " ").replace(/\s+│\s*$/, "");
    if (fenced) { text.push("\u0001" + l); continue; }
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
    ? { tabs, title: reflow(text.slice(0, split)), review, question: layout(text.slice(split)), lines: text.slice(split) }
    : { tabs, title: "", review, question: layout(text), lines: text };
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
  let at = lines.findLastIndex((l) => MARKER.test(l) && !HINT.test(l));
  if (at < 0) return null;
  // A preview's box beside the options (spec 025): off the option lines, and its own
  // lines under them dropped.
  for (let i = at; i < lines.length; i++) {
    if (MARKER.test(lines[i]) || NUMBER.test(lines[i])) lines[i] = lines[i].replace(PREVIEW_BOX, "");
    else if (BOX_LINE.test(lines[i]) && lines[i].length - lines[i].trimStart().length > 8) lines[i] = "";
  }
  for (let i = at - 1; i >= 0 && (NUMBER.test(lines[i]) || /^\s+\d+[.)]\s/.test(lines[i])); i--) lines[i] = lines[i].replace(PREVIEW_BOX, "");
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
  // The text above the choices as read, for withCall (not drawn).
  Object.defineProperty(out, "lines", { value: above.lines, enumerable: false });
  return out;
}

// Lines as Markdown (spec 025 R6): runs of drawn lines (and a command between dashed
// rules) in a monospace block, as written less their common indent; the rest as
// paragraphs, terminal-wrapped lines joined.
export function layout(lines) {
  const out = [];
  let prose = [], code = [];
  const flushProse = () => { if (prose.length) out.push(reflow(prose)); prose = []; };
  const flushCode = () => {
    if (!code.length) return;
    const indent = Math.min(...code.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
    out.push("~~~~text\n" + code.map((l) => l.slice(Number.isFinite(indent) ? indent : 0).replace(/\s+$/, "")).join("\n") + "\n~~~~");
    code = [];
  };
  // A fenced block already in the text (a Mermaid diagram, code) passes through as
  // written.
  let fence = null;
  for (const raw of lines) {
    const open = /^\s*(`{3,}|~{3,})/.exec(raw);
    if (fence) { code.push(raw); if (open && open[1][0] === fence[0] && open[1].length >= fence.length && !raw.trim().slice(open[1].length).trim()) { out.push(code.join("\n")); code = []; fence = null; } continue; }
    if (open) { flushProse(); flushCode(); fence = open[1]; code.push(raw); continue; }
    const marked = raw.startsWith("\u0001"), l = marked ? raw.slice(1) : raw;
    if (marked || (l.trim() && DRAWN.test(l))) { flushProse(); code.push(l); }
    else { flushCode(); prose.push(l); }
  }
  if (fence) { out.push(code.join("\n")); code = []; }
  flushProse(); flushCode();
  return out.filter(Boolean).join("\n\n");
}

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// A question read off the screen, filled in from the tool call it asks about (spec 025
// R1-R3): the call as the agent wrote it, the screen for the choices. `call`: { name,
// input } of the session log's pending tool call. The screen's question unchanged when
// the call isn't the one on screen.
export function withCall(q, call) {
  if (!q || !call?.name || q.review) return q;
  const shown = q.options.map((o) => o.replace(/ ✓$/, ""));
  if (call.name === "AskUserQuestion") {
    const qs = call.input?.questions ?? [];
    const at = q.tabs ? Math.max(0, q.tabs.filter((x) => x.label).findIndex((x) => x.current)) : 0;
    const one = qs[Math.min(at, qs.length - 1)];
    const opts = one?.options ?? [];
    const of = (o) => opts.find((x) => x.label && (o === x.label || o.startsWith(x.label + " ")));
    if (!one || !shown.some(of)) return q;
    const details = shown.map((o, n) => of(o)?.description ?? q.details?.[n] ?? "");
    const previews = shown.map((o) => of(o)?.preview ?? "");
    const out = { ...q, question: layout(String(one.question ?? "").split("\n")) };
    if (details.some(Boolean)) out.details = details;
    if (previews.some(Boolean)) out.previews = previews;
    return out;
  }
  // A permission prompt: the call's own input, and what else the screen says.
  const i = call.input ?? {};
  const said = (q.lines ?? []).map((l) => l.replace(/^\u0001/, ""));
  const screen = squash(said.join(" "));
  const command = typeof i.command === "string" ? i.command : null;
  const file = i.file_path ?? i.notebook_path ?? i.path ?? null;
  const mine = command ? screen.includes(squash(command).slice(0, 40)) : file ? screen.includes(String(file).split("/").pop()) : false;
  if (!mine) return q;
  const cmd = squash(command), about = squash(i.description);
  // The screen's own lines less the call: its title, the command and the description.
  const first = said.findIndex((l) => l.trim());
  const rest = said.filter((l, n) => n !== first && l.trim() && !(command && cmd.includes(squash(l))) && squash(l) !== about);
  const out = { ...q, call: { name: call.name, title: first >= 0 ? said[first].trim() : call.name, command, description: i.description ?? null, file, input: i }, question: rest.map((l) => l.trim()).join("\n\n") };
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
