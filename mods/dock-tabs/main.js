// Dock tab strip: subtabs inside a window-level dock (a layout column holding
// this strip and a stack of terminal blocks). Two docks share one set of
// terminals, "dock-right" (ctrl-shift-y) and "dock-bottom" (alt-shift-y);
// opening one hides the other, so a terminal is never shown at two sizes.
//
// Props (pane header copies): { dock, stack, other }.
// Popup menu copies:          { menu: "tab" | "new", dock, stack, other, target? }.
// Rename dialog copies:       { rename: true, target, value }.
//
// Mouse: click a tab to show it, double-click to rename, middle-click or × to
// close, right-click for its menu; "+" adds a shell, right-click "+" for agents.
// Keys: nested-tabs' next/prev/add/close reach the dock through shared state
// "dock-tabs.cmd" while a dock terminal has focus.
//
// Subtabs are the stack's children; adding, closing and reordering rewrite
// both docks' stacks with layout.set. The default yazi and lazygit run in
// restart loops (dock-follow moves them to the shown tab's folder).
//
// Remote machines: each machine has its own subtabs, terminals in that
// machine's herdr-core (`<machine>/dock-yazi`, `<machine>/dock-lazygit`, and
// any added shells). The strip shows only the subtabs of the shown space's
// machine and switches with it. A remote dock terminal starts as the machine's
// interactive shell (full PATH) and is given a restart loop in its shell's
// syntax; if the tool is missing there it prints an install hint instead.
// Each machine's OS, home and target files are kept in shared "dock.machines"
// for dock-follow.
//
// Several windows can show one herdr-core (another computer's Herdr app adds
// this machine, or this window adds one that has its own app). Each window's
// dock terminals carry its own name suffix from `<app home>/dock.json`
// ({"suffix": "-mbp"}; none by default), so two windows never take over each
// other's dock-yazi / dock-lazygit, here or on a machine both have added.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import {
  layout, terminals, focused, run, hc, home, appHome, theme, shared, setShared, notify,
  openOverlay, closeOverlay, knownAgents, checking, props, nextCommand, spaces, exec, machines, readTextFile,
} from "herdr";
import * as fs from "fs/promises";

const ICON = (n) => `mods/dock-tabs/${n}.svg`;
const DOCKS = ["dock-right", "dock-bottom"];
const STACK = (dock) => `${dock}-stack`;
const TITLE = "nt.title";
let SUFFIX = "", YAZI = "dock-yazi", LAZYGIT = "dock-lazygit";
// This window's dock name suffix (dock.json); read once, before any dock
// terminal is looked up or started.
let namesLoaded = null;
function loadNames() {
  return (namesLoaded ??= readTextFile(`${appHome()}/dock.json`).then((t) => {
    try { SUFFIX = String(JSON.parse(t ?? "{}").suffix ?? ""); } catch {}
    YAZI = `dock-yazi${SUFFIX}`; LAZYGIT = `dock-lazygit${SUFFIX}`;
  }).catch(() => null));
}
// The user's login PATH (the app's exec has it; herdr-core started over SSH
// may have only /usr/bin:/bin), for the dock loops started with hc run.
let userPath = null;
async function withPath(argv) {
  userPath ??= exec("/bin/sh", ["-c", 'printf %s "$PATH"']).then((r) => r.stdout.trim()).catch(() => "");
  const p = await userPath;
  return p ? ["env", `PATH=${p}`, ...argv] : argv;
}
// One yazi DDS client id per session (both run on this machine).
const YAZI_ID = () => (/-work$/.test(appHome()) ? "90002" : "90001");
const TARGET = (name) => `${appHome()}/data/dock/${name}.target`;
const LOOP = (name) => ({
  [YAZI]: () => ["sh", "-c", 'while :; do yazi --client-id "$2" "$(cat "$1" 2>/dev/null || echo "$HOME")"; sleep 0.3; done', YAZI, TARGET(YAZI), YAZI_ID()],
  // lazygit only in a git repo; elsewhere a steady "not a repository" screen
  // until the target names a repo again.
  [LAZYGIT]: () => ["sh", "-c", 'while :; do t=$(cat "$1"); if git -C "$t" rev-parse --git-dir >/dev/null 2>&1; then lazygit -p "$t"; sleep 0.2; else clear; printf "\\033[2mNot a git repository: %s\\033[0m\\n" "$t"; sleep 2; fi; done', LAZYGIT, TARGET(LAZYGIT)],
})[name]();

