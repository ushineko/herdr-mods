// Chat sessions (spec 008): naruse's chat mod (vendored as mods/chat) in a tab of
// its own, the chat its only pane, over an agent that runs in a shell with no
// pane (operator, 2026-11-25: the pane + was clicked in stays out of it).
//
// The agent's shell carries CHAT_LABEL=<chat pane> once the chat pane exists, so
// it ends when the chat (or its tab) is closed (sweep).

import { knownAgents, exec, hc, panes, spaces, terminals, run, window, notify, shared, setShared } from "herdr";
import { chatEntries, strayChats, orphanedHidden, toSettle, toRename, localId, newChatId, ID_LABEL, returnTab, SHOWN_KEY, CHAT_LABEL, HIDDEN_LABEL, OWNER_LABEL, AGENT_LOOKUP, parseAgentLookup, withLoginAgents, hasChatAgent, platformOf } from "./lib/chat-entries.js";

const where = (base) => {
  const i = base.indexOf("/");
  return i < 0 ? { on: null, id: base } : { on: base.slice(0, i), id: base.slice(i + 1) };
};
// A short wait, with this computer's own sleep (spec 014: the window may be Windows).
const pause = () => (window().platform === "windows"
  ? exec("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 100"])
  : exec("sh", ["-c", "sleep 0.1"]));

// The system the agent's machine runs (lib/chat-entries.js platformOf).
const platformOn = (on) => platformOf(on, exec, window().platform);

/** The "New … chat" entries for the machine `base` runs on; [] where the chat can't run. */
export const options = (base) => optionsOn(where(base).on);

/**
 * knownAgents() for machine `on`; for another machine whose answer has no chat agent,
 * also its login shell's: the app asks it with the environment its core started with,
 * which on macOS lacks Homebrew's folder (claude there was missing from the menus).
 */
export async function agentsOn(on) {
  let list = [], error = null;
  try { list = await knownAgents({ on }); } catch (e) { error = e; }
  if (on && !hasChatAgent(list) && (await platformOn(on)) !== "windows") {
    const r = await exec("sh", ["-c", AGENT_LOOKUP], { on, timeout: 8000 }).catch(() => null);
    const found = parseAgentLookup(r?.stdout);
    if (Object.keys(found).length) return withLoginAgents(list, found);
  }
  if (error) throw error;
  return list;
}

/** The "New … chat" entries for machine `on` (null: this computer). */
export async function optionsOn(on) {
  // The agent's machine decides (spec 014), not this window's.
  const platform = await platformOn(on);
  if (!platform) return [];
  let agents = [], python = false;
  try { agents = await agentsOn(on); } catch {}
  if (platform !== "windows") try { python = (await exec("sh", ["-c", "command -v python3"], { on, timeout: 5000 })).code === 0; } catch {}
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
  const me = panes().find((p) => p.pane === pane);
  const cwd = me?.cwd || terminals().find((t) => t.address === base)?.cwd || null;
  const space = spaces().find((s) => s.tabs?.some((t) => t.id === me?.tab))?.id;
  return openIn(space, where(base).on, cwd, command, name);
}

/**
 * The same from the tab bar's +: `command` in a pane-less shell on machine `on`, in
 * `cwd` (null: that machine's home), and a new tab in `space` holding only the chat.
 */
export async function openIn(space, on, cwd, command, name) {
  let r;
  try {
    r = await hc(["run", "--bg", "--json", ...(on ? ["--on", on] : []), "--no-parent",
      "--no-notify", "--rm", ...(cwd ? ["--cwd", cwd] : [])]);
  } catch (e) { return fail(e); }
  if (r.code !== 0) return fail(r);
  let addr;
  try { addr = JSON.parse(r.stdout).address; } catch { return fail(r); }
  await hc(["send", addr, command]);
  const id = await idFor(addr);
  await openChat(addr, () => run("tab.new", { ...(space ? { space } : {}), name, mod: "ushi-naruse", props: { terminal: addr, id } }), [CHAT_LABEL]);
  return addr;
}

