// Closing a tab that holds a chat and its agent's terminal (after the chat's Show
// terminal) would end that session (spec 008 R12). The agent moves to a tab of its own,
// named like the closing tab, first; then the tab closes. The chat closes with it.

import { panes, spaces, terminals, hc, run, notify } from "herdr";
import { agentsToKeep, localId } from "./lib/chat-entries.js";

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

/** Closes tab `tab` (of `space`, named `name`), keeping the chat agents in it alive. */
export function closeTab(tab, space, name, cx) {
  const keep = agentsToKeep(tab, panes(), terminals());
  if (!keep.length) { run("tab.close", { id: tab }); return; }
  cx.spawn(async (cx) => {
    for (const addr of keep) {
      if (!(await moveOut(addr, space, name, cx))) {
        notify({ title: "Tab kept open", body: `Couldn't move ${addr} out of it first, so its session would have ended. Use the chat's Back to terminal, or close its terminal first.`, level: "warning" });
        return;
      }
    }
    run("tab.close", { id: tab, confirmed: true });
  });
}