// ---- layout tree --------------------------------------------------------------

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}

const tree = () => JSON.parse(JSON.stringify(layout() ?? {}));
// A subtab's terminal name: "dock-yazi" here, "<machine>/dock-yazi" elsewhere.
const machineOf = (name) => (name && name.includes("/") ? name.slice(0, name.indexOf("/")) : null);
const baseOf = (name) => (name && name.includes("/") ? name.slice(name.indexOf("/") + 1) : name);
const childId = (dock, name) => {
  const m = machineOf(name);
  return `${dock}-${baseOf(name).replace(/^dock-/, "")}${m ? "@" + m.replace(/[^A-Za-z0-9_-]/g, "_") : ""}`;
};
const nameOf = (child) => child?.content?.terminal ?? null;
const currentMachine = () => spaces().find((s) => s.active)?.machine ?? null;

// The live terminal for a subtab name, here or on its machine.
function termOf(all, name) {
  const m = machineOf(name), base = baseOf(name);
  return all.find((t) => t.state === "live" && t.name === base && (m ? t.address.startsWith(m + "/") : !t.address.includes("/"))) ?? null;
}

// The dock's subtabs in order, from its stack: [{ id, name, machine, term }].
// With `machine` given (null = this computer), only that machine's subtabs.
function tabs(dock, machine) {
  const st = find(layout(), STACK(dock));
  const all = terminals();
  const list = (st?.children ?? []).map((c) => ({ id: c.id, name: nameOf(c), machine: machineOf(nameOf(c)), term: termOf(all, nameOf(c)) }));
  return machine === undefined ? list : list.filter((t) => t.machine === machine);
}

function activeOf(dock) {
  const st = find(layout(), STACK(dock));
  return st?.active ?? st?.children?.[0]?.id ?? null;
}

// Rewrite both docks' stacks to hold `names` in order; `active` per dock.
function setTabs(names, active) {
  const t = tree();
  for (const dock of DOCKS) {
    const st = find(t, STACK(dock));
    if (!st) continue;
    st.children = names.map((n) => ({ id: childId(dock, n), type: "block", content: { terminal: n } }));
    const want = active?.[dock];
    st.active = want && names.includes(want) ? childId(dock, want) : st.children.some((c) => c.id === st.active) ? st.active : st.children[0]?.id;
    if (!st.active) delete st.active;
  }
  run("layout.set", { layout: t });
}

function label(tab) {
  const t = tab.term;
  const base = baseOf(tab.name);
  return t?.labels?.[TITLE] || (base === YAZI ? "yazi" : base === LAZYGIT ? "lazygit" : "") || t?.title || t?.program?.name || base;
}

// ---- actions ------------------------------------------------------------------

function fail(title, r) {
  notify({ title, body: (r?.stderr || r?.stdout || String(r ?? "")).trim().slice(0, 300), level: "error" });
}

function here() {
  return focused()?.cwd || home();
}

async function startLoop(name) {
  await fs.mkdir(`${appHome()}/data/dock`, { recursive: true });
  try { await fs.stat(TARGET(name)); } catch { await fs.writeFile(TARGET(name), here()); }
  // A finished terminal keeps its name until removed: free it (a live one is
  // left alone; `hc rm` refuses those).
  await hc(["rm", name]).catch(() => null);
  const r = await hc(["run", "--bg", "--json", "--no-parent", "--no-notify", "--name", name, "--cwd", home(), "--", ...(await withPath(LOOP(name)))]);
  if (r.code !== 0) fail(`Dock: starting ${name} failed`, r);
}

// The subtab last shown for each machine, so switching back to a machine's
// space shows what was showing there.
const ACTIVE = "dock.active";
function remember(tab) {
  setShared(ACTIVE, { ...(shared(ACTIVE) ?? {}), [tab.machine ?? ""]: baseOf(tab.name) });
}

function show(dock, tab) {
  run("layout.select", { stack: STACK(dock), child: tab.id });
  remember(tab);
}

async function addTab(dock, command) {
  const machine = currentMachine();
  const base = `dock-t${Date.now().toString(36)}`;
  const cwd = here();
  const r = await hc(["run", "--bg", "--json", ...(machine ? ["--on", machine] : []), "--no-parent", "--no-notify", "--rm", "--keep",
    "--name", base, ...(machine && !cwd.startsWith("/") && !/^[A-Za-z]:/.test(cwd) ? [] : ["--cwd", cwd])]);
  if (r.code !== 0) return fail("New dock tab failed", r);
  const name = machine ? `${machine}/${base}` : base;
  const names = tabs(dock).map((t) => t.name).filter(Boolean);
  const at = names.indexOf(nameOf(find(layout(), activeOf(dock))));
  names.splice(at < 0 ? names.length : at + 1, 0, name);
  setTabs(names, { [dock]: name });
  remember({ name, machine });
  if (command) await hc(["send", name, command]);
}

