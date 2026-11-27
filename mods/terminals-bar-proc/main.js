// Terminals layout's draggable top bar: tabs (process name, nested-aware status dot) and window controls.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, terminals, run, theme, openOverlay, layout, keys, nextCommand, checking, window as win } from "herdr";
import { machineColor } from "./lib/machine-color.js";
import { keyFor, dockTooltip } from "./lib/key-names.js";
import { closeTab, followShown, openTab, moveShown } from "./keep.js";
import { chatPairs } from "./lib/chat-stack.js";
import { spaceFolder } from "./lib/location.js";

const C = {
  tray: "#1d1f22",
  // Tabs not shown sit on a faint fill; the shown one has none: it is the top of its
  // pane, whose see-through backdrop it shares (#10).
  tab: "#ffffff09",
  hover: "#ffffff10",
  edge: "#383b40",
  chip: "#252628",
  text: "#e8e9eb",
  dim: "#8b8f95",
};

const TAB_W = 220; // tabs keep this width and the strip scrolls (#9)
const BAR_H = 32;  // the layout's "tabs" block: the shown tab fills it, down to its pane

// The pane frame's border colours in the shown layout (its "tab": "active" block), so
// the shown tab is drawn in the same line as the pane it sits on.
function paneEdges(node) {
  if (!node || typeof node !== "object") return null;
  const pane = node.content?.tab ? node.content.pane : null;
  if (pane) return { border: pane.border?.color ?? null, focus: pane.focus?.color ?? pane.border?.color ?? null };
  for (const c of node.children ?? []) {
    const found = paneEdges(c);
    if (found) return found;
  }
  return null;
}

// The pane a tab's tab speaks for: the focused one, else its agent, else the first.
function lead(all, id) {
  const mine = all.filter((p) => p.tab === id);
  return mine.find((p) => p.focused) ?? mine.find((p) => p.program?.agent) ?? mine[0];
}

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

// The most urgent agent status in a tab: its panes' agents and their
// nested-tab agents (pane-less terminals labelled nt.stack, children of their
// pane's own terminal).
function tabStatus(all, id) {
  const here = all.filter((p) => p.tab === id);
  const words = here.map((p) => p.status);
  const owners = new Set(here.map((p) => p.terminal).filter(Boolean));
  for (const k of terminals()) {
    if (k.state === "live" && k.labels?.["nt.stack"] && owners.has(k.parent)) words.push(k.status === "error" ? "blocked" : k.status);
  }
  let best = null;
  for (const s of words) if (s && (RANK[s] ?? 0) > (RANK[best] ?? 0)) best = s;
  return best;
}

// A mod pane has no program: its tile shows a glyph for the mod (herdr-mods).
const MOD_ICON = { "cria-file-preview": "file", nav: "folder", git: "git-branch", "ushi-naruse": "cow" };
const MOD_NAME = { "cria-file-preview": "viewer", nav: "nav", git: "git", "ushi-naruse": "chat" };

// The program's tile from the app's table: its color, its glyph (or logo) on it.
function tile(t, p, status) {
  const g = p?.program ?? (p?.mod ? { icon: `mods/terminals-bar-proc/${MOD_ICON[p.mod] ?? "stack"}.svg`, tint: true, color: C.text } : null);
  const dot = status && status !== "idle" ? t[status] : null;
  return div()
    .relative()
    .flex_none()
    .w(22)
    .h(22)
    .rounded(6)
    .border_1()
    .border_color("#ffffff14")
    .bg(g?.tile ?? C.chip)
    .flex()
    .items_center()
    .justify_center()
    .when(Boolean(g?.icon), (el) =>
      el.child(g.tint ? svg(g.icon).size(13).text_color(g.color ?? C.text) : image(g.icon).w(13).h(13)),
    )
    .when(Boolean(dot), (el) =>
      el.child(div().absolute().top(-3).right(-3).w(9).h(9).rounded_full().border_2().border_color(C.tray).bg(dot)),
    );
}

// A control in the draggable bar: the press is its own, not the window's
// (a right press there would open the system's window menu).
function own(el) {
  return el.on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_mouse_down("right", (_e, cx) => cx.stop_propagation());
}

function windowButton(id, icon, command) {
  return own(
    div()
      .id(id)
      .flex_none()
      .w(24)
      .h(24)
      .rounded_full()
      .flex()
      .items_center()
      .justify_center()
      .bg(C.chip)
      .text_color(C.dim)
      .cursor_pointer()
      .hover((s) => s.bg(C.edge).text_color(C.text))
      .on_click(() => run(command))
      .child(svg(`mods/terminals-bar-proc/${icon}.svg`).size(14)),
  );
}

function iconButton(id, icon, onClick, onRight) {
  return own(div())
    .id(id)
    .flex_none()
    .p(5)
    .rounded(7)
    .text_color(C.dim)
    .cursor_pointer()
    .hover((s) => s.bg(C.chip).text_color(C.text))
    .on_click(onClick)
    .when(Boolean(onRight), (el) => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); onRight(); }))
    .child(svg(`mods/terminals-bar-proc/${icon}.svg`).size(16));
}

