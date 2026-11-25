// Horizontal spaces bar: a port of the herdr TUI fork's spaces bar
// (ushineko/specs/000-spaces-bar.md) to the Herdr app.
//
// Spaces on another machine fold into one chip per machine, where its first
// space is: "<machine> ▾ <count>", or "<machine>: <space>" while one of its
// spaces is shown, with the worst agent state across them. Clicking it opens
// a dropdown of that machine's spaces; hovering one cascades its agents to
// the side (click to focus). Local spaces keep a chip each.
//
// One chip per space: number (1-9), rolled-up state glyph, name (truncated),
// and a folded agent rollup (at most 3 state classes, most urgent first, with a
// count when more than one agent shares a state). Nested-tab agents count too.
// Click a chip to switch space; right-click for the space menu; click the
// rollup to focus the space's single agent or pick among several. The wheel
// scrolls the strip; the shown space is always scrolled into view.
//
// Props: none for the bar; { picker: <space id> } for the agent picker popup;
// { group: <machine> } for a machine's dropdown; { machines: true } for the
// "new space on…" menu.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { spaces, run, theme, props, openOverlay, closeOverlay, hc, window as win } from "herdr";
import { allAgents, worst, focusAgent, ORDER, RANK } from "./agents.js";

const ICON = (n) => `mods/spaces-bar/${n}.svg`;
const GLYPH = { blocked: "✕", done: "✓", idle: "○" };

// A machine's dropdown: row and header heights, panel widths.
const ROW = 31, HEAD = 26, SPACES_W = 300, AGENTS_W = 336;
// Tall enough for the spaces list and, beside any of them, its agents list.
function groupHeight(list, agents) {
  let h = 12 + HEAD + ROW * list.length;
  list.forEach((s, k) => {
    const n = agents.filter((a) => a.space === s.id).length;
    if (n) h = Math.max(h, 12 + k * ROW + HEAD + ROW * n);
  });
  return h + 4;
}

// A control in a window_drag block: its presses are its own.
function own(el) {
  return el.on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_mouse_down("right", (_e, cx) => cx.stop_propagation());
}

function glyph(t, status, size = 12) {
  if (!status) return null;
  if (status === "working") return svg(ICON("spinner")).size(size).flex_none().text_color(t.working).spin(900);
  return div().flex_none().text_size(size).text_color(t[status] ?? t.dim).child(GLYPH[status] ?? "·");
}

function programIcon(p, color) {
  const g = p?.program;
  if (!g?.icon) return null;
  return g.tint ? svg(g.icon).size(14).flex_none().text_color(color) : image(g.icon).w(14).h(14).flex_none();
}

export default class SpacesBar extends View {
  init(_props, cx) {
    if (props()?.picker || props()?.machines || props()?.group) {
      this.at = 0;
      this.handle = cx.focus_handle();
      this.handle.focus();
      if (props()?.machines) {
        // "This computer" first, then every connected machine (as the shipped picker lists them).
        this.machineList = [null];
        cx.spawn(async (cx) => {
          try {
            const r = await hc(["machine", "ls", "--json"]);
            if (r.code === 0) {
              const ms = JSON.parse(r.stdout).machines ?? [];
              this.machineList = [null, ...ms.filter((m) => m.state === "connected" && !m.temporary).map((m) => m.name)];
            }
          } catch {}
          cx.notify();
        });
      }
      return;
    }
    this.scroll = ScrollHandle.new();
    this.revealed = null;
    this.view = 0;
    this.wheelAcc = 0;
  }

  // ---- bar ------------------------------------------------------------------

