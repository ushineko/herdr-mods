// Chat sessions (spec 008): naruse's chat mod (vendored as mods/chat) in a tab of
// its own, the chat its only pane, over an agent that runs in a shell with no
// pane (operator, 2026-11-25: the pane + was clicked in stays out of it).
//
// The agent's shell carries CHAT_LABEL=<chat pane> once the chat pane exists, so
// it ends when the chat (or its tab) is closed (sweep).

import { knownAgents, exec, hc, panes, spaces, terminals, run, window, notify } from "herdr";
import { chatEntries, strayChats, orphanedHidden, CHAT_LABEL, HIDDEN_LABEL } from "./lib/chat-entries.js";

const where = (base) => {
  const i = base.indexOf("/");
  return i < 0 ? { on: null, id: base } : { on: base.slice(0, i), id: base.slice(i + 1) };
};
// The chat is POSIX-only, so sh is always there when this runs.
const pause = () => exec("sh", ["-c", "sleep 0.1"]);

/** The "New … chat" entries for the machine `base` runs on; [] where the chat can't run. */
export async function options(base) {
  const platform = window().platform;
  if (platform === "windows") return [];
  const { on } = where(base);
  let agents = [], python = false;
  try { agents = await knownAgents({ on }); } catch {}
  try { python = (await exec("sh", ["-c", "command -v python3"], { on, timeout: 5000 })).code === 0; } catch {}
  return chatEntries({ platform, python, agents });
}

function fail(r) {
  notify({ title: "New chat failed", body: (r?.stderr || r?.stdout || String(r ?? "")).trim().slice(0, 300), level: "error" });
}

/**
 * Starts `command` in a pane-less shell on `base`'s machine, in `pane`'s folder, and
 * opens a new tab in `pane`'s space whose only pane is a chat bound to it.
 */
export async function open(pane, base, command, name) {
  const { on } = where(base);
  const me = panes().find((p) => p.pane === pane);
  const cwd = me?.cwd || terminals().find((t) => t.address === base)?.cwd || null;
  const space = spaces().find((s) => s.tabs?.some((t) => t.id === me?.tab))?.id;
  let r;
  try {
    r = await hc(["run", "--bg", "--json", ...(on ? ["--on", on] : []), "--no-parent",
      "--no-notify", "--rm", ...(cwd ? ["--cwd", cwd] : [])]);
  } catch (e) { return fail(e); }
  if (r.code !== 0) return fail(r);
  let addr;
  try { addr = JSON.parse(r.stdout).address; } catch { return fail(r); }
  await hc(["send", addr, command]);
  const before = new Set(panes().map((p) => p.pane));
  run("tab.new", { ...(space ? { space } : {}), name, mod: "ushi-naruse", props: { terminal: addr } });
  for (let i = 0; i < 50; i++) {
    const chat = panes().find((p) => p.mod === "ushi-naruse" && !before.has(p.pane));
    if (chat) { await hc(["label", addr, `${CHAT_LABEL}=${chat.pane}`]); return addr; }
    await pause();
  }
  return addr;
}

// Whether the chat can run on a machine (null: this computer): not Windows, python3
// there. Checked once per machine in a run; undefined until known.
const ready = new Map();

/** Checks, once per machine, whether the chat can run where terminal `addr` runs. */
export async function check(addr) {
  const { on } = where(addr);
  const key = on ?? "";
  if (ready.has(key)) return ready.get(key);
  let ok = window().platform !== "windows";
  if (ok) try { ok = (await exec("sh", ["-c", "command -v python3"], { on, timeout: 5000 })).code === 0; } catch { ok = false; }
  ready.set(key, ok);
  return ok;
}

/** What check() found for `addr`'s machine: false until it has. */
export const canOpen = (addr) => ready.get(where(addr).on ?? "") === true;

/** The agent a terminal runs, as the chat names it: "claude", "codex", or null. */
export function agentOf(term) {
  const what = `${term?.report?.app ?? ""} ${term?.foreground?.name ?? ""} ${term?.program?.key ?? ""}`.toLowerCase();
  return what.includes("claude") ? "claude" : what.includes("codex") ? "codex" : null;
}

/**
 * Opens a running agent's terminal as a chat (spec 008 R8): a chat pane right of
 * `pane`, in the agent's own tab. With `hide`, the chat then hides the terminal
 * (its "Hide terminal": the terminal moves to a settled tab, "Show terminal" brings
 * it back beside the chat). Closing the chat leaves the agent running (no CHAT_LABEL).
 */
export function openExisting(pane, addr, hide) {
  run("pane.split", { direction: "right", pane, mod: "ushi-naruse", props: { terminal: addr, ...(hide ? { hide: true } : {}) } });
}

// address → when its chat pane was first seen missing, and every pane seen in
// this run (strayChats keeps both).
const missing = new Map();
const seen = new Set();
const hiddenMissing = new Map();
const hiddenSeen = new Set();

/**
 * Ends agents whose chat pane was closed, and shows again an agent terminal the
 * chat had hidden when that chat is closed (its settled tab becomes a normal tab).
 * Every header copy may run it: a second kill or unsettle is harmless.
 */
export async function sweep() {
  const all = panes(), terms = terminals(), now = Date.now();
  const gone = strayChats(terms, all.map((p) => p.pane), missing, now, 3000, seen);
  for (const addr of gone) await hc(["kill", addr]).catch(() => {});
  const chatTabs = all.filter((p) => p.mod === "ushi-naruse").map((p) => p.tab);
  for (const { address, tab } of orphanedHidden(terms, chatTabs, hiddenMissing, now, 3000, hiddenSeen, all.length > 0)) {
    run("tab.unsettle", { id: tab });
    await hc(["label", address, `${HIDDEN_LABEL}=`]).catch(() => {});
  }
}
