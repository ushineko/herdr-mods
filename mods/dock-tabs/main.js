// Dock tab strip: subtabs inside a window-level dock (a layout column holding
// this strip and a stack of blocks). Two docks, "dock-right" (ctrl-shift-y) and
// "dock-bottom" (alt-shift-y), show the same subtabs; opening one hides the other.
//
// Since spec 004 (herdr-mods) every dock starts with one fixed subtab, **nav + git**:
// the native panels split side by side in the bottom dock and stacked in the right
// one (they follow the focused terminal on any machine themselves). It cannot be
// closed, renamed or moved. After it come the
// shells and agents added with "+", which belong to a machine: the strip shows the
// shown space's machine's. yazi and lazygit are no longer started here; a dock
// still holding their blocks is rewritten (migrated) when it is shown.
//
// A **mod subtab** (spec 018) holds a mod's block instead of a terminal: a mod whose
// mod.json has a "dock" entry (lib/dock-mods.js) is offered under "+", shows as its
// icon alone, and belongs to no machine, so every machine's strip shows it.
//
// Props (pane header copies): { dock, stack, other }.
// Popup menu copies:          { menu: "tab" | "new", dock, stack, other, target? }.
// Rename dialog copies:       { rename: true, target, value }.
//
// Mouse: click a tab to show it, double-click to rename, middle-click or × to
// close, right-click for its menu; "+" adds a shell, right-click "+" for agents.
// Keys: nested-tabs' next/prev/add/close reach the dock through shared state
// "dock-tabs.cmd" while a dock terminal has focus.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import {
  layout, terminals, focused, run, hc, exec, home, theme, shared, setShared, notify, window,
  openOverlay, closeOverlay, knownAgents, checking, props, nextCommand, spaces, machines, appHome, readTextFile,
} from "herdr";
import { chatEntries, newChatId, ID_LABEL, AGENT_LOOKUP, parseAgentLookup, withLoginAgents, hasChatAgent, platformOf } from "./lib/chat-entries.js";
import { machineColor } from "./lib/machine-color.js";
import { modTabName, isModTab, modOfTab, dockMods, dockModIcon, LIST_MODS, modNamesFrom } from "./lib/dock-mods.js";

const ICON = (n) => `mods/dock-tabs/${n}.svg`;
const DOCKS = ["dock-right", "dock-bottom"];
const STACK = (dock) => `${dock}-stack`;
const TITLE = "nt.title";
// The fixed subtab, first in every dock: nav and git split, side by side in the bottom
// dock (a row) and stacked in the right one (a column), with hayami's usage under
// them (spec 010), which replaced the lower dock's usage terminal.
const FIXED = [{ key: "panels", label: "nav + git", icons: ["folder", "git-branch"] }];
const fixedId = (dock, key) => `${dock}-${key}`;
// hayami's block (specs 010, 011) sizes itself to the sections it shows and records
// the height in shared "hayami.px", so a rebuilt dock starts at that height.
const HAYAMI_PX = 100;
const usageNode = (dock) => ({
  id: `${dock}-hayami`, type: "block",
  size: { px: Number(shared("hayami.px")?.[dock]) || HAYAMI_PX },
  content: { mod: "hayami", props: { dock } },
});
const navGit = (dock) => [
  { id: `${dock}-nav`, type: "block", size: { weight: 1 }, content: { mod: "nav" } },
  { id: `${dock}-git`, type: "block", size: { weight: 1 }, content: { mod: "git" } },
];
const DIVIDER = { width: 1, color: "border", hover: "accent" };
const panelsNode = (dock) => dock === "dock-bottom"
  ? { id: fixedId(dock, "panels"), type: "column", children: [
    { id: `${dock}-navgit`, type: "row", divider: DIVIDER, children: navGit(dock) },
    usageNode(dock),
  ] }
  : { id: fixedId(dock, "panels"), type: "column", divider: DIVIDER, children: [...navGit(dock), usageNode(dock)] };