const DOCKS = ["dock-right", "dock-bottom"];
const DOCK_ICON = { "dock-right": "panel-right", "dock-bottom": "panel-bottom" };

// The layout node with this id, or null.
function findNode(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

// A dock's toggle (spec 020): lit while the dock is shown, dim while hidden;
// the tooltip names the action and the key bound to it.
function dockButton(dock) {
  const node = findNode(layout(), dock);
  const shown = Boolean(node) && !node.hidden;
  const key = keyFor(keys(), `layout.toggle:${dock}`, win()?.platform);
  return own(div())
    .id(`tm-${dock}`)
    .flex_none()
    .p(5)
    .rounded(7)
    .text_color(shown ? C.text : C.dim)
    .when(shown, (el) => el.bg(C.chip))
    .cursor_pointer()
    .hover((el) => el.bg(C.hover).text_color(C.text))
    .tooltip(dockTooltip(dock, shown, key))
    .on_click(() => run("layout.toggle", { id: dock }))
    .child(svg(`mods/terminals-bar-proc/${DOCK_ICON[dock]}.svg`).size(16));
}

export default class TerminalsBar extends View {
  init(_props, cx) {
    this.scroll = ScrollHandle.new();
    this.revealed = null;
    this.wheel = 0;
    // Closing the shown tab goes back to the one shown before it (keep.js).
    cx.timer.every(300, () => followShown());
    if (checking()) return;
    // The palette's Tab: move left / right (keep.js moveShown).
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c === "move-left" || c === "move-right") moveShown(c === "move-left" ? -1 : 1);
      }
    });
  }

  // The wheel over the strip moves along it a tab at a time.
  onWheel(e, count) {
    const lines = e.delta_lines;
    this.wheel += lines ? (lines.y || lines.x) : (e.delta.y || e.delta.x) / 40;
    let moved = false;
    while (this.wheel >= 1) { this.view = Math.max(0, this.view - 1); this.wheel -= 1; moved = true; }
    while (this.wheel <= -1) { this.view = Math.min(count - 1, this.view + 1); this.wheel += 1; moved = true; }
    if (moved) this.scroll.scroll_to_item(this.view);
  }

  render() {
    const t = theme();
    const space = spaces().find((p) => p.active);
    // A remote space's machine colour (lib/machine-color.js), as on its spaces-bar chip.
    const mc = space?.machine ? machineColor(space.machine, spaces().map((x) => x.machine)) ?? t.accent : null;
    if (!space) return div();
    const hl = mc ?? t.accent;
    const all = panes();
    const w = win() ?? {};
    const edges = paneEdges(layout()) ?? {};
    // Settled tabs (a chat's hidden agent terminal, spec 008) are left out, as the
    // shipped tab bar does, unless one is shown.
    // A chat's hidden partner tab (spec 021: its agent's pane and nested tabs) is drawn
    // as the chat's tab, lit while either is shown. Shown, the app unsettles it for a
    // while (the chat settles it again), so it's left out by the pair, not the flag.
    const pairs = chatPairs(terminals());
    const partnerShown = new Set(space.tabs.filter((c) => c.active && pairs.has(c.id)).map((c) => pairs.get(c.id).chat));
    const shownTabs = space.tabs.filter((c) => !pairs.has(c.id) && (!c.settled || c.active))
      .map((c) => (partnerShown.has(c.id) ? { ...c, active: true } : c));
    const focusedPane = all.some((p) => p.focused && p.tab === space.tabs.find((c) => c.active)?.id);
    const edge = (focusedPane ? edges.focus : edges.border) ?? t.border;
    // Reveal the shown tab when it changes; a wheel scroll owns the strip until then.
    const active = shownTabs.findIndex((c) => c.active);
    const key = `${space.id}:${active}:${shownTabs.length}`;
    if (active >= 0 && key !== this.revealed) {
      this.revealed = key;
      this.view = active;
      this.scroll.scroll_to_item(active);
    }

    const tab = (c) => {
      const p = lead(all, c.id);
      // The process running in the tab's lead pane, not its folder: the
      // folder already shows in the pane header (nested-tabs).
      // An agent's own report is a slug ("claude-code"): show it as words.
      const raw = p?.mod ? (MOD_NAME[p.mod] ?? "") : (p?.program?.name || p?.title || "");
      const proc = p?.program?.agent && /^[a-z0-9]+(-[a-z0-9]+)+$/.test(raw)
        ? raw.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")
        : raw;
      const same = (a, b) => a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");
      // herdr-mods: dragged onto another tab, a tab takes its place (tab.move).
      const target = this.drag && this.drag !== c.id && this.over?.id === c.id;
      // The shown tab reaches the bottom of the bar, open at the bottom, onto its pane;
      // the others are shorter and lifted off it.
      return own(h_flex())
        .id(`tm-${c.id}`)
        .flex_none()
        .w(TAB_W)
        .pl(6)
        .pr(4)
        .gap(9)
        .items_center()
        .cursor_pointer()
        .text_size(13)
        // Marked by a bar along its top and a tint in the accent (the machine's colour in
        // a remote space), so the shown tab stands out from the rest (operator, 2026-11-27).
        .when(c.active, (el) => el.relative().h(BAR_H).rounded_t(9).border_t_1().border_l_1().border_r_1().border_color(edge).bg(hl + "24")
          .child(div().absolute().top(0).left(6).right(6).h(2).rounded_b(2).bg(hl)))
        .when(!c.active, (el) => el.h(BAR_H - 6).mt(3).rounded(8).bg(C.tab).hover((s) => s.bg(C.hover)))
        .when(target, (el) => el.border_1().border_color(t.accent))
        .when(this.drag === c.id && Boolean(this.over) && this.over.id !== c.id, (el) => el.opacity(0.55))
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.drag = c.id; this.over = null; })
        .on_hover((hovered, cx) => {
          if (!this.drag) return;
          if (hovered) this.over = { id: c.id, index: c.index };
          else if (this.over?.id === c.id) this.over = null;
          cx.notify();
        })
        .on_click(() => openTab(c.id))
        .on_mouse_down("right", () =>
          openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }),
        )
        .child(tile(t, p, tabStatus(all, c.id)))
        .child(
          h_flex()
            .flex_1()
            .min_w(0)
            .gap(6)
            .truncate()
            .child(div().flex_none().text_color(c.active ? C.text : "#c4c6ca").child(c.name))
            .when(Boolean(proc) && !same(proc, c.name), (el) => el.child(div().truncate().text_color(C.dim).child(proc))),
        )
        // Close (herdr-mods): every tab has one; closing a space's last tab asks first.
        .child(
          div()
            .id(`tm-x-${c.id}`)
            .flex_none()
            .p(4)
            .rounded(6)
            .text_color(C.dim)
            .hover((s) => s.bg(C.hover).text_color(C.text))
            .tooltip("Close tab")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            // A chat's agent shown in the tab moves out first (spec 008 R12).
            .on_click((_e, cx) => { cx.stop_propagation(); closeTab(c.id, space.id, c.name, cx); })
            .child(svg("mods/terminals-bar-proc/x.svg").size(12)),
        );
    };

    return h_flex()
      .size_full()
      .gap(8)
      .items_center()
      // The drop: the window's mouse-up comes before the tab's own, so the move is
      // made here, onto the tab last hovered; let go anywhere else, nothing moves.
      .on_window_mouse_up("left", (_e, cx) => {
        const from = this.drag, onto = this.over;
        if (!from) return;
        this.drag = null;
        this.over = null;
        if (onto && onto.id !== from) run("tab.move", { id: from, index: onto.index });
        cx.notify();
      })
      // macOS: the window buttons sit in the spaces bar above (the top row),
      // which leaves them room; none here.
      // (The space picker pill is gone: the spaces bar above shows every space.)
      // New tab, at the left end (operator, 2026-11-25), ahead of the tabs.
      // Right-click: New tab, an agent, or a chat (nested-tabs' menu, "top" mode).
      // The new tab starts where the shown tab works (its program's folder, a chat's agent's).
      .child(div().flex_none().pl(8).child(iconButton("tm-new", "plus", () => {
        const folder = spaceFolder(space.id);
        run("tab.new", { space: space.id, ...(folder ? { folder } : {}) });
      }, () => openOverlay({ mod: "nested-tabs", kind: "popup", width: 260, props: { menu: "top", space: space.id, on: space.machine ?? null, folder: spaceFolder(space.id) } }))))
      // A remote space says so before its tabs: these terminals run elsewhere.
      .when(Boolean(space.machine), (el) =>
        el.child(
          h_flex()
            .id("tm-machine")
            .flex_none()
            .h(24)
            .px(10)
            .gap(7)
            .items_center()
            .rounded_full()
            // The machine's own colour, as on its chip in the spaces bar.
            .bg(mc + "33")
            .border_1()
            .border_color(mc + "66")
            .text_color(mc)
            .text_size(13)
            .tooltip(`Terminals in this space run on ${space.machine}`)
            .child(svg("mods/terminals-bar-proc/server.svg").size(14))
            .child(div().max_w(180).truncate().child(space.machine)),
        ),
      )
      .child(
        h_flex()
          .id("tm-strip")
          .flex_1()
          .min_w(0)
          .h(BAR_H)
          // The + sits past the pane's rounded corner, so the first tab meets its straight top edge.
          .pl(2)
          .gap(4)
          .overflow_x_scroll()
          .track_scroll(this.scroll)
          .on_scroll_wheel((e) => this.onWheel(e, shownTabs.length))
          .children(shownTabs.map(tab)),
      )
      .children(DOCKS.map(dockButton))
      .child(iconButton("tm-keys", "command", () => run("app.palette")))
      .when(Boolean(w.buttons), (el) =>
        el.child(
          h_flex()
            .flex_none()
            .pl(6)
            .pr(4)
            .gap(8)
            .child(windowButton("tm-min", "win-min", "window.minimize"))
            .child(windowButton("tm-max", w.maximized ? "win-restore" : "win-max", "window.maximize"))
            .child(windowButton("tm-close", "win-close", "window.close")),
        ),
      );
  }
}
