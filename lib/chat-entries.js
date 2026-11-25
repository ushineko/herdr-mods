// Chat sessions from the + menus (spec 008): which "New … chat" entries a menu
// offers, and which agents started for a chat pane should end. Pure: the mods
// gather what the host knows (platform, knownAgents(), a python3 check, terminals,
// panes) and pass it in.

// The agents naruse's chat can draw, by programs.json key, in menu order.
export const CHAT_AGENTS = ["claude", "codex"];

// The label on an agent started beside a chat pane: its value is that pane's id.
export const CHAT_LABEL = "hm.chat";

/**
 * The chat entries for a machine: [{ key, label, run }], empty where the chat can't
 * run (Windows, no python3 there, or neither agent installed there).
 * `agents`: knownAgents() for that machine.
 */
export function chatEntries({ platform, python, agents }) {
  if (platform === "windows" || !python) return [];
  const list = Array.isArray(agents) ? agents : [];
  return CHAT_AGENTS
    .map((key) => list.find((a) => a?.key === key && a.installed && a.run?.length))
    .filter(Boolean)
    .map((a) => ({ key: a.key, label: `New ${a.name} chat`, run: a.run }));
}

/**
 * The agents whose chat pane is gone, to end now: [address]. Only a pane seen
 * since this copy started counts (`seen`, a Set the caller keeps, which this
 * updates): a pane restored under another id after an app restart never ends its
 * agent. A pane must then be missing for `grace` ms (a reload can list panes
 * late), tracked in `missing` (a Map the caller keeps: address → first time seen
 * missing). With no panes at all listed nothing is decided.
 */
export function strayChats(terminals, paneIds, missing, now, grace = 3000, seen = new Set()) {
  const panes = new Set(paneIds);
  const out = [];
  const labelled = new Set();
  if (!panes.size) return out;
  for (const p of panes) seen.add(p);
  for (const t of terminals ?? []) {
    const pane = t?.labels?.[CHAT_LABEL];
    if (!pane || t.state !== "live" || !seen.has(pane)) continue;
    labelled.add(t.address);
    if (panes.has(pane)) { missing.delete(t.address); continue; }
    const since = missing.get(t.address);
    if (since === undefined) missing.set(t.address, now);
    else if (now - since >= grace) { out.push(t.address); missing.delete(t.address); }
  }
  for (const a of [...missing.keys()]) if (!labelled.has(a)) missing.delete(a);
  return out;
}