// Blocks from before spec 004 (any window suffix): dropped on migration.
const RETIRED = /^dock-(yazi|lazygit)(-|$)/;

// ---- layout tree --------------------------------------------------------------

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}

const tree = () => JSON.parse(JSON.stringify(layout() ?? {}));
// A subtab's terminal name: "dock-t…" here, "<machine>/dock-t…" elsewhere.
const machineOf = (name) => (name && name.includes("/") ? name.slice(0, name.indexOf("/")) : null);
const baseOf = (name) => (name && name.includes("/") ? name.slice(name.indexOf("/") + 1) : name);
const childId = (dock, name) => {
  if (isModTab(name)) return `${dock}-mod-${modOfTab(name).replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const m = machineOf(name);
  return `${dock}-${baseOf(name).replace(/^dock-/, "")}${m ? "@" + m.replace(/[^A-Za-z0-9_-]/g, "_") : ""}`;
};
// A chat subtab (spec 008) is a block of the chat mod; its props carry the agent's
// terminal address and the subtab's name (the agent terminal's name).
const nameOf = (child) => child?.content?.terminal ?? child?.content?.props?.dockName ?? null;
const chatOf = (child) => (child?.content?.mod === "ushi-naruse" ? child.content.props?.terminal ?? null : null);
const chatIdOf = (child) => (child?.content?.mod === "ushi-naruse" ? child.content.props?.id ?? null : null);
const modOf = (child) => child?.content?.mod ?? null;
// A mod subtab's block: its mod, by the dockName it was given (spec 018).
const modTabOf = (child) => (isModTab(child?.content?.props?.dockName) && child?.content?.mod ? modOfTab(child.content.props.dockName) : null);
const currentMachine = () => spaces().find((s) => s.active)?.machine ?? null;

// The live terminal for a subtab name, here or on its machine.
function termOf(all, name) {
  const m = machineOf(name), base = baseOf(name);
  return all.find((t) => t.state === "live" && t.name === base && (m ? t.address.startsWith(m + "/") : !t.address.includes("/"))) ?? null;
}

// The dock's subtabs in order, from its stack: [{ id, name, machine, term }], or
// { id, fixed } for nav and git. With `machine` given (null = this computer), the
// fixed subtabs and that machine's own.
function tabs(dock, machine) {
  const st = find(layout(), STACK(dock));
  const all = terminals();
  const list = (st?.children ?? []).map((c) => {
    const fixed = FIXED.find((f) => c.id === fixedId(dock, f.key));
    if (fixed) return { id: c.id, fixed };
    if (modTabOf(c)) return { id: c.id, name: nameOf(c), mod: modTabOf(c), machine: null, term: null };
    return { id: c.id, name: nameOf(c), chat: chatOf(c), chatId: chatIdOf(c), machine: machineOf(nameOf(c)), term: termOf(all, nameOf(c)) };
  });
  return machine === undefined ? list : list.filter((t) => t.fixed || t.mod || t.machine === machine);
}

// The added (non-fixed) subtabs' terminal names, in order, without retired blocks.
const ownNames = (dock) => tabs(dock).filter((t) => !t.fixed && t.name && !RETIRED.test(baseOf(t.name))).map((t) => t.name);

function activeOf(dock) {
  const st = find(layout(), STACK(dock));
  return st?.active ?? st?.children?.[0]?.id ?? null;
}

// The chat subtabs in the layout now: { name: agent address }.
function chatsNow() {
  const out = {};
  for (const dock of DOCKS) for (const t of tabs(dock)) if (t.chat && t.name) out[t.name] = { address: t.chat, id: t.chatId };
  return out;
}

// Rewrite both docks' stacks: nav and git, then the subtabs `names` in order (a
// name in `chats` or already a chat subtab gets a chat block); `active` per dock
// (a terminal name, or the fixed key "panels").
function setTabs(names, active, chats = {}) {
  const t = tree();
  const chat = { ...chatsNow(), ...chats };
  for (const dock of DOCKS) {
    const st = find(t, STACK(dock));
    if (!st) continue;
    st.children = [
      panelsNode(dock),
      ...names.map((n) => ({
        id: childId(dock, n),
        type: "block",
        // A mod subtab's block knows its dock, stack and own id, so the mod can tell
        // when it is shown; a chat set to null in `chats` turns back into its terminal
        // (Back to terminal).
        content: isModTab(n) ? { mod: modOfTab(n), props: { dock, stack: STACK(dock), id: childId(dock, n), dockName: n } }
          : chat[n] ? { mod: "ushi-naruse", props: { terminal: chat[n].address ?? chat[n], ...(chat[n].id ? { id: chat[n].id } : {}), dockName: n } } : { terminal: n },
      })),
    ];
    const want = active?.[dock];
    const wantId = want && (FIXED.some((f) => f.key === want) ? fixedId(dock, want) : names.includes(want) ? childId(dock, want) : null);
    st.active = wantId ?? (st.children.some((c) => c.id === st.active) ? st.active : st.children[0]?.id);
  }
  setLayout(t).catch((e) => fail("Dock: the layout could not be changed", `${e?.message ?? e}`));
}

// The herdr-app CLI, per platform (Windows untested: no Herdr app there yet).
const HERDR_APP = {
  macos: () => ["herdr-app", `${home()}/.local/bin/herdr-app`],
  linux: () => ["herdr-app", `${home()}/.local/bin/herdr-app`],
  windows: () => ["herdr-app.exe", "herdr-app"],
};

// layout.set. The app refuses a command argument nested more than 16 levels deep,
// and a layout with docks inside the work column is 16 deep itself (#15): then the
// layout goes as text through the CLI, which has no such limit.
async function setLayout(t) {
  try { run("layout.set", { layout: t }); return; } catch (e) {
    if (!/nest/i.test(String(e?.message ?? e))) throw e;
  }
  const json = JSON.stringify({ layout: t });
  let last = null;
  for (const bin of (HERDR_APP[window().platform] ?? HERDR_APP.linux)()) {
    const r = await exec(bin, ["do", "layout.set", json]).catch((e) => ({ code: -1, stderr: String(e?.message ?? e) }));
    if (r.code === 0 && !/"error"/.test(r.stdout ?? "")) return;
    last = r;
  }
  throw new Error((last?.stdout || last?.stderr || "herdr-app not found").trim().slice(0, 300));
}

// True when a dock's stack does not start with the nav + git split of the right
// direction and hayami's block knowing its dock (specs 010, 011), or still holds
// retired blocks or the earlier separate nav/git blocks.
function needsMigration(dock) {
  const kids = find(layout(), STACK(dock))?.children ?? [];
  const first = kids[0];
  const splitOk = first?.id === fixedId(dock, "panels") && first.type === panelsNode(dock).type
    && Boolean(find(first, `${dock}-nav`)) && find(first, `${dock}-hayami`)?.content?.props?.dock === dock;
  return !splitOk || kids.some((c, i) => i > 0 && ((modOf(c) && !chatOf(c) && !modTabOf(c)) || RETIRED.test(baseOf(nameOf(c) ?? ""))));
}

function label(tab) {
  if (tab.fixed) return tab.fixed.label;
  if (tab.mod) return tab.title ?? tab.mod;
  const t = tab.term;
  if (tab.chat) return t?.labels?.[TITLE] || `${t?.program?.name ?? "Agent"} chat`;
  return t?.labels?.[TITLE] || t?.title || t?.program?.name || baseOf(tab.name);
}

// ---- actions ------------------------------------------------------------------

function fail(title, r) {
  notify({ title, body: (r?.stderr || r?.stdout || String(r ?? "")).trim().slice(0, 300), level: "error" });
}

// The "New … chat" entries for machine `on` (null: this computer); [] where the
// chat can't run (spec 008). nested-tabs/chat.js has the same check.
async function chatOptions(on) {
  // The agent's machine decides, not this window's (spec 014).
  const platform = await platformOf(on, exec, window().platform);
  if (!platform) return [];
  let agents = [], python = false;
  try { agents = await knownAgents({ on }); } catch {}
  // Another machine's answer can miss agents outside its core's PATH (Homebrew on
  // macOS): its login shell is asked too, as nested-tabs' agentsOn does.
  if (on && !hasChatAgent(agents) && platform !== "windows") {
    const r = await exec("sh", ["-c", AGENT_LOOKUP], { on, timeout: 8000 }).catch(() => null);
    agents = withLoginAgents(agents, parseAgentLookup(r?.stdout));
  }
  if (platform !== "windows") try { python = (await exec("sh", ["-c", "command -v python3"], { on, timeout: 5000 })).code === 0; } catch {}
  return chatEntries({ platform, python, agents });
}

function here() {
  return focused()?.cwd || home();
}

// The subtab last shown for each machine, so switching back to a machine's
// space shows what was showing there.
const ACTIVE = "dock.active";
function remember(tab) {
  if (tab.fixed) { setShared(ACTIVE, { ...(shared(ACTIVE) ?? {}), [currentMachine() ?? ""]: tab.fixed.key }); return; }
  setShared(ACTIVE, { ...(shared(ACTIVE) ?? {}), [tab.machine ?? ""]: baseOf(tab.name) });
}

function show(dock, tab) {
  run("layout.select", { stack: STACK(dock), child: tab.id });
  remember(tab);
}

// A shell subtab running `command` if given. With `chat`, the subtab is the chat
// (spec 008) over that shell, which then runs the agent without a block of its own.
async function addTab(dock, command, { chat = false } = {}) {
  const machine = currentMachine();
  const base = `dock-t${Date.now().toString(36)}`;
  const cwd = here();
  const r = await hc(["run", "--bg", "--json", ...(machine ? ["--on", machine] : []), "--no-parent", "--no-notify", "--rm",
    ...(chat ? [] : ["--keep"]), "--name", base, ...(machine && !cwd.startsWith("/") && !/^[A-Za-z]:/.test(cwd) ? [] : ["--cwd", cwd])]);
  if (r.code !== 0) return fail(chat ? "New chat failed" : "New dock tab failed", r);
  const name = machine ? `${machine}/${base}` : base;
  let chats = {};
  if (chat) {
    let address;
    try { address = JSON.parse(r.stdout).address; } catch { return fail("New chat: unexpected reply", r); }
    // Every window's chat finds the agent by this label (addresses differ by window).
    const id = newChatId();
    await hc(["label", address, `${ID_LABEL}=${id}`]);
    chats = { [name]: { address, id } };
  }
  const names = ownNames(dock);
  const at = names.indexOf(nameOf(find(layout(), activeOf(dock))));
  names.splice(at < 0 ? names.length : at + 1, 0, name);
  setTabs(names, { [dock]: name }, chats);
  remember({ name, machine });
  if (command) await hc(["send", name, command]);
}

// A mod's subtab (spec 018): shown if it is already there, else added after the
// active subtab. It belongs to no machine, so it is in every machine's strip.
function addModTab(dock, mod) {
  const name = modTabName(mod);
  const names = ownNames(dock);
  if (!names.includes(name)) {
    const at = names.indexOf(nameOf(find(layout(), activeOf(dock))));
    names.splice(at < 0 ? names.length : at + 1, 0, name);
  }
  setTabs(names, { [dock]: name });
  remember({ name, machine: null });
}

// The installed mods that offer a dock subtab: each mod.json under the app home's
// mods folder that has a "dock" entry (lib/dock-mods.js). Listed with sh: a mod has
// no folder listing of its own. Windows has no sh and no Herdr app yet.
async function installedDockMods() {
  const dir = `${appHome()}/mods`;
  let names = [];
  try {
    const r = await exec("sh", ["-c", LIST_MODS, "dock-tabs", dir], { timeout: 5000 });
    names = modNamesFrom(r.stdout, dir);
  } catch { return []; }
  const entries = [];
  for (const name of names) {
    const json = await readTextFile(`${dir}/${name}/mod.json`).catch(() => null);
    if (json) entries.push({ name, json });
  }
  return dockMods(entries);
}

async function closeTab(dock, tab) {
  if (tab.fixed) return;
  const list = tabs(dock, tab.machine);
  const i = list.findIndex((t) => t.id === tab.id);
  const next = list[i + 1] ?? list[i - 1];
  // Drop it from both stacks first, then end it: an ended terminal's block
  // would otherwise be removed by the app on its own. Removing its last block
  // may already end it, so "not found" is success here.
  setTabs(ownNames(dock).filter((n) => n !== tab.name), next ? { [dock]: next.fixed?.key ?? next.name } : {});
  if (tab.term) {
    const r = await hc(["kill", tab.name]);
    if (r.code !== 0 && !/not_found/.test(r.stdout + r.stderr)) fail("Close dock tab failed", r);
  }
}

// Move a subtab past its neighbour among the same machine's subtabs.
function moveTab(dock, tab, step) {
  if (tab.fixed) return;
  const mine = tabs(dock, tab.machine).filter((t) => !t.fixed);
  const i = mine.findIndex((t) => t.id === tab.id), j = i + step;
  if (i < 0 || j < 0 || j >= mine.length) return;
  const names = ownNames(dock);
  const a = names.indexOf(mine[i].name), b = names.indexOf(mine[j].name);
  [names[a], names[b]] = [names[b], names[a]];
  const shown = find(layout(), activeOf(dock));
  setTabs(names, { [dock]: modOf(shown) ?? nameOf(shown) });
}

function cycle(dock, step) {
  const list = tabs(dock, currentMachine());
  if (list.length < 2) return;
  const i = list.findIndex((t) => t.id === activeOf(dock));
  show(dock, list[(i + step + list.length) % list.length]);
}

// ---- view ---------------------------------------------------------------------

export default class DockTabs extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.menu) return this.initMenu(cx);
    if (p.rename) return this.initRename(cx);
    this.wasShown = false;
    this.seenCmd = 0;
    this.starting = false;
    if (checking()) return;
    // dock-tabs.<add|next|prev|close> (palette, keys): act on this dock if open.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (this.shownNow()) this.act(c, cx);
        cx.notify();
      }
    });
  }

  act(c, cx) {
    const { dock } = props();
    if (c === "refresh" && cx) { this.ensureDock(cx, currentMachine()); return; }
    if (c === "next") cycle(dock, 1);
    else if (c === "prev") cycle(dock, -1);
    else if (c === "add") addTab(dock).catch((e) => fail("New dock tab failed", `${e?.message ?? e}`));
    else if (c === "chat") chatOptions(currentMachine()).then(([e]) => e && addTab(dock, e.run.join(" "), { chat: true }))
      .catch((e) => fail("New chat failed", `${e?.message ?? e}`));
    else if (c === "close") { const t = tabs(dock).find((x) => x.id === activeOf(dock)); if (t && !t.fixed) closeTab(dock, t); }
    else if (/^mod-[A-Za-z0-9._-]+$/.test(c)) addModTab(dock, c.slice(4)); // `herdr-app do dock-tabs.mod-<mod>`
  }

  shownNow() {
    const node = find(layout(), props()?.dock);
    return Boolean(node) && !node.hidden;
  }

  // On opening: hide the other dock.
  onShown() {
    run("layout.hide", { id: props().other });
  }

  // On showing the dock (and on a machine change): migrate a stack from before
  // spec 004 (nav and git first, no yazi/lazygit blocks), then select the subtab
  // last shown for this machine, else nav.
  ensureDock(_cx, machine) {
    const { dock } = props();
    if (DOCKS.some(needsMigration)) setTabs(ownNames(dock), {});
    const want = (shared(ACTIVE) ?? {})[machine ?? ""];
    const list = tabs(dock, machine);
    const pick = list.find((t) => (t.fixed ? t.fixed.key : baseOf(t.name)) === want) ?? list[0];
    if (pick) run("layout.select", { stack: STACK(dock), child: pick.id });
  }

  // Keys from nested-tabs while a terminal of this dock has focus.
  keyCommand() {
    const cmd = shared("dock-tabs.cmd");
    if (!cmd || cmd.at <= this.seenCmd) return;
    this.seenCmd = cmd.at;
    const f = focused();
    if (!f || f.pane || !tabs(props().dock).some((t) => t.term?.address === f.terminal)) return;
    this.act(cmd.c);
  }

  menu(kind, target) {
    const { dock, stack, other } = props();
    openOverlay({ mod: "dock-tabs", kind: "popup", width: 240, props: { menu: kind, dock, stack, other, target } });
  }

  button(id, icon, tip, onClick, onRight) {
    const t = theme();
    return div().id(id).flex_none().p(4).rounded(5).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(); })
      .when(Boolean(onRight), (el) => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); onRight(); }))
      .child(svg(ICON(icon)).size(15));
  }

  chip(tab, i, active, count) {
    const t = theme();
    const { dock } = props();
    const g = tab.term?.program;
    // The fixed subtab shows its panels' icons only (folder, branch); its name is the tooltip.
    const icon = tab.fixed ? h_flex().flex_none().gap(5).items_center().children(tab.fixed.icons.map((n) => svg(ICON(n)).size(15).flex_none().text_color(active ? t.accent : t.muted)))
      : tab.mod ? svg(tab.iconPath ?? dockModIcon({ mod: tab.mod, icon: "icon" })).size(15).flex_none().text_color(active ? t.accent : t.muted)
      : tab.chat ? svg(ICON("cow")).size(15).flex_none().text_color(active ? t.foreground : t.muted)
      : g?.icon ? (g.tint ? svg(g.icon).size(15).flex_none().text_color(active ? t.foreground : t.muted) : image(g.icon).w(15).h(15).flex_none()) : null;
    const name = label(tab);
    // A mod subtab is its icon alone (spec 018), its title the tooltip, as the fixed one.
    return h_flex().id(`dt-${dock}-${tab.id}`).flex_shrink(1).min_w(tab.mod ? 0 : 56).max_w(220).h(28).pl(8).pr(tab.fixed ? 8 : 3).gap(6)
      .items_center().rounded(8).border_1().cursor_pointer().text_size(13)
      .when(active, (el) => el.bg(t.raised).border_color(t.border).text_color(t.foreground))
      .when(!active, (el) => el.border_color("#00000000").text_color(t.muted).hover((s) => s.bg(t.hover)))
      .when(!tab.fixed && !tab.mod && !tab.term, (el) => el.opacity(0.5))
      .tooltip(tab.fixed ? `${name} (always here)` : tab.mod ? name : `${name} · ${tab.name}`)
      .on_click((e) => { if (e.click_count >= 2 && !tab.fixed) this.rename(tab); else show(dock, tab); })
      .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); closeTab(dock, tab); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu("tab", tab.id); })
      .child(div().flex_none().text_size(11).text_color(t.dim).child(String(i + 1)))
      .when(Boolean(icon), (el) => el.child(icon))
      .when(!tab.fixed && !tab.mod, (el) => el.child(div().truncate().child(name)))
      .when(!tab.fixed, (el) => el.child(
        div().id(`dt-x-${dock}-${tab.id}`).flex_none().p(3).rounded(5).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close tab")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); closeTab(dock, tab); })
          .child(svg(ICON("x")).size(12))));
  }

  rename(tab) {
    if (tab.fixed || !tab.term) return;
    openOverlay({ mod: "dock-tabs", kind: "dialog", width: 380, props: { rename: true, target: tab.name, value: tab.term.labels?.[TITLE] ?? "" } });
  }

  renderStrip(cx) {
    const { dock } = props() ?? {};
    if (!dock || checking()) return div();
    const shownNow = this.shownNow();
    const machine = currentMachine();
    if (shownNow && !this.wasShown) this.onShown(cx);
    // The dock follows the shown space's machine: on opening, and whenever
    // that machine changes while it is open.
    if (shownNow && (!this.wasShown || machine !== this.machine)) {
      this.machine = machine;
      const reachable = !machine || machines().find((m) => m.name === machine)?.layout !== "unavailable";
      if (reachable) this.ensureDock(cx, machine);
    }
    this.wasShown = shownNow;
    this.keyCommand();
    const t = theme();
    const list = tabs(dock, machine);
    const active = activeOf(dock);
    const offline = machine && machines().find((m) => m.name === machine)?.layout === "unavailable";
    // The machine's own colour, as in the spaces bar (lib/machine-color.js).
    const mc = machine ? machineColor(machine, spaces().map((x) => x.machine)) ?? t.accent : null;
    return h_flex().id(`dt-strip-${dock}`).size_full().pl(5).pr(6).gap(6).items_center().border_b(1).border_color(t.border)
      .when(Boolean(machine), (el) => el.child(h_flex().flex_none().gap(4).px(6).h(20).items_center().rounded(5)
        .bg(mc + "33").text_color(mc).text_size(11.5).child(machine)))
      .child(h_flex().id(`dt-chips-${dock}`).flex_1().min_w(0).h_full().gap(3).items_center().overflow_hidden()
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu("new"); })
        .when(Boolean(offline), (el) => el.child(div().truncate().text_size(12.5).text_color(t.dim)
          .child(`${machine} is unreachable; its dock shells keep running there and come back when it reconnects`)))
        .children(list.map((tab, i) => this.chip(tab, i, tab.id === active, list.length))))
      .child(this.button(`dt-add-${dock}`, "plus", "New dock tab (right-click: start an agent)", () => addTab(dock), () => this.menu("new")))
      .child(this.button(`dt-hide-${dock}`, "close", "Hide the dock (its tabs keep running)", () => run("layout.hide", { id: dock })));
  }

  // ---- popup menu ---------------------------------------------------------------

  initMenu(cx) {
    this.at = 0;
    this.agents = [];
    this.chats = [];
    this.dockMods = [];
    this.busy = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      try { this.agents = (await knownAgents()).filter((a) => a.installed && a.run?.length).slice(0, 4); } catch { this.agents = []; }
      cx.notify();
      this.chats = await chatOptions(currentMachine());
      cx.notify();
      this.dockMods = await installedDockMods();
      cx.notify();
    });
  }

  menuItems() {
    const { menu, dock, target } = props() ?? {};
    const news = [
      { label: "New tab", icon: "terminal", act: () => addTab(dock) },
      ...this.agents.map((a) => ({ label: `New ${a.name} tab`, icon: "terminal", act: () => addTab(dock, a.run.join(" ")) })),
      ...this.chats.map((c) => ({ label: c.label, icon: "layers", act: () => addTab(dock, c.run.join(" "), { chat: true }) })),
      ...this.dockMods.map((m) => ({ label: `${m.title} tab`, iconPath: dockModIcon(m), act: () => addModTab(dock, m.mod) })),
    ];
    if (menu !== "tab") return news;
    const list = tabs(dock, currentMachine());
    const i = list.findIndex((x) => x.id === target);
    const tab = list[i];
    if (!tab) return news;
    const items = [];
    if (activeOf(dock) !== target) items.push({ label: "Show", icon: "layers", act: () => show(dock, tab) });
    if (tab.fixed) return [...items, { sep: true }, ...news].filter((it, k, all) => !(it.sep && (k === 0 || k === all.length - 1)));
    if (tab.term) items.push({ label: "Rename…", icon: "square-pen", act: () => this.rename(tab) });
    // The chat's escape hatch (spec 008): the subtab shows the agent's terminal again.
    if (tab.chat) items.push({ label: "Back to terminal", icon: "terminal", act: () => setTabs(ownNames(dock), { [dock]: tab.name }, { [tab.name]: null }) });
    items.push({ sep: true }, ...news, { sep: true });
    const own = list.filter((x) => !x.fixed), j = own.findIndex((x) => x.id === target);
    if (j > 0) items.push({ label: "Move left", icon: "chevron-left", act: () => moveTab(dock, tab, -1) });
    if (j < own.length - 1) items.push({ label: "Move right", icon: "chevron-right", act: () => moveTab(dock, tab, 1) });
    items.push({ sep: true });
    if (own.length > 1) items.push({ label: "Close other tabs", icon: "x", act: async () => { for (const o of tabs(dock, currentMachine())) if (o.id !== target && !o.fixed) await closeTab(dock, o); } });
    items.push({ label: "Close tab", icon: "x", act: () => closeTab(dock, tab) });
    return items.filter((it, k, all) => !(it.sep && (k === 0 || k === all.length - 1 || all[k - 1]?.sep)));
  }

  // Run the entry, then close: closing the popup cancels its pending calls.
  choose(it, cx) {
    if (!it || it.sep || this.busy) return;
    this.busy = true;
    const overlay = props()?.overlay;
    cx.spawn(async () => { try { await it.act(); } finally { closeOverlay(overlay); } });
  }

  renderMenu() {
    const t = theme();
    const items = this.menuItems();
    const real = items.map((it, k) => (it.sep ? -1 : k)).filter((k) => k >= 0);
    if (!real.includes(this.at)) this.at = real[0] ?? 0;
    return v_flex().id("dt-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        const pos = real.indexOf(this.at);
        if (e.key === "down") this.at = real[(pos + 1) % real.length];
        else if (e.key === "up") this.at = real[(pos - 1 + real.length) % real.length];
        else if (e.key === "enter") this.choose(items[this.at], cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(items.map((it, k) => it.sep
        ? div().mx(7).my(4).h(1).bg(t.border)
        : h_flex().id(`dt-mi-${k}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
            .when(k === this.at, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.choose(it, cx))
            .child(svg(it.iconPath ?? ICON(it.icon)).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().truncate().child(it.label))));
  }

  // ---- rename dialog --------------------------------------------------------------

  initRename(cx) {
    const value = props()?.value ?? "";
    this.input = InputState.new({ value });
    if (value) this.input.set_selected_range({ start: 0, end: value.length });
    this.input.on("submit", () => this.submitRename());
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  async submitRename() {
    const p = props();
    closeOverlay(p.overlay);
    const r = await hc(["label", p.target, `${TITLE}=${this.input.value().trim()}`]);
    if (r.code !== 0) fail("Rename failed", r);
  }

  renderRename() {
    const t = theme();
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("dt-rename").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .child(div().text_size(14).font_semibold().child("Rename dock tab"))
      .child(div().text_size(11.5).text_color(t.dim).child("Empty: back to the program's own title."))
      .child(Input.new(this.input).h(34).px(10).rounded(8).border_1().border_color(t.input).bg(t.background))
      .child(h_flex().gap(8).justify_end()
        .child(button("dt-rn-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("dt-rn-ok", "Rename", true, () => this.submitRename())));
  }

  render(cx) {
    const p = props() ?? {};
    if (p.menu) return this.renderMenu();
    if (p.rename) return this.renderRename();
    return this.renderStrip(cx);
  }
}
