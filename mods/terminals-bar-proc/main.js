// Terminals layout's draggable top bar: tabs (process name, nested-aware status dot) and window controls.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, terminals, run, theme, openOverlay, window as win } from "herdr";

const C = {
  tray: "#1d1f22",
  // The shown tab stands out; a hovered one only hints, so the two never look alike.
  tab: "#34373c",
  tabEdge: "#4a4d53",
  hover: "#ffffff07",
  edge: "#383b40",
  chip: "#252628",
  text: "#e8e9eb",
  dim: "#8b8f95",
};

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
const MOD_ICON = { "cria-file-preview": "file", nav: "folder", git: "git-branch" };
const MOD_NAME = { "cria-file-preview": "viewer", nav: "nav", git: "git" };

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
  render() {
    const t = theme();
    const space = spaces().find((p) => p.active);
    if (!space) return div();
    const all = panes();
    const w = win() ?? {};

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
      return own(h_flex())
        .id(`tm-${c.id}`)
        .flex_shrink(1)
        .w(260)
        .min_w(0)
        .h_full()
        .pl(5)
        .pr(4)
        .gap(9)
        .items_center()
        .rounded(13)
        .border_1()
        .cursor_pointer()
        .text_size(13)
        .when(c.active, (el) => el.bg(C.tab).border_color(C.tabEdge))
        .when(!c.active, (el) => el.border_color("#00000000").hover((s) => s.bg(C.hover)))
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
            .on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })
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
          .flex_shrink(1)
          .min_w(0)
          .h(36)
          .p(3)
          .gap(3)
          .rounded(16)
          .bg(C.tray)
          .children(space.tabs.map(tab)),
      )
      .child(div().flex_1())
      .child(iconButton("tm-keys", "command", () => run("app.palette")))
      .child(iconButton("tm-new", "plus", () => run("tab.new", { space: space.id })))
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
