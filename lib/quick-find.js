// The quick switcher (spec 016): what a window has open, as searchable items, and
// the search over them. Pure: plain data in and out.
import { tabEntry } from "./tab-order.js";

/**
 * What a window has open, from the app's lists: [{ key, kind, title, project, place,
 * machine, program, at, steps, nested? }]. `kind` is "tab", "nested", "space" or
 * "machine"; `steps` are the app commands that show it ([[command, args], ...]);
 * `at` is when it was last used (from the Ctrl+Tab order, 0 when never). Settled
 * tabs (a chat's hidden agent terminal) are left out. A nested tab is one of the
 * terminals nested-tabs keeps in a pane: labelled nt.stack, children of the pane's
 * own terminal (#53). `nested` says which, for nested-tabs to show it.
 */
export function findItems({ spaces = [], panes = [], terms = [], order = [] }) {
  const used = new Map(order.map((e) => [e.key, e.at ?? 0]));
  const items = [];
  const spaceAt = new Map();
  for (const s of spaces) {
    const machine = s.machine ?? null;
    let latest = 0;
    for (const t of s.tabs.filter((x) => !x.settled)) {
      const e = tabEntry(t, s, panes, terms);
      const at = used.get(t.id) ?? 0;
      latest = Math.max(latest, at);
      items.push({
        key: `tab:${t.id}`, kind: "tab", title: e.title, project: e.project, place: s.name, machine,
        program: e.program, at, steps: [["space.select", { id: s.id }], ["tab.select", { id: t.id }]],
      });
    }
    spaceAt.set(s.id, latest);
    items.push({ key: `space:${s.id}`, kind: "space", title: s.name, project: null, place: machine ?? "", machine, program: null, at: latest, steps: [["space.select", { id: s.id }]] });
  }
  // A machine: its most recently used space.
  const machines = new Map();
  for (const s of spaces) {
    if (!s.machine) continue;
    const best = machines.get(s.machine);
    if (!best || spaceAt.get(s.id) > spaceAt.get(best.id)) machines.set(s.machine, s);
  }
  for (const [name, s] of machines) {
    items.push({ key: `machine:${name}`, kind: "machine", title: name, project: null, place: s.name, machine: name, program: null, at: spaceAt.get(s.id) ?? 0, steps: [["space.select", { id: s.id }]] });
  }
  // Nested tabs: in the tab of the pane they're stacked in.
  const tabSpace = new Map(spaces.flatMap((s) => s.tabs.map((t) => [t.id, s])));
  for (const t of terms) {
    const host = nestedPane(t, panes);
    if (!host || t.state !== "live") continue;
    const pane = host.pane, tab = host.tab;
    const s = tab ? tabSpace.get(tab) : null;
    if (!s) continue;
    const folder = String(t.foreground?.cwd || t.cwd || "").replace(/[\\/]+$/, "");
    items.push({
      key: `nested:${t.address}`, kind: "nested", title: t.labels?.["nt.title"] || t.title || t.program?.name || t.address,
      project: folder ? folder.split(/[\\/]/).pop() : null, place: s.name, machine: s.machine ?? null,
      program: t.program ? { name: t.program.name, icon: t.program.icon ?? null, tint: Boolean(t.program.tint) } : null,
      at: used.get(tab) ?? 0, nested: { pane, terminal: t.address },
      steps: [["space.select", { id: s.id }], ["tab.select", { id: tab }], ["pane.focus", { pane }]],
    });
  }
  return items;
}

/**
 * The pane (panes()' entry) a nested tab is stacked in: the one showing its parent,
 * the pane's own terminal; null for a terminal that isn't a nested tab (#53: the
 * pane's id isn't kept, since it changes when the pane moves).
 */
export function nestedPane(term, panes) {
  if (!term?.labels?.["nt.stack"] || !term.parent) return null;
  return (panes ?? []).find((p) => p.terminal === term.parent) ?? null;
}

const KIND_WORD = { tab: "tab", nested: "nested tab", space: "space", machine: "machine" };
const RANK = { tab: 0, nested: 1, space: 2, machine: 3 };

/**
 * How well `word` matches `text` (both any case): 100 when the text starts with it,
 * 80 when a word in it does, 60 when it's anywhere in it, 30 or less for its letters
 * in order (fewer gaps, more), null when it doesn't match. `at`: where the match
 * starts (letters in order: the first letter's), for marking it.
 */
export function wordScore(word, text) {
  const w = String(word).toLowerCase(), t = String(text ?? "").toLowerCase();
  if (!w) return { score: 0, at: -1 };
  if (!t) return null;
  if (t.startsWith(w)) return { score: 100, at: 0 };
  const re = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  const b = re.exec(t);
  if (b) return { score: 80, at: b.index + b[1].length };
  const i = t.indexOf(w);
  if (i >= 0) return { score: 60, at: i };
  let k = 0, first = -1, gaps = 0, last = -1;
  for (let j = 0; j < t.length && k < w.length; j++) {
    if (t[j] !== w[k]) continue;
    if (first < 0) first = j;
    if (last >= 0 && j > last + 1) gaps++;
    last = j; k++;
  }
  return k === w.length ? { score: Math.max(5, 30 - gaps * 3), at: first } : null;
}

/**
 * The items for a query, best first, at most `limit`. Every word has to match one of
 * an item's fields (its title counts most; then project, place, machine, kind); the
 * score adds the words' best. Ties: most recently used, then tabs before nested tabs,
 * spaces and machines. An empty query: tabs and nested tabs by use, then spaces and
 * machines. Each result carries `mark`: where its title matched (or -1).
 */
export function quickFind(items, query, limit = 50) {
  const words = String(query ?? "").trim().split(/\s+/).filter(Boolean);
  const byUse = (a, b) => (b.at ?? 0) - (a.at ?? 0) || RANK[a.kind] - RANK[b.kind];
  if (!words.length) {
    const near = items.filter((x) => x.kind === "tab" || x.kind === "nested").sort(byUse);
    const far = items.filter((x) => x.kind === "space" || x.kind === "machine").sort(byUse);
    return [...near, ...far].slice(0, limit).map((x) => ({ ...x, mark: -1 }));
  }
  const fields = [["title", 1], ["project", 0.8], ["place", 0.6], ["machine", 0.6]];
  const scored = [];
  for (const it of items) {
    let total = 0, mark = -1, ok = true;
    for (const w of words) {
      let best = null;
      for (const [f, weight] of fields) {
        const m = wordScore(w, it[f]);
        if (m && (!best || m.score * weight > best.s)) best = { s: m.score * weight, f, at: m.at };
      }
      const k = wordScore(w, KIND_WORD[it.kind]);
      if (k && (!best || k.score * 0.4 > best.s)) best = { s: k.score * 0.4, f: "kind", at: -1 };
      if (!best) { ok = false; break; }
      total += best.s;
      if (best.f === "title" && mark < 0) mark = best.at;
    }
    if (ok) scored.push({ ...it, score: total, mark });
  }
  return scored.sort((a, b) => b.score - a.score || byUse(a, b)).slice(0, limit);
}
