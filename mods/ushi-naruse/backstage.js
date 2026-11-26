// "Hide terminal" without zoom: the chat's agent terminal steps out of the
// chat's tab into a tab of its own, settled so tab lists leave it out, and
// whatever else sits beside the chat stays. "Show terminal" brings it back.
// Herdr places a terminal by its labels (herdr.space, herdr.tab): parking
// takes its pane and those labels away, and labelling it again adopts it
// into that tab, still running. `chat.tab` on the terminal remembers the
// chat's tab while it's away. The chat and its pane header each keep a copy
// of this file (a mod can't import another's): change both together.

import { exec, hc, home, window } from "herdr";

// An app command through the CLI, awaited: run() from a mod returns nothing
// and doesn't keep calls in order.
// Windows (herdr-mods, spec 014): the app's own installer folder, no sh.
export async function herdr(command, args) {
  const r = windows()
    ? await exec(`${home()}\\AppData\\Local\\Programs\\herdr-app\\herdr-app.exe`, ["do", command, JSON.stringify(args)])
    : await exec("sh", ["-c", 'H=$(command -v herdr-app || echo "$HOME/.local/bin/herdr-app"); exec "$H" do "$1" "$2"', "sh", command, JSON.stringify(args)]);
  let out = null;
  try { out = JSON.parse(r.stdout); } catch {}
  if (r.code !== 0 || !out || out.error) throw new Error(out?.error ?? (r.stderr.trim() || `${command} failed`));
  return out;
}

const local = (id) => String(id).split("/").pop();
const machine = (address) => (address.includes("/") ? address.split("/")[0] : null);
const windows = () => { try { return window()?.platform === "windows"; } catch { return false; } };
// How long to wait between looks: the caller's cx.sleep when it passes one (herdr-mods,
// spec 014), else the system's sleep.
let sleeper = null;
const pause = (s) => (sleeper ? sleeper(s * 1000)
  : windows() ? exec("powershell", ["-NoProfile", "-Command", `Start-Sleep -Milliseconds ${Math.round(s * 1000)}`])
  : exec("sh", ["-c", `sleep ${s}`]));
/** Sets how this file waits: `(ms) => cx.sleep(ms)` from the caller's task. */
export function waitWith(fn) { sleeper = fn; }

async function labels(address) {
  const r = await hc(["get", address, "--json"]);
  try { return JSON.parse(r.stdout).labels ?? {}; } catch { return {}; }
}

// Parks the terminal and labels it into `tab` of `space` (ids on its machine).
async function moveTo(address, space, tab) {
  await herdr("terminal.park", { terminal: address });
  // The park lands once the machine replies: until then, new labels would be lost.
  for (let i = 0; i < 30 && (await labels(address))["herdr.tab"]; i++) await pause(0.1);
  await hc(["label", address, `herdr.space=${space}`, `herdr.tab=${tab}`]);
}

// The tab whose chat this terminal belongs to, as panes() names tabs.
export function chatTab(term) {
  const id = term?.labels?.["chat.tab"];
  const m = term ? machine(term.address) : null;
  return id ? (m ? `${m}/${id}` : id) : null;
}

// Whether the terminal is out of the chat's tab, in its own.
export function away(term) {
  const id = term?.labels?.["chat.tab"];
  return Boolean(id && term.labels["herdr.tab"] && term.labels["herdr.tab"] !== id);
}

// Moves the terminal out of `fromTab` (the chat's) into a new settled tab.
export async function hide(term, fromTab) {
  const space = term?.labels?.["herdr.space"];
  if (!space) throw new Error("The terminal isn't in a space");
  const tab = "tb" + Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  await hc(["label", term.address, `chat.tab=${local(fromTab)}`]);
  await moveTo(term.address, space, tab);
  // Herdr adopts it on its next look: settle the tab once it exists.
  const m = machine(term.address);
  for (let i = 0; i < 30; i++) {
    await pause(0.1);
    try { return await herdr("tab.settle", { id: m ? `${m}/${tab}` : tab }); } catch {}
  }
}

// ushi-naruse: puts the terminal in `tab` of `space` (ids as panes() names them) as a
// pane of its own: parked first if it sits in another tab, labelled straight away if
// it never had a pane (an agent started for a chat).
export async function adopt(address, space, tab) {
  if ((await labels(address))["herdr.tab"]) {
    await herdr("terminal.park", { terminal: address });
    for (let i = 0; i < 30 && (await labels(address))["herdr.tab"]; i++) await pause(0.1);
  }
  await hc(["label", address, `herdr.space=${local(space)}`, `herdr.tab=${local(tab)}`]);
}

// Brings the terminal back into the chat's tab.
export async function show(term) {
  const tab = term?.labels?.["chat.tab"];
  if (!tab) return;
  await moveTo(term.address, term.labels["herdr.space"], tab);
  await hc(["label", term.address, "chat.tab="]);
}