async function closeTab(dock, tab) {
  const list = tabs(dock, tab.machine);
  const i = list.findIndex((t) => t.id === tab.id);
  const rest = tabs(dock).filter((t) => t.id !== tab.id);
  const next = list[i + 1] ?? list[i - 1];
  // Drop it from both stacks first, then end it: an ended terminal's block
  // would otherwise be removed by the app on its own. Removing its last block
  // may already end it, so "not found" is success here.
  setTabs(rest.map((t) => t.name), next ? { [dock]: next.name } : {});
  if (tab.term) {
    const r = await hc(["kill", tab.name]);
    if (r.code !== 0 && !/not_found/.test(r.stdout + r.stderr)) fail("Close dock tab failed", r);
  }
  if (!rest.some((t) => t.machine === tab.machine)) run("layout.hide", { id: dock });
}

// Move a subtab past its neighbour among the same machine's subtabs.
function moveTab(dock, tab, step) {
  const mine = tabs(dock, tab.machine);
  const i = mine.findIndex((t) => t.id === tab.id), j = i + step;
  if (i < 0 || j < 0 || j >= mine.length) return;
  const names = tabs(dock).map((t) => t.name);
  const a = names.indexOf(mine[i].name), b = names.indexOf(mine[j].name);
  [names[a], names[b]] = [names[b], names[a]];
  setTabs(names, { [dock]: nameOf(find(layout(), activeOf(dock))) });
}

function cycle(dock, step) {
  const list = tabs(dock, currentMachine());
  if (list.length < 2) return;
  const i = list.findIndex((t) => t.id === activeOf(dock));
  show(dock, list[(i + step + list.length) % list.length]);
}

// ---- remote dock terminals ------------------------------------------------------

const MACHINES = "dock.machines";
const HINT = {
  win: { yazi: "winget install sxyazi.yazi", lazygit: "winget install JesseDuffield.lazygit" },
  mac: { yazi: "brew install yazi", lazygit: "brew install lazygit" },
  posix: { yazi: "install yazi with the system package manager", lazygit: "install lazygit with the system package manager" },
};

// Write `text` to `path` on `machine` (hc file write reads stdin; no shell there).
async function writeRemote(machine, path, text) {
  const hcBin = `${home()}/.local/bin/herdr-core`;
  return exec("sh", ["-c", 'printf %s "$1" | "$2" file write --on "$3" "$4"', "sh", text, hcBin, machine, path], { timeout: 30000 });
}

// The restart loop for a dock tool, in the remote shell's syntax. Missing tool:
// print why and how to install, and leave the shell at its prompt.
function remoteLoop(os, tool, target, machine) {
  const hint = HINT[os]?.[tool] ?? HINT.posix[tool];
  const msg = `${tool} is not installed on ${machine}. Install it (${hint}), then close this dock tab and reopen the dock.`;
  // yazi runs anywhere; lazygit only in a git repo: elsewhere show why and
  // wait (the target changes when a repo's tab is shown).
  if (os === "win") {
    const body = tool === "yazi"
      ? `yazi "$t"; Start-Sleep -Milliseconds 300`
      : `if (git -C "$t" rev-parse --git-dir 2>$null) { lazygit -p "$t"; Start-Sleep -Milliseconds 300 } else { Clear-Host; Write-Host "Not a git repository: $t" -ForegroundColor DarkGray; Start-Sleep 2 }`;
    return ` if (Get-Command ${tool} -ErrorAction SilentlyContinue) { while ($true) { $t = (Get-Content -Raw '${target}').Trim(); ${body} } } else { Clear-Host; Write-Host '${msg}' -ForegroundColor Yellow }`;
  }
  const body = tool === "yazi"
    ? `yazi "$t"; sleep 0.3`
    : `if git -C "$t" rev-parse >/dev/null 2>&1; then lazygit -p "$t"; sleep 0.3; else clear; printf '\\033[2mNot a git repository: %s\\033[0m\\n' "$t"; sleep 2; fi`;
  return ` if command -v ${tool} >/dev/null 2>&1; then while :; do t=$(cat '${target}'); ${body}; done; else clear; printf '\\033[33m%s\\033[0m\\n' '${msg}'; fi`;
}

