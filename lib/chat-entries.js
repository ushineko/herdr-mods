// Chat sessions from the + menus (spec 008): which "New … chat" entries a menu
// offers, and which agents started for a chat pane should end. Pure: the mods
// gather what the host knows (platform, knownAgents(), a python3 check, terminals,
// panes) and pass it in.

// The agents naruse's chat can draw, by programs.json key, in menu order.
export const CHAT_AGENTS = ["claude", "codex"];

// The label on an agent started for a chat pane: its value is that pane's id. The agent
// ends when that pane closes.
export const CHAT_LABEL = "hm.chat";

// The label on every agent a chat pane shows (new or opened as chat): that pane's id.
// Mods use it to treat the chat as the agent (follow, the agents list, the × button);
// a mod pane's props don't carry its own pane id, so the opener sets it.
export const OWNER_LABEL = "ushi.chat";

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
  const owners = (terminals ?? []).map((t) => ({ address: t?.address, owner: t?.labels?.[CHAT_LABEL], live: t?.state === "live" }));
  return gone(owners, paneIds, missing, now, grace, seen, (paneIds ?? []).length > 0).map((o) => o.address);
}

// The label naruse's chat puts on an agent terminal it hid ("Hide terminal"): the
// chat's tab id on the terminal's machine. The terminal then sits in a settled tab.
export const HIDDEN_LABEL = "chat.tab";

/**
 * Hidden agent terminals whose chat was closed, to show again: [{ address, tab }]
 * (`tab`: the settled tab holding the terminal, as panes() names tabs). `chatTabs`:
 * the tabs holding a chat now, as panes() names them ("<machine>/<id>" elsewhere).
 * Same waiting rules as strayChats; `listed` false (no panes listed yet) decides nothing.
 */
export function orphanedHidden(terminals, chatTabs, missing, now, grace = 3000, seen = new Set(), listed = true) {
  const owners = (terminals ?? []).map((t) => {
    const at = t?.address ?? "";
    const m = at.includes("/") ? at.slice(0, at.indexOf("/")) + "/" : "";
    const home = t?.labels?.[HIDDEN_LABEL], tab = t?.labels?.["herdr.tab"];
    return { address: at, owner: home ? m + home : null, tab: tab ? m + tab : null, live: t?.state === "live" };
  });
  return gone(owners.filter((o) => o.tab && o.tab !== o.owner), chatTabs, missing, now, grace, seen, listed)
    .map(({ address, tab }) => ({ address, tab }));
}

// The items whose owner (a pane or tab id) was seen in this run and has now been
// missing for `grace` ms. `missing`: address → first time seen missing. Nothing is
// decided unless `listed` (the host listed its panes).
function gone(items, present, missing, now, grace, seen, listed) {
  const here = new Set(present);
  const out = [];
  const tracked = new Set();
  if (!listed) return out;
  for (const p of here) seen.add(p);
  for (const it of items) {
    if (!it.owner || !it.live || !seen.has(it.owner)) continue;
    tracked.add(it.address);
    if (here.has(it.owner)) { missing.delete(it.address); continue; }
    const since = missing.get(it.address);
    if (since === undefined) missing.set(it.address, now);
    else if (now - since >= grace) { out.push(it); missing.delete(it.address); }
  }
  for (const a of [...missing.keys()]) if (!tracked.has(a)) missing.delete(a);
  return out;
}
