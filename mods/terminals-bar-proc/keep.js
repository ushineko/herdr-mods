// Closing a tab that holds a chat and its agent's terminal (after the chat's Show
// terminal) would end that session (spec 008 R12). The agent moves to a tab of its own,
// named like the closing tab, first; then the tab closes. The chat closes with it.

import { panes, spaces, terminals, hc, run, notify, shared, setShared } from "herdr";
import { agentsToKeep, localId, returnTab, noteShown, SHOWN_KEY } from "./lib/chat-entries.js";
import { chatPairs, moveIndex } from "./lib/chat-stack.js";

const machinePart = (id) => (String(id).includes("/") ? String(id).slice(0, String(id).lastIndexOf("/") + 1) : "");
const wait = (cx, ms) => new Promise((done) => cx.timer.after(ms, () => done()));
const paneOf = (addr) => panes().find((p) => p.terminal === addr) ?? null;

async function labels(addr) {
  const r = await hc(["get", addr, "--json"]);
  try { return JSON.parse(r.stdout).labels ?? {}; } catch { return {}; }
}

// Moves terminal `addr` into a new tab of `space`, named `name`; true once it has a pane there.
async function moveOut(addr, space, name, cx) {
  run("terminal.park", { terminal: addr });
  // The park lands once the machine replies: labels set before that are lost.
  for (let i = 0; i < 40 && ((await labels(addr))["herdr.tab"] || paneOf(addr)); i++) await wait(cx, 100);
  const tab = "tb" + Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  // The chat's labels go: the agent is no longer any chat's.
  await hc(["label", addr, `herdr.space=${localId(space)}`, `herdr.tab=${tab}`, "chat.tab=", "ushi.chat=", "hm.chat="]);
  for (let i = 0; i < 40 && !paneOf(addr); i++) await wait(cx, 100);
  if (!paneOf(addr)) return false;
  run("tab.rename", { id: machinePart(space) + tab, name });
  return true;
}

const historyOf = (space) => shared(SHOWN_KEY)?.[space] ?? [];
const record = (space, history) => setShared(SHOWN_KEY, { ...(shared(SHOWN_KEY) ?? {}), [space]: history });

/**
 * Records the shown space's shown tab (SHOWN_KEY). When the tab recorded last there
 * has closed some other way (a key, its program exiting), the app showed a neighbour
 * of its choosing: the tab shown before it comes back instead.
 */
// Which side of a chat pair (spec 021) was shown last, by the chat's tab id: "chat"
// or "term" (its hidden partner, the agent's pane and nested tabs).
const SIDE_KEY = "terminals-bar.pair-side";

function noteSide(tab) {
  const pairs = chatPairs(terminals());
  const chat = pairs.get(tab.id)?.chat ?? ([...pairs.values()].some((v) => v.chat === tab.id) ? tab.id : null);
  if (!chat) return;
  const side = pairs.has(tab.id) ? "term" : "chat";
  const all = shared(SIDE_KEY) ?? {};
  if (all[chat] !== side) setShared(SIDE_KEY, { ...all, [chat]: side });
}

/** Shows tab `id` from the bar: a chat's tab shows the side of its pair shown last. */
export function openTab(id) {
  const partner = [...chatPairs(terminals())].find(([, v]) => v.chat === id);
  const shown = (x) => spaces().some((s) => s.tabs?.some((t) => t.id === x && t.active));
  if (partner && shared(SIDE_KEY)?.[id] === "term" && !shown(id) && !shown(partner[0])) {
    setShared("nested-tabs.chat-side", { terminal: partner[1].terminal, at: Date.now() });
    run("tab.select", { id: partner[0] });
    return;
  }
  run("tab.select", { id });
}

export function followShown() {
  const space = spaces().find((s) => s.active);
  const tab = space?.tabs?.find((t) => t.active);
  if (!tab) return;
  noteSide(tab);
  const history = historyOf(space.id);
  if (history[0] === tab.id) return;
  const open = new Set(spaces().flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
  if (history[0] && !open.has(history[0])) {
    const back = returnTab(space.tabs, history[0], history);
    if (back && back !== tab.id) {
      run("tab.select", { id: back });
      record(space.id, noteShown(history, back, open));
      return;
    }
  }
  record(space.id, noteShown(history, tab.id, open));
}

/**
 * Before the shown tab closes, shows the tab shown before it (else a visible
 * neighbour) and waits for it: the app would pick a neighbour itself, a chat's hidden
 * (settled) terminal tab included, which flashed up until the chat sent it back.
 */
export async function leaveTab(tab, cx) {
  const space = spaces().find((s) => s.tabs?.some((t) => t.id === tab));
  const tabs = space?.tabs ?? [];
  if (!tabs.find((t) => t.id === tab)?.active) return;
  const next = returnTab(tabs, tab, historyOf(space.id));
  if (!next) return;
  run("tab.select", { id: next });
  const shown = () => spaces().some((s) => s.tabs?.some((t) => t.id === next && t.active));
  for (let i = 0; i < 20 && !shown(); i++) await wait(cx, 50);
}

/** Closes tab `tab` (of `space`, named `name`), keeping the chat agents in it alive. */
export function closeTab(tab, space, name, cx) {
  const keep = agentsToKeep(tab, panes(), terminals());
  if (!keep.length) {
    cx.spawn(async (cx) => { await leaveTab(tab, cx); run("tab.close", { id: tab }); });
    return;
  }
  cx.spawn(async (cx) => {
    for (const addr of keep) {
      if (!(await moveOut(addr, space, name, cx))) {
        notify({ title: "Tab kept open", body: `Couldn't move ${addr} out of it first, so its session would have ended. Use the chat's Back to terminal, or close its terminal first.`, level: "warning" });
        return;
      }
    }
    await leaveTab(tab, cx);
    run("tab.close", { id: tab, confirmed: true });
  });
}

/**
 * Moves the shown tab one place left (-1) or right (1) among the tabs the bar draws
 * (spec 021): a chat's partner tab shown moves its chat's tab, and hidden tabs are
 * passed over, so a move is always seen.
 */
export function moveShown(by) {
  const space = spaces().find((s) => s.active);
  const shown = space?.tabs?.find((t) => t.active);
  if (!shown) return;
  const pairs = chatPairs(terminals());
  const id = pairs.get(shown.id)?.chat ?? shown.id;
  const index = moveIndex(space.tabs, id, by, new Set(pairs.keys()));
  if (index != null) run("tab.move", { id, index });
}