// Runs `make` (which opens a chat pane on `addr`), waits for the new pane and labels
// the agent with its id: OWNER_LABEL always, and each of `more`.
async function openChat(addr, make, more = []) {
  const before = new Set(panes().map((p) => p.pane));
  make();
  for (let i = 0; i < 50; i++) {
    const chat = panes().find((p) => p.mod === "ushi-naruse" && !before.has(p.pane));
    if (chat) return hc(["label", addr, ...[OWNER_LABEL, ...more].map((k) => `${k}=${localId(chat.pane)}`)]);
    await pause();
  }
}

/**
 * Closes pane `pane`. When it is the shown tab's last pane, the tab closes with it and
 * the app picks a neighbour itself, a chat's hidden (settled) terminal tab included,
 * which flashed up: the tab shown before it (the tab bar's history), else a visible
 * neighbour, is shown first.
 */
export function closePane(pane, cx) {
  const me = panes().find((p) => p.pane === pane);
  const last = me && !panes().some((p) => p.tab === me.tab && p.pane !== pane);
  const space = spaces().find((s) => s.tabs?.some((t) => t.id === me?.tab));
  const tabs = space?.tabs ?? [];
  const next = last && tabs.find((t) => t.id === me.tab)?.active ? returnTab(tabs, me.tab, shared(SHOWN_KEY)?.[space.id]) : null;
  if (!next) { run("pane.close", { pane }); return; }
  run("tab.select", { id: next });
  cx.spawn(async (cx) => {
    const shown = () => spaces().some((s) => s.tabs?.some((t) => t.id === next && t.active));
    for (let i = 0; i < 20 && !shown(); i++) await new Promise((done) => cx.timer.after(50, () => done()));
    run("pane.close", { pane });
  });
}

/**
 * The chat pane showing terminal `term`, if one is open: the one its label names, else
 * (a chat opened before the label existed) a chat in the same tab as its pane, for a
 * Claude Code or Codex terminal only (a shell beside a chat closes as usual).
 */
export function chatOf(term) {
  const pane = localId(term?.labels?.[OWNER_LABEL]);
  const all = panes();
  const named = pane ? all.find((p) => localId(p.pane) === pane && p.mod === "ushi-naruse") : null;
  if (named) return named;
  if (!agentOf(term)) return null;
  const tab = all.find((p) => p.terminal === term?.address)?.tab;
  return (tab && all.find((p) => p.tab === tab && p.mod === "ushi-naruse")) || null;
}

/** Asks the chat showing `addr` to hide its terminal (the chat's own "Hide terminal"). */
export function hideBehindChat(addr) {
  setShared("ushi-naruse.hide", { terminal: addr, at: Date.now() });
}

// Whether the chat can run on a machine (null: this computer): python3 there on macOS
// and Linux; Windows runs its helpers with PowerShell (spec 014). The window itself
// may be on any system.
// Checked once per machine in a run; undefined until known.
const ready = new Map();

/** Checks, once per machine, whether the chat can run where terminal `addr` runs. */
export async function check(addr) {
  const { on } = where(addr);
  const key = on ?? "";
  if (ready.has(key)) return ready.get(key);
  const platform = await platformOn(on);
  let ok = Boolean(platform);
  if (ok && platform !== "windows") try { ok = (await exec("sh", ["-c", "command -v python3"], { on, timeout: 5000 })).code === 0; } catch { ok = false; }
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
export async function openExisting(pane, addr, hide) {
  const id = await idFor(addr);
  return openChat(addr, () => run("pane.split", { direction: "right", pane, mod: "ushi-naruse", props: { terminal: addr, id, ...(hide ? { hide: true } : {}) } }));
}

/** The agent's ID_LABEL, set now if it has none (a chat in any window finds it by this). */
export async function idFor(addr) {
  const have = terminals().find((t) => t.address === addr)?.labels?.[ID_LABEL];
  if (have) return have;
  const id = newChatId();
  await hc(["label", addr, `${ID_LABEL}=${id}`]);
  return id;
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
  // "Settled" is per window: a terminal hidden from another window shows here as an
  // ordinary tab until this window settles it too.
  const tabs = spaces().flatMap((s) => s.tabs ?? []);
  for (const id of toSettle(terms, chatTabs, tabs)) run("tab.settle", { id });
  // The hidden terminal's tab is named like its chat's (a new tab only has a number),
  // so it keeps the project's name if it comes back.
  for (const { id, name } of toRename(terms, tabs)) run("tab.rename", { id, name });
}
