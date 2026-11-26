// Nested tabs (pane stacks) for the Herdr app.
//
// Used three ways, told apart by props:
//   - pane header ({ pane, terminal } from the layout): the strip of tabs
//   - popup menu  ({ menu: "tab" | "new", pane, base, target? })
//   - rename dialog ({ rename: true, target, value })
//
// Mouse: click a tab to show it, double-click to rename, middle-click to
// close, right-click for its menu, wheel over the strip to cycle, drag a tab
// onto another to reorder. "+" adds a shell; right-click "+" to start an agent.
// Keys (keys.json): nested-tabs.add / .next / .prev / .close.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { panes, terminals, spaces, props, run, home, theme, focused, nextCommand, openOverlay, closeOverlay, knownAgents, checking, notify, setShared, shared } from "herdr";
import * as S from "./stack.js";
import * as Panel from "./panel.js";
import * as Chat from "./chat.js";

// Each pane header's size (≈ its pane's width), for sizing the panel split.
const sizes = new Map();

const ICON = (name) => `mods/nested-tabs/${name}.svg`;

function short(cwd) {
  if (!cwd) return "";
  const h = home();
  if (cwd === h) return "~";
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// Several copies get each key command; only the first within a moment acts.
let lastCommand = { name: "", at: 0 };

export default class NestedTabs extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.menu) return this.initMenu(cx);
    if (p.rename) return this.initRename(cx);
    this.applied = undefined;
    this.drag = null;
    this.over = null;
    this.wheel = 0;
    // The strip scrolls when its tabs don't fit (#9); the shown one is revealed.
    this.scroll = ScrollHandle.new();
    this.revealed = null;
    // Requests older than this copy were for a copy that no longer exists.
    this.seenRequest = Date.now();
    if (checking()) return;
    S.prune();
    // Agents whose chat pane was closed end (spec 008); whether this pane's machine
    // can show a chat (for Open as chat).
    cx.timer.every(2000, () => { Chat.sweep(); });
    cx.spawn(async (cx) => { const b = this.base(); if (b && await Chat.check(b)) cx.notify(); });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        try { await this.command(c, cx); } catch (e) { notify({ title: `nested-tabs.${c} failed`, body: String(e), level: "error" }); }
        cx.notify();
      }
    });
  }

  // ---- pane header -------------------------------------------------------

  base() {
    const p = props() ?? {};
    return p.terminal ?? panes().find((x) => x.pane === p.pane)?.terminal ?? null;
  }

  async command(c, cx) {
    const pane = props()?.pane, base = this.base();
    const f = focused();
    const now = Date.now();
    // Focus in a layout terminal block (a dock): hand the key to dock-tabs.
    if (f && !f.pane && f.terminal) {
      if (lastCommand.name === c && now - lastCommand.at < 120) return;
      lastCommand = { name: c, at: now };
      setShared("dock-tabs.cmd", { c, at: now });
      return;
    }
    // Close this pane also works on a mod pane (a viewer), which has no terminal.
    if (c === "close-pane" && pane && !base && f?.pane === pane) { Chat.closePane(pane, cx); return; }
    if (!pane || !base || f?.pane !== pane) return;
    if (lastCommand.name === c && now - lastCommand.at < 120) return;
    lastCommand = { name: c, at: now };
    if (c === "panel") await Panel.toggle(cx, "right", sizes);
    else if (c === "panel-portrait") await Panel.toggle(cx, "portrait", sizes);
    else if (c === "add") S.add(pane, base);
    else if (c === "move-left" || c === "move-right") S.move(pane, base, S.shownOf(pane, base), c === "move-left" ? -1 : 1);
    // Chats (spec 008): a new chat (the first agent the + menu offers), Open as chat,
    // and the × (a chat's terminal hides behind it; anything else closes).
    else if (c === "chat") { const [e] = await Chat.options(base); if (e) await Chat.open(pane, base, e.run.join(" "), e.label.replace(/^New /, "")); }
    else if (c === "open-chat") {
      const shown = S.shownOf(pane, base), term = terminals().find((t) => t.address === shown);
      // A terminal a chat already shows (after its Show terminal) goes back behind it.
      if (Chat.chatOf(term)) Chat.hideBehindChat(shown);
      else if (Chat.agentOf(term) && await Chat.check(shown)) await Chat.openExisting(pane, shown, S.members(pane, base).length < 2);
    }
    else if (c === "close-pane") {
      const shown = S.shownOf(pane, base), term = terminals().find((t) => t.address === shown);
      if (Chat.chatOf(term)) Chat.hideBehindChat(shown); else Chat.closePane(pane, cx);
    }
    else if (c === "next") S.cycle(pane, base, 1);
    else if (c === "prev") S.cycle(pane, base, -1);
    else if (c === "close") {
      const shown = S.shownOf(pane, base);
      if (shown === base && S.members(pane, base).length > 1)
        notify({ title: "That's the pane's first tab", body: "Closing it closes the pane and all its tabs: use its menu or × for that.", level: "warning" });
      else S.close(pane, base, shown);
    }
  }

  // Make the pane show what the shared state says.
  reconcile(pane, base) {
    const want = S.shownOf(pane, base);
    if (this.applied === want) return;
    const first = this.applied === undefined;
    this.applied = want;
    if (first && want === base) return;
    run("terminal.show", want === base ? { pane } : { terminal: want, pane });
  }

  menu(kind, pane, base, target) {
    openOverlay({ mod: "nested-tabs", kind: "popup", width: 260, props: { menu: kind, pane, base, target } });
  }

  button(id, icon, tip, onClick, onRight) {
    const t = theme();
    return div()
      .id(id)
      .flex_none()
      .p(4)
      .rounded(5)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .when(Boolean(onRight), (el) => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); onRight(); }))
      .child(svg(ICON(icon)).size(15));
  }

  paneButtons(me, pane, base) {
    // Open as chat (spec 008 R8): the shown terminal runs Claude Code or Codex.
    const shown = base ? S.shownOf(pane, base) : null;
    const term = shown ? terminals().find((t) => t.address === shown) : null;
    const agent = Chat.agentOf(term);
    const chat = Boolean(agent) && Chat.canOpen(shown);
    return h_flex()
      .flex_none()
      .gap(1)
      .items_center()
      // The terminal is hidden behind the chat, unless the pane holds other nested tabs
      // (hiding takes its pane away, and theirs with it): then the chat opens beside it.
      // One a chat already shows (after the chat's Show terminal): back behind that chat,
      // not a second chat beside it.
      .when(chat, (el) => el.child(Chat.chatOf(term)
        ? this.button(`nt-chat-${pane}`, "cow", "Back to the chat (hides this terminal behind it)", () => Chat.hideBehindChat(shown))
        : this.button(`nt-chat-${pane}`, "cow", "Open as chat (the terminal hides; the chat's Show terminal brings it back)",
          () => Chat.openExisting(pane, shown, S.members(pane, base).length < 2))))
      .when(Boolean(base), (el) =>
        el.child(this.button(`nt-add-${pane}`, "plus", "New nested tab (right-click: start an agent)",
          () => S.add(pane, base), () => this.menu("new", pane, base))))
      .child(this.button(`nt-r-${pane}`, "split-right", "Split right", () => run("pane.split", { direction: "right", pane })))
      .child(this.button(`nt-d-${pane}`, "split-down", "Split down", () => run("pane.split", { direction: "down", pane })))
      .child(this.button(`nt-z-${pane}`, me.zoomed ? "unzoom" : "zoom", me.zoomed ? "Unzoom" : "Zoom", () => run("pane.zoom", { pane })))
      // A terminal a chat shows is hidden, not closed: the chat keeps the session (spec 008).
      .child(Chat.chatOf(term)
        ? this.button(`nt-x-${pane}`, "close", "Hide (the chat keeps the session; its Show terminal brings it back)", () => Chat.hideBehindChat(shown))
        : this.button(`nt-x-${pane}`, "close", "Close pane (all its tabs)", (cx) => Chat.closePane(pane, cx)));
  }

  programIcon(g, color) {
    if (!g?.icon) return null;
    return g.tint ? svg(g.icon).size(15).flex_none().text_color(color) : image(g.icon).w(15).h(15).flex_none();
  }

  // One pane, one terminal: the plain header (title, folder) plus "+".
  single(me, pane, base) {
    const t = theme();
    const title = me.title || "shell";
    const where = folder(me.cwd);
    const dir = where && !title.includes(where) && !/^[~/]/.test(title) ? where : "";
    // A mod pane has no program; the chat (ushi-naruse, spec 008) shows its cow.
    const icon = me.mod === "ushi-naruse" ? svg(ICON("cow")).size(15).flex_none().text_color(t.foreground) : this.programIcon(me.program, t.foreground);
    return h_flex()
      .id(`nt-head-${pane}`)
      .size_full()
      .pl(12)
      .pr(8)
      .gap(8)
      .items_center()
      .text_size(14)
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(icon), (el) => el.child(icon))
      .child(div().flex_none().max_w(320).truncate().font_semibold().text_color(me.focused ? t.foreground : t.muted).child(title))
      .child(div().flex_1().truncate().text_color(t.dim).child(dir))
      .child(this.paneButtons(me, pane, base));
  }

  chip(m, index, ctx) {
    const { t, pane, base, shown, count } = ctx;
    const active = m.address === shown;
    const term = m.term;
    const name = S.label(m, null);
    const where = short(term?.cwd);
    const status = term?.status;
    const dot = status && status !== "idle" && t[status] ? t[status] : null;
    const icon = this.programIcon(term?.program, active ? t.foreground : t.muted);
    const target = this.drag && this.drag !== m.address && this.over === m.address;
    return h_flex()
      .id(`nt-chip-${pane}-${m.address}`)
      .flex_none()
      .max_w(240)
      .h(28)
      .pl(8)
      .pr(3)
      .gap(6)
      .items_center()
      .rounded(8)
      .border_1()
      .cursor_pointer()
      .text_size(13)
      .when(active, (el) => el.bg(t.raised).border_color(t.border).text_color(t.foreground))
      .when(!active, (el) => el.border_color("#00000000").text_color(t.muted).hover((s) => s.bg(t.hover)))
      .when(target, (el) => el.border_color(t.accent))
      .tooltip(`${name}${term?.cwd ? " · " + folder(term.cwd) : ""} · ${m.address}${m.base ? " (pane's own)" : ""}`)
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.drag = m.address; })
      .on_hover((hovered, cx) => {
        if (!this.drag) return;
        if (hovered) this.over = m.address;
        else if (this.over === m.address) this.over = null;
        cx.notify();
      })
      .on_click((e) => {
        if (e.click_count >= 2) this.rename(m);
        else S.select(pane, base, m.address);
      })
      .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); S.close(pane, base, m.address); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu("tab", pane, base, m.address); })
      .child(div().flex_none().text_size(11).text_color(t.dim).child(String(index + 1)))
      .when(Boolean(icon), (el) => el.child(icon))
      .child(div().flex_none().max_w(150).truncate().child(name))
      .when(Boolean(where) && where !== name, (el) => el.child(div().truncate().text_size(12).text_color(t.dim).child(where)))
      .when(Boolean(dot), (el) => el.child(div().flex_none().w(7).h(7).rounded_full().bg(dot)))
      // Every tab has a close button (herdr-mods): the pane's own tab closes the pane.
      .child(
        div()
          .id(`nt-chip-x-${pane}-${m.address}`)
          .flex_none()
          .p(3)
          .rounded(5)
          .text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip(m.base ? "Close pane (all its tabs)" : "Close tab")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); S.close(pane, base, m.address); })
          .child(svg(ICON("x")).size(12)),
      );
  }

  rename(m) {
    openOverlay({ mod: "nested-tabs", kind: "dialog", width: 380, props: { rename: true, target: m.address, value: m.term?.labels?.[S.TITLE] ?? "" } });
  }

  onWheel(e, pane, base) {
    const lines = e.delta_lines;
    const d = lines ? (lines.y || lines.x) : (e.delta.y || e.delta.x) / 40;
    this.wheel += d;
    while (this.wheel >= 1) { S.cycle(pane, base, -1); this.wheel -= 1; }
    while (this.wheel <= -1) { S.cycle(pane, base, 1); this.wheel += 1; }
  }

  renderHeader() {
    const p = props() ?? {};
    const me = panes().find((x) => x.pane === p.pane);
    if (!me) return div();
    const pane = me.pane, base = this.base();
    const sized = (el) => el.on_size_change((size) => { sizes.set(pane, size); });
    if (!base) return sized(this.single(me, pane, null));
    // Another mod (the spaces bar's agent picker) asking to show a nested tab here.
    const req = shared("nested-tabs.request");
    if (req && req.pane === pane && req.at > (this.seenRequest ?? 0)) {
      this.seenRequest = req.at;
      if (S.members(pane, base).some((m) => m.address === req.terminal)) S.select(pane, base, req.terminal);
    }
    this.reconcile(pane, base);
    const list = S.members(pane, base);
    if (list.length < 2) return sized(this.single(me, pane, base));
    const t = theme();
    const ctx = { t, pane, base, shown: S.shownOf(pane, base), count: list.length };
    const at = list.findIndex((m) => m.address === ctx.shown);
    const key = `${ctx.shown}:${list.length}`;
    if (at >= 0 && key !== this.revealed) { this.revealed = key; this.scroll.scroll_to_item(at); }
    return sized(h_flex())
      .id(`nt-head-${pane}`)
      .size_full()
      .pl(5)
      .pr(8)
      .gap(6)
      .items_center()
      .on_click(() => run("pane.focus", { pane }))
      // The drop: the window's mouse-up comes before the chip's own (seen in the tab
      // bar), so the move is made here, onto the chip last hovered.
      .on_window_mouse_up("left", (_e, cx) => {
        const from = this.drag, onto = this.over;
        if (!from) return;
        this.drag = null;
        this.over = null;
        if (onto && onto !== from) S.reorder(pane, base, from, onto);
        cx.notify();
      })
      .child(
        h_flex()
          .id(`nt-strip-${pane}`)
          .flex_1()
          .min_w(0)
          .h_full()
          .gap(3)
          .items_center()
          .overflow_x_scroll()
          .track_scroll(this.scroll)
          .on_scroll_wheel((e) => this.onWheel(e, pane, base))
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu("new", pane, base); })
          .children(list.map((m, i) => this.chip(m, i, ctx))),
      )
      .child(this.paneButtons(me, pane, base));
  }

  // ---- popup menu --------------------------------------------------------

  initMenu(cx) {
    this.at = 0;
    this.agents = [];
    this.chats = [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    const where = props()?.on ?? "this computer";
    // What the agent entries are waiting on, or why there are none (a remote
    // machine's check can be slow, or fail): shown as a note in the menu.
    this.agentNote = `Looking for agents on ${where}…`;
    cx.spawn(async (cx) => {
      const { base, menu, on } = props() ?? {};
      try {
        // The tab bar's + (menu "top") asks for its space's machine.
        this.agents = (await (menu === "top" ? Chat.agentsOn(on ?? null) : knownAgents())).filter((a) => a.installed && a.run?.length).slice(0, 4);
        this.agentNote = this.agents.length ? null : `No agents found on ${where}`;
      } catch (e) {
        this.agents = [];
        this.agentNote = `Couldn't list agents on ${where}: ${String(e?.message ?? e).split("\n")[0].slice(0, 120)}`;
      }
      cx.notify();
      this.chats = menu === "top" ? await Chat.optionsOn(on ?? null) : base ? await Chat.options(base) : [];
      cx.notify();
    });
  }

  menuItems() {
    const { menu, pane, base, target } = props() ?? {};
    if (menu === "top") return this.topItems();
    const newItems = [
      { label: "New tab", icon: "terminal", act: () => S.add(pane, base) },
      ...this.agents.map((a) => ({ label: `New ${a.name} tab`, icon: "terminal", act: () => S.add(pane, base, a.run.join(" ")) })),
      ...this.chats.map((c) => ({ label: c.label, icon: "layers", act: () => Chat.open(pane, base, c.run.join(" "), c.label.replace(/^New /, "")) })),
    ];
    if (menu !== "tab") return newItems;
    const list = S.members(pane, base);
    const i = list.findIndex((m) => m.address === target);
    const m = list[i];
    if (!m) return newItems;
    const items = [];
    if (S.shownOf(pane, base) !== target) items.push({ label: "Show", icon: "layers", act: () => S.select(pane, base, target) });
    items.push({ label: "Rename…", icon: "square-pen", act: () => this.rename(m) });
    items.push({ sep: true }, ...newItems, { sep: true });
    if (i > 0) items.push({ label: "Move left", icon: "chevron-left", act: () => S.move(pane, base, target, -1) });
    if (i < list.length - 1) items.push({ label: "Move right", icon: "chevron-right", act: () => S.move(pane, base, target, 1) });
    if (!m.base) {
      items.push({ label: "Move to own pane (right)", icon: "split-right", act: () => S.popOut(pane, base, target, "right") });
      items.push({ label: "Move to own pane (below)", icon: "split-down", act: () => S.popOut(pane, base, target, "down") });
    }
    items.push({ sep: true });
    if (list.length > 1) items.push({ label: "Close other tabs", icon: "x", act: () => S.closeOthers(pane, base, target) });
    items.push(m.base
      ? { label: "Close pane (all tabs)", icon: "close", act: () => run("pane.close", { pane }) }
      : { label: "Close tab", icon: "x", act: () => S.close(pane, base, target) });
    return items.filter((it, k, all) => !(it.sep && (k === 0 || k === all.length - 1 || all[k - 1]?.sep)));
  }

  // The tab bar's + (right-click): a new top-level tab in the shown space, as a shell,
  // an agent, or a chat (spec 008). A chat starts in the focused terminal's folder there.
  topItems() {
    const { space, on, folder } = props() ?? {};
    // The folder the tab bar read when + was clicked (this popup has the focus now).
    const f = focused();
    const cwd = folder || (f?.space === space && panes().find((p) => p.pane === f.pane)?.cwd) || spaces().find((s) => s.id === space)?.folder || null;
    return [
      { label: "New tab", icon: "terminal", act: () => run("tab.new", { space, ...(cwd ? { folder: cwd } : {}) }) },
      ...this.agents.map((a) => ({ label: `New ${a.name} tab`, icon: "terminal", act: () => run("tab.new", { space, argv: a.run, ...(cwd ? { folder: cwd } : {}) }) })),
      ...this.chats.map((c) => ({ label: c.label, icon: "layers", act: () => Chat.openIn(space, on ?? null, cwd, c.run.join(" "), c.label.replace(/^New /, "")) })),
      ...(this.agentNote ? [{ note: this.agentNote }] : []),
    ];
  }

  // Run the entry, then close: closing the popup cancels its pending calls,
  // so an async action (hc run, hc send) must finish first.
  choose(it, cx) {
    if (!it || it.sep || it.note || this.busy) return;
    this.busy = true;
    const overlay = props()?.overlay;
    cx.spawn(async () => {
      try { await it.act(); }
      finally { closeOverlay(overlay); }
    });
  }

  renderMenu() {
    const t = theme();
    const items = this.menuItems();
    const real = items.map((it, k) => (it.sep || it.note ? -1 : k)).filter((k) => k >= 0);
    if (!real.includes(this.at)) this.at = real[0] ?? 0;
    return v_flex()
      .id("nt-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        const pos = real.indexOf(this.at);
        if (e.key === "down") this.at = real[(pos + 1) % real.length];
        else if (e.key === "up") this.at = real[(pos - 1 + real.length) % real.length];
        else if (e.key === "enter") this.choose(items[this.at], cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        items.map((it, k) =>
          it.note
            ? div().px(8).py(5).text_size(11.5).text_color(t.dim).child(it.note)
          : it.sep
            ? div().mx(7).my(4).h(1).bg(t.border)
            : h_flex()
                .id(`nt-mi-${k}`)
                .h(31)
                .px(8)
                .gap(9)
                .rounded(7)
                .items_center()
                .text_color(t.foreground)
                .when(k === this.at, (el) => el.bg(t.selected))
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => this.choose(it, cx))
                .child(svg(ICON(it.icon)).size(14).flex_none().text_color(t.muted))
                .child(div().flex_1().truncate().child(it.label)),
        ),
      );
  }

  // ---- rename dialog -----------------------------------------------------

  initRename(cx) {
    const value = props()?.value ?? "";
    this.input = InputState.new({ value });
    if (value) this.input.set_selected_range({ start: 0, end: value.length });
    this.input.on("submit", () => this.submitRename());
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  submitRename() {
    const p = props();
    closeOverlay(p.overlay);
    S.rename(p.target, this.input.value());
  }

  renderRename() {
    const t = theme();
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex()
      .id("nt-rename")
      .track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .w_full()
      .min_h(0)
      .p(18)
      .gap(12)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(div().text_size(14).font_semibold().child("Rename nested tab"))
      .child(div().text_size(11.5).text_color(t.dim).child("Empty: back to the program's own title."))
      .child(Input.new(this.input).h(34).px(10).rounded(8).border_1().border_color(t.input).bg(t.background))
      .child(
        h_flex()
          .gap(8)
          .justify_end()
          .child(button("nt-rn-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
          .child(button("nt-rn-ok", "Rename", true, () => this.submitRename())),
      );
  }

  render() {
    const p = props() ?? {};
    if (p.menu) return this.renderMenu();
    if (p.rename) return this.renderRename();
    return this.renderHeader();
  }
}
