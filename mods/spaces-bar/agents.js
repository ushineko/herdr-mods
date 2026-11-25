// Agents the person should see: the app's own (terminals with a pane) plus
// nested-tab agents (pane-less terminals the nested-tabs mod labels
// nt.stack=<pane>), which the app only knows as sub-agents of a parent agent.

import { agents, terminals, panes, spaces, run, setShared } from "herdr";

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
export const ORDER = ["blocked", "done", "working", "idle"];
const norm = (s) => (s === "error" ? "blocked" : s);

export function allAgents() {
  const out = new Map();
  for (const a of agents()) {
    out.set(a.address, {
      address: a.address, status: norm(a.status), space: a.space, tab: a.tab, tab_name: a.tab_name,
      pane: a.pane, program: a.program, title: a.pane_name || a.program?.name || a.title, nested: false,
    });
  }
  const byPane = new Map(panes().map((p) => [p.pane, p]));
  const tabInfo = new Map();
  for (const s of spaces()) for (const t of s.tabs) tabInfo.set(t.id, { space: s.id, tab_name: t.name });
  for (const t of terminals()) {
    const pane = t.labels?.["nt.stack"];
    if (!pane || t.state !== "live" || out.has(t.address)) continue;
    if (!t.program?.agent && !t.status) continue;
    const p = byPane.get(pane);
    if (!p) continue;
    const info = tabInfo.get(p.tab) ?? {};
    out.set(t.address, {
      address: t.address, status: norm(t.status) || "idle", space: info.space, tab: p.tab, tab_name: info.tab_name,
      pane, program: t.program, title: t.labels?.["nt.title"] || t.program?.name || t.title, nested: true,
    });
  }
  // An agent a chat shows (spec 008; label ushi.chat=<chat pane>) is listed in the
  // chat's tab and opens the chat: its terminal may sit hidden in a settled tab, or
  // have no pane at all.
  // The label holds the pane id without its machine part (one form for every window).
  const local = (id) => String(id ?? "").slice(String(id ?? "").lastIndexOf("/") + 1);
  const byLocal = new Map(panes().filter((p) => p.mod === "ushi-naruse").map((p) => [local(p.pane), p]));
  for (const t of terminals()) {
    const chat = t.labels?.["ushi.chat"] ? byLocal.get(local(t.labels["ushi.chat"])) : null;
    if (!chat || t.state !== "live") continue;
    const info = tabInfo.get(chat.tab) ?? {};
    const was = out.get(t.address);
    if (!was && !t.program?.agent && !t.status) continue;
    out.set(t.address, {
      address: t.address, status: was?.status ?? (norm(t.status) || "idle"), program: was?.program ?? t.program,
      title: was?.title ?? t.program?.name ?? t.title, space: info.space, tab: chat.tab, tab_name: info.tab_name,
      pane: chat.pane, nested: false, chat: true,
    });
  }
  return [...out.values()];
}

export function worst(list) {
  let best = null;
  for (const a of list) if (!best || (RANK[a.status] ?? 0) > (RANK[best] ?? 0)) best = a.status;
  return best;
}

// Show an agent: its space, its tab, and for a nested one its nested tab
// (nested-tabs picks up the request), then focus its pane.
export function focusAgent(a) {
  if (a.space) run("space.select", { id: a.space });
  if (a.tab) run("tab.select", { id: a.tab });
  if (a.nested) setShared("nested-tabs.request", { pane: a.pane, terminal: a.address, at: Date.now() });
  run("pane.focus", { pane: a.pane });
}
