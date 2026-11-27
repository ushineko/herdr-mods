// Closing a tab that holds a chat and its agent's terminal (after the chat's Show
// terminal) would end that session (spec 008 R12). The agent moves to a tab of its own,
// named like the closing tab, first; then the tab closes. The chat closes with it.

import { panes, spaces, terminals, hc, run, notify, shared, setShared } from "herdr";
import { agentsToKeep, localId, returnTab, noteShown, SHOWN_KEY } from "./lib/chat-entries.js";

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
export function followShown() {
  const space = spaces().find((s) => s.active);
  const tab = space?.tabs?.find((t) => t.active);
  if (!tab) return;
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