  rollup(t, s, mine) {
    if (!mine.length) return null;
    const counts = new Map();
    for (const a of mine) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
    const classes = ORDER.filter((st) => counts.has(st)).slice(0, 3);
    return own(h_flex())
      .id(`sb-roll-${s.id}`)
      .flex_none()
      .gap(5)
      .px(5)
      .h(20)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((x) => x.bg(t.hover))
      .tooltip(mine.length === 1 ? `Focus ${mine[0].title}` : `${mine.length} agents: pick one`)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (mine.length === 1) focusAgent(mine[0]);
        else openOverlay({ mod: "spaces-bar", kind: "popup", width: 340, props: { picker: s.id } });
      })
      .children(classes.map((st) =>
        h_flex().gap(2).items_center()
          .child(glyph(t, st, 11))
          .when(counts.get(st) > 1, (el) => el.child(div().text_size(11).text_color(t.muted).child(String(counts.get(st)))))));
  }

  chip(t, s, i, mine) {
    const state = worst(mine) ?? s.status;
    const roll = this.rollup(t, s, mine);
    return own(h_flex())
      .id(`sb-${s.id}`)
      .flex_none()
      .h(28)
      .pl(8)
      .pr(roll ? 3 : 10)
      .gap(6)
      .items_center()
      .rounded(9)
      .border_1()
      .cursor_pointer()
      .text_size(13)
      .when(s.active, (el) => el.bg(t.raised).border_color(t.border).text_color(t.foreground))
      .when(!s.active, (el) => el.border_color("#00000000").text_color(t.muted).hover((x) => x.bg(t.hover)))
      .tooltip(`${s.name}${s.branch ? " · " + s.branch : ""}${s.machine ? " · " + s.machine : ""}`)
      .on_click(() => run("space.select", { id: s.id }))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "space", target: { id: s.id } } });
      })
      .when(i < 9, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(i + 1))))
      .when(Boolean(state), (el) => el.child(glyph(t, state)))
      .child(div().flex_none().max_w(160).truncate().child(s.name))
      .when(Boolean(roll), (el) => el.child(roll));
  }

  // The bar's chips in order: a local space each, one per other machine
  // (where its first space is). [{ space, index } | { machine, spaces }]
  items(list) {
    const out = [], seen = new Map();
    list.forEach((s, i) => {
      if (!s.machine) { out.push({ space: s, index: i }); return; }
      let g = seen.get(s.machine);
      if (!g) { g = { machine: s.machine, spaces: [] }; seen.set(s.machine, g); out.push(g); }
      g.spaces.push(s);
    });
    return out;
  }

  groupChip(t, g, agents) {
    const shown = g.spaces.find((s) => s.active);
    const ids = new Set(g.spaces.map((s) => s.id));
    const mine = agents.filter((a) => ids.has(a.space));
    const state = worst(mine) ?? worst(g.spaces.map((s) => ({ status: s.status })));
    return own(h_flex())
      .id(`sb-g-${g.machine}`)
      .flex_none()
      .h(28)
      .px(8)
      .gap(6)
      .items_center()
      .rounded(9)
      .border_1()
      .cursor_pointer()
      .text_size(13)
      .bg(t.accent + (shown ? "3d" : "1f"))
      .border_color(shown ? t.accent + "80" : "#00000000")
      .text_color(shown ? t.foreground : t.muted)
      .hover((x) => x.bg(t.accent + "33"))
      .tooltip(`${g.machine}: ${g.spaces.length} space${g.spaces.length > 1 ? "s" : ""}`)
      .on_click(() => openOverlay({
        mod: "spaces-bar", kind: "popup", frame: "none", width: 640,
        height: groupHeight(g.spaces, agents), props: { group: g.machine },
      }))
      .child(svg(ICON("server")).size(12).flex_none().text_color(t.accent))
      .when(Boolean(state), (el) => el.child(glyph(t, state)))
      .child(div().flex_none().max_w(260).truncate().child(shown ? `${g.machine}: ${shown.name}` : g.machine))
      .when(!shown, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(g.spaces.length))))
      .child(div().flex_none().text_size(10).text_color(t.dim).child("▾"));
  }

  onWheel(e, count) {
    const lines = e.delta_lines;
    this.wheelAcc += lines ? (lines.y || lines.x) : (e.delta.y || e.delta.x) / 40;
    let moved = false;
    while (this.wheelAcc >= 1) { this.view = Math.max(0, this.view - 1); this.wheelAcc -= 1; moved = true; }
    while (this.wheelAcc <= -1) { this.view = Math.min(count - 1, this.view + 1); this.wheelAcc += 1; moved = true; }
    if (moved) this.scroll.scroll_to_item(this.view);
  }

  renderBar() {
    const t = theme();
    const list = spaces();
    const agents = allAgents();
    const items = this.items(list);
    const active = items.findIndex((it) => (it.space ? it.space.active : it.spaces.some((s) => s.active)));
    // Reveal the shown space when it changes; a manual scroll owns the strip until then.
    if (active >= 0 && active !== this.revealed) {
      this.revealed = active;
      this.view = active;
      this.scroll.scroll_to_item(active);
    }
    return h_flex()
      .size_full()
      .gap(6)
      .items_center()
      // macOS: the window buttons (the layout's traffic_lights) sit at the
      // left of this, the top row; leave them room.
      .when(win()?.platform === "macos" && win()?.titlebar === "none" && !win()?.fullscreen, (el) => el.pl(72))
      .child(div()
        .id("sb-new")
        .flex_none()
        .p(6)
        .rounded(8)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((x) => x.bg(t.hover).text_color(t.foreground))
        .tooltip("New space (right-click: choose the machine)")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          openOverlay({ mod: "spaces-bar", kind: "popup", width: 260, props: { machines: true } });
        })
        .on_click(() => run("space.new", {}))
        .child(svg(ICON("plus")).size(15)))
      .child(h_flex()
        .id("sb-strip")
        .flex_1()
        .min_w(0)
        .h_full()
        .gap(3)
        .items_center()
        .overflow_x_scroll()
        .track_scroll(this.scroll)
        .on_scroll_wheel((e) => this.onWheel(e, items.length))
        .children(items.map((it) => it.space
          ? this.chip(t, it.space, it.index, agents.filter((a) => a.space === it.space.id))
          : this.groupChip(t, it, agents))));
  }

  // ---- agent picker -------------------------------------------------------------

  pickerRows() {
    const id = props()?.picker;
    return allAgents()
      .filter((a) => a.space === id)
      .sort((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0));
  }

  choose(a) {
    if (!a) return;
    closeOverlay(props()?.overlay);
    focusAgent(a);
  }

  renderPicker() {
    const t = theme();
    const rows = this.pickerRows();
    if (this.at >= rows.length) this.at = Math.max(0, rows.length - 1);
    const space = spaces().find((s) => s.id === props()?.picker);
    return v_flex()
      .id("sb-picker")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % Math.max(1, rows.length);
        else if (e.key === "up") this.at = (this.at - 1 + rows.length) % Math.max(1, rows.length);
        else if (e.key === "enter") this.choose(rows[this.at]);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .child(div().px(8).py(5).text_size(11.5).text_color(t.dim).child(`Agents in ${space?.name ?? "space"}`))
      .children(rows.map((a, k) =>
        h_flex()
          .id(`sb-pick-${k}`)
          .h(31)
          .px(8)
          .gap(8)
          .rounded(7)
          .items_center()
          .text_color(t.foreground)
          .when(k === this.at, (el) => el.bg(t.selected))
          .hover((x) => x.bg(t.hover))
          .on_click(() => this.choose(a))
          .child(glyph(t, a.status))
          .when(Boolean(programIcon(a, t.foreground)), (el) => el.child(programIcon(a, t.foreground)))
          .child(div().flex_none().max_w(150).truncate().child(a.title ?? a.address))
          .child(div().flex_1().truncate().text_color(t.dim).child(`${a.tab_name ?? ""}${a.nested ? " · nested" : a.chat ? " · chat" : ""}`))));
  }

  // ---- "new space on…" machine menu ----------------------------------------------

  newSpaceOn(machine) {
    closeOverlay(props()?.overlay);
    run("space.new", { machine: machine ?? "" });
  }

  renderMachines() {
    const t = theme();
    const list = this.machineList ?? [null];
    if (this.at >= list.length) this.at = 0;
    return v_flex()
      .id("sb-machines")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at - 1 + list.length) % list.length;
        else if (e.key === "enter") this.newSpaceOn(list[this.at]);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .child(div().px(8).py(5).text_size(11.5).text_color(t.dim).child("New space on"))
      .children(list.map((m, k) =>
        h_flex()
          .id(`sb-mach-${k}`)
          .h(31)
          .px(8)
          .gap(9)
          .rounded(7)
          .items_center()
          .text_color(t.foreground)
          .when(k === this.at, (el) => el.bg(t.selected))
          .hover((x) => x.bg(t.hover))
          .on_click(() => this.newSpaceOn(m))
          .child(svg(ICON(m ? "server" : "monitor")).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().truncate().child(m ?? "This computer"))))
      .when(list.length === 1, (el) => el.child(div().px(8).py(5).text_size(11.5).text_color(t.dim).child("No other machines connected (hc machine add)")));
  }

  // ---- a machine's dropdown: its spaces, the hovered one's agents beside ----------

  groupSpaces() {
    return spaces().filter((s) => s.machine === props()?.group);
  }

  pickSpace(s) {
    if (!s) return;
    closeOverlay(props()?.overlay);
    run("space.select", { id: s.id });
  }

  renderGroup() {
    const t = theme();
    const list = this.groupSpaces();
    const agents = allAgents();
    const ranked = (s) => agents.filter((a) => a.space === s.id).sort((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0));
    if (this.hover == null) this.hover = Math.max(0, list.findIndex((s) => s.active));
    if (this.hover >= list.length) this.hover = Math.max(0, list.length - 1);
    this.side ??= false;  // keyboard in the agents list
    const hovered = list[this.hover];
    const mine = hovered ? ranked(hovered) : [];
    if (this.at >= mine.length) this.at = Math.max(0, mine.length - 1);
    const panel = (el) => own(el).p(5).bg(t.popover).border_1().border_color(t.border).rounded(9).text_size(12.8);
    const row = (el, on) => el.h(ROW).px(8).gap(8).rounded(7).items_center().text_color(t.foreground)
      .when(on, (x) => x.bg(t.selected)).hover((x) => x.bg(t.hover));
    return h_flex()
      .id("sb-group")
      .track_focus(this.handle)
      .size_full()
      .items_start()
      // The empty part of this popup is see-through: a click there closes it.
      .on_mouse_down("left", () => closeOverlay(props().overlay))
      .on_key_down((e, cx) => {
        const n = this.side ? mine.length : list.length;
        if (e.key === "down" && n) { if (this.side) this.at = (this.at + 1) % n; else { this.hover = (this.hover + 1) % n; this.at = 0; } }
        else if (e.key === "up" && n) { if (this.side) this.at = (this.at - 1 + n) % n; else { this.hover = (this.hover - 1 + n) % n; this.at = 0; } }
        else if (e.key === "right" && mine.length) this.side = true;
        else if (e.key === "left") this.side = false;
        else if (e.key === "enter") { if (this.side) this.choose(mine[this.at]); else this.pickSpace(hovered); }
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .child(panel(v_flex())
        .id("sb-group-spaces")
        .w(SPACES_W)
        .flex_none()
        .child(h_flex().px(8).h(HEAD).gap(6).items_center().text_size(11.5).text_color(t.dim)
          .child(svg(ICON("server")).size(11).flex_none())
          .child(div().truncate().child(props().group)))
        .children(list.map((s, k) => {
          const a = ranked(s);
          const state = worst(a) ?? s.status;
          return row(h_flex().id(`sb-gs-${k}`), k === this.hover && !this.side)
            .on_hover((h, cx) => { if (h && this.hover !== k) { this.hover = k; this.at = 0; this.side = false; cx.notify(); } })
            .on_click(() => this.pickSpace(s))
            .child(div().w(14).flex_none().when(Boolean(glyph(t, state)), (x) => x.child(glyph(t, state))))
            .child(div().flex_1().truncate().when(s.active, (x) => x.text_color(t.accent)).child(s.name))
            .when(a.length > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`${a.length} agent${a.length > 1 ? "s" : ""}`)))
            .child(div().flex_none().text_size(10).text_color(a.length ? t.dim : "#00000000").child("▸"));
        })))
      .when(mine.length > 0, (el) => el.child(panel(v_flex())
        .id("sb-group-agents")
        .w(AGENTS_W)
        .flex_none()
        .ml(4)
        // Level with the hovered space: both lists start with a header.
        .mt(this.hover * ROW)
        .child(h_flex().px(8).h(HEAD).items_center().text_size(11.5).text_color(t.dim).truncate().child(`Agents in ${hovered.name}`))
        .children(mine.map((a, k) =>
          row(h_flex().id(`sb-ga-${k}`), this.side && k === this.at)
            .on_click(() => this.choose(a))
            .child(glyph(t, a.status))
            .when(Boolean(programIcon(a, t.foreground)), (x) => x.child(programIcon(a, t.foreground)))
            .child(div().flex_none().max_w(150).truncate().child(a.title ?? a.address))
            .child(div().flex_1().truncate().text_color(t.dim).child(`${a.tab_name ?? ""}${a.nested ? " · nested" : a.chat ? " · chat" : ""}`))))));
  }

  render() {
    if (props()?.group) return this.renderGroup();
    if (props()?.machines) return this.renderMachines();
    return props()?.picker ? this.renderPicker() : this.renderBar();
  }
}