// Start <machine>/dock-yazi or <machine>/dock-lazygit: an interactive shell on
// that machine (its own PATH, and HC_TERMINAL_ID keeps the herdr TUI out),
// given the restart loop. Records the machine's OS, home and target files.
async function startRemote(machine, name, cwd) {
  await hc(["rm", `${machine}/${name}`]).catch(() => null);
  const r = await hc(["run", "--on", machine, "--bg", "--json", "--no-parent", "--no-notify", "--keep", "--name", name]);
  if (r.code !== 0) { fail(`Dock: can't start ${name} on ${machine}`, r); return false; }
  let info;
  try { info = JSON.parse(r.stdout); } catch { return false; }
  const agent = String(info.agent ?? "");
  const win = /pwsh|powershell|cmd\.exe/i.test(agent) || /^[A-Za-z]:\\/.test(info.cwd ?? "");
  const homeDir = info.cwd ?? "";
  const sep = win ? "\\" : "/";
  const os = win ? "win" : (homeDir.startsWith("/Users/") ? "mac" : "posix");
  const tool = name === YAZI ? "yazi" : "lazygit";
  const target = `${homeDir}${sep}.cache${sep}herdr-dock${sep}${tool}${SUFFIX}.target`;
  const start = tool === "yazi" ? (cwd || homeDir) : homeDir;
  const w = await writeRemote(machine, target, start);
  if (w.code !== 0) { fail(`Dock: can't write ${target} on ${machine}`, w); return false; }
  const all = { ...(shared(MACHINES) ?? {}) };
  all[machine] = { ...(all[machine] ?? {}), os, home: homeDir, [tool]: target };
  setShared(MACHINES, all);
  await hc(["send", `${machine}/${name}`, remoteLoop(os, tool, target, machine)]);
  return true;
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
    cx.spawn(async (cx) => { await loadNames(); cx.notify(); });
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
    // Start any of this machine's dock tools that aren't running.
    if (c === "refresh" && cx) { this.ensureMachine(cx, currentMachine()); return; }
    if (c === "next") cycle(dock, 1);
    else if (c === "prev") cycle(dock, -1);
    else if (c === "add") addTab(dock);
    else if (c === "close") { const t = tabs(dock).find((x) => x.id === activeOf(dock)); if (t) closeTab(dock, t); }
  }

  shownNow() {
    const node = find(layout(), props()?.dock);
    return Boolean(node) && !node.hidden;
  }

  // On opening: hide the other dock.
  onShown() {
    run("layout.hide", { id: props().other });
  }

  // The shown machine's subtabs must exist and one of them be selected: add
  // its yazi/lazygit the first time, start any that aren't running, then show
  // the subtab last shown for that machine.
  ensureMachine(cx, machine) {
    const { dock } = props();
    if (this.starting) return;
    this.starting = true;
    cx.spawn(async () => {
      try {
        await loadNames();
        const pre = machine ? `${machine}/` : "";
        // Names, not a re-read of the layout: layout() lags a layout.set.
        let names = tabs(dock, machine).map((t) => t.name);
        if (!names.length) {
          names = [pre + YAZI, pre + LAZYGIT];
          setTabs([...tabs(dock).map((t) => t.name), ...names], {});
        }
        const all = terminals();
        let started = false;
        for (const name of names) {
          const base = baseOf(name);
          if (termOf(all, name) || (base !== YAZI && base !== LAZYGIT)) continue;
          if (machine) started = (await startRemote(machine, base, focused()?.cwd)) || started;
          else { await startLoop(base); started = true; }
        }
        // A block whose terminal didn't exist yet stays empty until re-shown.
        if (started) { run("layout.hide", { id: STACK(dock) }); run("layout.show", { id: STACK(dock) }); }
        const want = (shared(ACTIVE) ?? {})[machine ?? ""];
        const pick = names.find((n) => baseOf(n) === want) ?? names[0];
        if (pick) run("layout.select", { stack: STACK(dock), child: childId(dock, pick) });
      } finally { this.starting = false; }
    });
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
    const icon = g?.icon ? (g.tint ? svg(g.icon).size(15).flex_none().text_color(active ? t.foreground : t.muted) : image(g.icon).w(15).h(15).flex_none()) : null;
    const name = label(tab);
    return h_flex().id(`dt-${dock}-${tab.id}`).flex_shrink(1).min_w(56).max_w(220).h(28).pl(8).pr(active ? 3 : 8).gap(6)
      .items_center().rounded(8).border_1().cursor_pointer().text_size(13)
      .when(active, (el) => el.bg(t.raised).border_color(t.border).text_color(t.foreground))
      .when(!active, (el) => el.border_color("#00000000").text_color(t.muted).hover((s) => s.bg(t.hover)))
      .when(!tab.term, (el) => el.opacity(0.5))
      .tooltip(`${name} · ${tab.name}`)
      .on_click((e) => { if (e.click_count >= 2) this.rename(tab); else show(dock, tab); })
      .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); closeTab(dock, tab); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu("tab", tab.id); })
      .child(div().flex_none().text_size(11).text_color(t.dim).child(String(i + 1)))
      .when(Boolean(icon), (el) => el.child(icon))
      .child(div().truncate().child(name))
      .when(active && count > 0, (el) => el.child(
        div().id(`dt-x-${dock}-${tab.id}`).flex_none().p(3).rounded(5).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Close tab")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); closeTab(dock, tab); })
          .child(svg(ICON("x")).size(12))));
  }

  rename(tab) {
    if (!tab.term) return;
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
      if (reachable) this.ensureMachine(cx, machine);
    }
    this.wasShown = shownNow;
    this.keyCommand();
    const t = theme();
    const list = tabs(dock, machine);
    const active = activeOf(dock);
    const offline = machine && machines().find((m) => m.name === machine)?.layout === "unavailable";
    return h_flex().id(`dt-strip-${dock}`).size_full().pl(5).pr(6).gap(6).items_center().border_b(1).border_color(t.border)
      .when(Boolean(machine), (el) => el.child(h_flex().flex_none().gap(4).px(6).h(20).items_center().rounded(5)
        .bg(t.accent + "2e").text_color(t.accent).text_size(11.5).child(machine)))
      .child(h_flex().id(`dt-chips-${dock}`).flex_1().min_w(0).h_full().gap(3).items_center().overflow_hidden()
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu("new"); })
        .when(Boolean(offline), (el) => el.child(div().truncate().text_size(12.5).text_color(t.dim)
          .child(`${machine} is unreachable; its yazi and lazygit keep running there and come back when it reconnects`)))
        .children(list.map((tab, i) => this.chip(tab, i, tab.id === active, list.length))))
      .child(this.button(`dt-add-${dock}`, "plus", "New dock tab (right-click: start an agent)", () => addTab(dock), () => this.menu("new")))
      .child(this.button(`dt-hide-${dock}`, "close", "Hide the dock (its tabs keep running)", () => run("layout.hide", { id: dock })));
  }

  // ---- popup menu ---------------------------------------------------------------

  initMenu(cx) {
    this.at = 0;
    this.agents = [];
    this.busy = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      try { this.agents = (await knownAgents()).filter((a) => a.installed && a.run?.length).slice(0, 4); } catch { this.agents = []; }
      cx.notify();
    });
  }

  menuItems() {
    const { menu, dock, target } = props() ?? {};
    const news = [
      { label: "New tab", icon: "terminal", act: () => addTab(dock) },
      ...this.agents.map((a) => ({ label: `New ${a.name} tab`, icon: "terminal", act: () => addTab(dock, a.run.join(" ")) })),
    ];
    if (menu !== "tab") return news;
    const list = tabs(dock, currentMachine());
    const i = list.findIndex((x) => x.id === target);
    const tab = list[i];
    if (!tab) return news;
    const items = [];
    if (activeOf(dock) !== target) items.push({ label: "Show", icon: "layers", act: () => show(dock, tab) });
    if (tab.term) items.push({ label: "Rename…", icon: "square-pen", act: () => this.rename(tab) });
    items.push({ sep: true }, ...news, { sep: true });
    if (i > 0) items.push({ label: "Move left", icon: "chevron-left", act: () => moveTab(dock, tab, -1) });
    if (i < list.length - 1) items.push({ label: "Move right", icon: "chevron-right", act: () => moveTab(dock, tab, 1) });
    items.push({ sep: true });
    if (list.length > 1) items.push({ label: "Close other tabs", icon: "x", act: async () => { for (const o of tabs(dock, currentMachine())) if (o.id !== target) await closeTab(dock, o); } });
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
            .child(svg(ICON(it.icon)).size(14).flex_none().text_color(t.muted))
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
