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

// The label naming an agent for its chats in every window (addresses differ between
// windows); the chat's props carry the same id.
export const ID_LABEL = "ushi.id";

/** A new id for ID_LABEL. */
export const newChatId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/**
 * An id without its machine part: "njv-cachyos-default/p7" and "p7" are one pane, named
 * from another computer's window and from its own. Labels hold, and comparisons use,
 * this form, so every window reads them alike.
 */
export const localId = (id) => (id == null ? null : String(id).slice(String(id).lastIndexOf("/") + 1));

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
  const owners = (terminals ?? []).map((t) => ({ address: t?.address, owner: localId(t?.labels?.[CHAT_LABEL]), live: t?.state === "live" }));
  return gone(owners, (paneIds ?? []).map(localId), missing, now, grace, seen, (paneIds ?? []).length > 0).map((o) => o.address);
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

/**
 * Hidden agent terminals' tabs this window shows as ordinary tabs, to settle: the app
 * keeps "settled" per window, so a chat that hid its terminal in another window left
 * the tab showing here. `tabs`: this window's tabs ({ id, settled, active }), ids as
 * panes() names them; `chatTabs`: the tabs holding a chat. A tab that's shown, or
 * whose chat is gone (orphanedHidden's case), is left alone.
 */
export function toSettle(terminals, chatTabs, tabs) {
  const chats = new Set(chatTabs);
  const byId = new Map((tabs ?? []).map((t) => [t.id, t]));
  const out = [];
  for (const t of terminals ?? []) {
    const at = t?.address ?? "";
    const m = at.includes("/") ? at.slice(0, at.indexOf("/")) + "/" : "";
    const home = t?.labels?.[HIDDEN_LABEL], tab = t?.labels?.["herdr.tab"];
    if (t?.state !== "live" || !home || !tab || home === tab || !chats.has(m + home)) continue;
    const info = byId.get(m + tab);
    if (info && !info.settled && !info.active && !out.includes(info.id)) out.push(info.id);
  }
  return out;
}

/**
 * Hidden agent terminals' tabs to rename after their chat's tab: [{ id, name }]. A
 * tab made to hide a terminal only has a number, which showed when it came back.
 * Only a chat tab with a name of its own (not a number) is copied.
 */
export function toRename(terminals, tabs) {
  const byId = new Map((tabs ?? []).map((t) => [t.id, t]));
  const out = [];
  for (const t of terminals ?? []) {
    const at = t?.address ?? "";
    const m = at.includes("/") ? at.slice(0, at.indexOf("/")) + "/" : "";
    const home = t?.labels?.[HIDDEN_LABEL], tab = t?.labels?.["herdr.tab"];
    if (t?.state !== "live" || !home || !tab || home === tab) continue;
    const chat = byId.get(m + home), hidden = byId.get(m + tab);
    if (!chat || !hidden || /^\d+$/.test(chat.name ?? "") || !chat.name || hidden.name === chat.name) continue;
    out.push({ id: hidden.id, name: chat.name });
  }
  return out;
}

/**
 * The agent terminals to keep when tab `tab` is closed: [address]. A tab holding a chat
 * also holds its agent's terminal after Show terminal; closing the tab would end that
 * session. `panes`: panes() (with `program`); `terminals`: terminals(). Kept: a
 * terminal pane in the tab whose agent a chat there shows (OWNER_LABEL names a chat
 * pane in the tab), or, for a chat from before that label, any Claude Code or Codex
 * terminal in a tab with a chat.
 */
export function agentsToKeep(tab, panes, terminals) {
  const here = (panes ?? []).filter((p) => p.tab === tab);
  const chats = new Set(here.filter((p) => p.mod === "ushi-naruse").map((p) => localId(p.pane)));
  if (!chats.size) return [];
  const byAddr = new Map((terminals ?? []).map((t) => [t.address, t]));
  return here.filter((p) => p.terminal).filter((p) => {
    const owner = localId(byAddr.get(p.terminal)?.labels?.[OWNER_LABEL]);
    if (owner) return chats.has(owner);
    return CHAT_AGENTS.includes(p.program?.key);
  }).map((p) => p.terminal);
}

/**
 * The tab to show before tab `id` closes: the nearest one to its right that isn't
 * settled, else to its left; null if none. The app picks a neighbour itself when the
 * shown tab closes, settled or not, so a chat's hidden terminal flashed up.
 */
export function visibleNeighbour(tabs, id) {
  const list = tabs ?? [];
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) return null;
  for (let k = i + 1; k < list.length; k++) if (!list[k].settled) return list[k].id;
  for (let k = i - 1; k >= 0; k--) if (!list[k].settled) return list[k].id;
  return null;
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
