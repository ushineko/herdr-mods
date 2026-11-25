// Terminals layout's draggable top bar: tabs (process name, nested-aware status dot) and window controls.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, terminals, run, theme, openOverlay, layout, window as win } from "herdr";
import { closeTab } from "./keep.js";

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
const BAR_H = 42;  // the layout's "tabs" block: the shown tab fills it, down to its pane

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
// nested-tab agents (pane-less terminals labelled nt.stack=<pane>).
function tabStatus(all, id) {
  const mine = new Set(all.filter((p) => p.tab === id).map((p) => p.pane));
  const words = all.filter((p) => mine.has(p.pane)).map((p) => p.status);
  for (const k of terminals()) {
    if (k.state === "live" && mine.has(k.labels?.["nt.stack"])) words.push(k.status === "error" ? "blocked" : k.status);
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
    .w(26)
    .h(26)
    .rounded(7)
    .border_1()
    .border_color("#ffffff14")
    .bg(g?.tile ?? C.chip)
    .flex()
    .items_center()
    .justify_center()
    .when(Boolean(g?.icon), (el) =>
      el.child(g.tint ? svg(g.icon).size(15).text_color(g.color ?? C.text) : image(g.icon).w(15).h(15)),
    )
    .when(Boolean(dot), (el) =>
      el.child(div().absolute().top(-4).right(-4).w(11).h(11).rounded_full().border_2().border_color(C.tray).bg(dot)),
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

function iconButton(id, icon, onClick) {
  return own(div())
    .id(id)
    .flex_none()
    .p(7)
    .rounded(8)
    .text_color(C.dim)
    .cursor_pointer()
    .hover((s) => s.bg(C.chip).text_color(C.text))
    .on_click(onClick)
    .child(svg(`mods/terminals-bar-proc/${icon}.svg`).size(17));
}

export default class TerminalsBar extends View {
  init() {
    this.scroll = ScrollHandle.new();
    this.revealed = null;
    this.wheel = 0;
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
    if (!space) return div();
    const all = panes();
    const w = win() ?? {};
    const edges = paneEdges(layout()) ?? {};
    // Settled tabs (a chat's hidden agent terminal, spec 008) are left out, as the
    // shipped tab bar does, unless one is shown.
    const shownTabs = space.tabs.filter((c) => !c.settled || c.active);
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
        .when(c.active, (el) => el.h(BAR_H).rounded_t(11).border_t_1().border_l_1().border_r_1().border_color(edge))
        .when(!c.active, (el) => el.h(32).mt(BAR_H - 36).rounded(10).bg(C.tab).hover((s) => s.bg(C.hover)))
        .on_click(() => run("tab.select", { id: c.id }))
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
      // macOS: the window buttons sit in the spaces bar above (the top row),
      // which leaves them room; none here.
      // (The space picker pill is gone: the spaces bar above shows every space.)
      // New tab, at the left end (operator, 2026-11-25), ahead of the tabs.
      .child(div().flex_none().pl(8).child(iconButton("tm-new", "plus", () => run("tab.new", { space: space.id }))))
      // A remote space says so before its tabs: these terminals run elsewhere.
      .when(Boolean(space.machine), (el) =>
        el.child(
          h_flex()
            .id("tm-machine")
            .flex_none()
            .h(30)
            .px(10)
            .gap(7)
            .items_center()
            .rounded_full()
            .bg(t.accent + "2e")
            .text_color(t.accent)
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
