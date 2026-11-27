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
import { stripEntries, stepEntry } from "./lib/chat-stack.js";

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

// Chats whose header this mod draws in the pane's row (ushi-naruse publishes what it
// says, "ushi-naruse.heads"; the panes drawn so go to "nested-tabs.folded" and those
// chats leave out their own title row). Filled while drawing, shared by every copy.
const folded = new Set();
const NARUSE_ICON = (name) => `mods/ushi-naruse/icons/${name}.svg`;

function publishFolded() {
  const live = new Set(panes().map((p) => p.pane));
  const list = [...folded].filter((p) => live.has(p)).sort();
  const was = shared("nested-tabs.folded");
  if (JSON.stringify(list) !== JSON.stringify(Array.isArray(was) ? was : [])) setShared("nested-tabs.folded", list);
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
    cx.timer.every(250, () => { publishFolded(); S.expireChatSide(); });
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
    // A chat standing for a stack (spec 021): its keys step and add in that stack.
    const behind = pane && !base && f?.pane === pane ? Chat.stackOfChat(pane) : null;
    if (behind && ["next", "prev", "add"].includes(c)) {
      if (lastCommand.name === c && now - lastCommand.at < 120) return;
      lastCommand = { name: c, at: now };
      if (c === "add") S.add(behind.pane, behind.base);
      else this.step(behind.pane, behind.base, { chatPane: pane }, "chat", c === "next" ? 1 : -1);
      return;
    }
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
      // The pane's own agent hides behind its chat, nested tabs and all (spec 021 D1);
      // an agent in a nested tab gets its chat beside the pane (L2).
      else if (Chat.agentOf(term) && await Chat.check(shown)) await Chat.openExisting(pane, shown, shown === base);
    }
    else if (c === "close-pane") {
      const shown = S.shownOf(pane, base), term = terminals().find((t) => t.address === shown);
      if (Chat.chatOf(term)) Chat.hideBehindChat(shown); else Chat.closePane(pane, cx);
    }
    else if ((c === "next" || c === "prev") && Chat.pairOfStack(base)) this.step(pane, base, Chat.pairOfStack(base), "term", c === "next" ? 1 : -1);
    else if (c === "next") S.cycle(pane, base, 1);
    else if (c === "prev") S.cycle(pane, base, -1);
    else if (c === "close") {
      const shown = S.shownOf(pane, base);
      if (shown === base && S.members(pane, base).length > 1)
        notify({ title: "That's the pane's first tab", body: "Closing it closes the pane and all its tabs: use its menu or × for that.", level: "warning" });
      else S.close(pane, base, shown);
    }
  }

  // Next or previous across a chat and its stack (spec 021 D3); `side` is the one shown.
  step(pane, base, pair, side, dir) {
    const e = stepEntry(stripEntries(S.members(pane, base), side, S.shownOf(pane, base)), dir);
    if (!e) return;
    if (e.kind === "chat") Chat.toChat(pair.chatTab ?? Chat.pairOfStack(base)?.chatTab, pair.chatPane);
    else S.select(pane, base, e.address);
  }

  // Make the pane show what the shared state says.
  reconcile(pane, base) {
    const want = S.shownOf(pane, base);
    // What the focused pane really shows: a tab shown again (a chat's partner tab, spec
    // 021) shows its pane's own terminal, and a terminal.show sent with the tab.select
    // may land first. Applied again when it differs, at most every 300 ms.
    const f = focused();
    if (f?.pane === pane && (f.shown ?? base) !== want && Date.now() - (this.appliedAt ?? 0) > 300) this.applied = null;
    if (this.applied === want) return;
    this.appliedAt = Date.now();
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
      .when(Boolean(icon), (el) => el.child(svg(ICON(icon)).size(15)));
  }

  paneButtons(me, pane, base) {
    // Open as chat (spec 008 R8): the shown terminal runs Claude Code or Codex.
    const shown = base ? S.shownOf(pane, base) : null;
    const term = shown ? terminals().find((t) => t.address === shown) : null;
    const agent = Chat.agentOf(term);
    const chat = Boolean(agent) && Chat.canOpen(shown);
    // Behind a chat (spec 021): the cow and the × go back to the chat; the × never
    // closes this pane, which would end the chat's agent.
    const pair = base ? Chat.pairOfStack(base) : null;
    if (pair) {
      return h_flex().flex_none().gap(1).items_center()
        .child(this.button(`nt-chat-${pane}`, "cow", "Back to the chat", () => Chat.toChat(pair.chatTab, pair.chatPane)))
        .child(this.button(`nt-add-${pane}`, "plus", "New nested tab (right-click: start an agent)",
          () => S.add(pane, base), () => this.menu("new", pane, base)))
        .child(this.button(`nt-r-${pane}`, "split-right", "Split right", () => run("pane.split", { direction: "right", pane })))
        .child(this.button(`nt-d-${pane}`, "split-down", "Split down", () => run("pane.split", { direction: "down", pane })))
        .child(this.button(`nt-z-${pane}`, me.zoomed ? "unzoom" : "zoom", me.zoomed ? "Unzoom" : "Zoom", () => run("pane.zoom", { pane })))
        .child(this.button(`nt-x-${pane}`, "close", "Back to the chat (the chat keeps the session)", () => Chat.toChat(pair.chatTab, pair.chatPane)));
    }
    return h_flex()
      .flex_none()
      .gap(1)
      .items_center()
      // The pane's own terminal hides behind the chat with its nested tabs (spec 021 D1);
      // an agent in a nested tab gets its chat beside the pane (L2).
      // One a chat already shows (after the chat's Show terminal): back behind that chat,
      // not a second chat beside it.
      .when(chat, (el) => el.child(Chat.chatOf(term)
        ? this.button(`nt-chat-${pane}`, "cow", "Back to the chat (hides this terminal behind it)", () => Chat.hideBehindChat(shown))
        : this.button(`nt-chat-${pane}`, "cow", "Open as chat (the terminal hides; the chat's Show terminal brings it back)",
          () => Chat.openExisting(pane, shown, shown === base))))
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
    const head = me.mod === "ushi-naruse" ? shared("ushi-naruse.heads")?.[pane] : null;
    if (head) folded.add(pane); else folded.delete(pane);
    if (head) return this.chatHead(me, pane, head);
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

  // A chat's pane: the chat's own header (agent, conversation, its tools) in this row,
  // so the pane has one header, not two. Its buttons focus the chat and run its commands.
  chatHead(me, pane, head) {
    const t = theme();
    // Standing for a stack in its hidden tab (spec 021): the strip of chat and terminals.
    const behind = Chat.stackOfChat(pane);
    const list = behind ? S.members(behind.pane, behind.base) : [];
    const ctx = behind ? { t, pane: behind.pane, base: behind.base, shown: null, count: list.length, pair: true } : null;
    const chat = (c) => () => { run("pane.focus", { pane }); run(`ushi-naruse.${c}`); };
    const tool = (id, icon, tip, on, action) => this.button(`nt-${id}-${pane}`, null, tip, action)
      .when(on, (el) => el.bg(t.hover).text_color(t.foreground))
      .child(svg(NARUSE_ICON(icon)).size(15));
    const text = (id, label, tip, action, color) => div().id(`nt-${id}-${pane}`).flex_none().px(5).py(2).rounded(5).cursor_pointer()
      .text_color(color ?? t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(); }).child(label);
    return h_flex()
      .id(`nt-head-${pane}`)
      .size_full()
      .pl(12)
      .pr(8)
      .gap(8)
      .items_center()
      .text_size(13)
      .on_click(() => run("pane.focus", { pane }))
      .when(!behind, (el) => el
        .child(svg(ICON("cow")).size(15).flex_none().text_color(t.foreground))
        .child(div().flex_none().font_semibold().text_color(me.focused ? t.foreground : t.muted).child(head.agent))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(head.sub)))
      .when(Boolean(behind), (el) => el
        .on_window_mouse_up("left", this.dropIn(behind.pane, behind.base))
        .child(h_flex().id(`nt-strip-${pane}`).flex_1().min_w(0).h_full().gap(3).items_center().overflow_x_scroll()
          .child(this.chatChip(`nt-chatchip-${pane}`, true, head, () => run("pane.focus", { pane })))
          .children(list.map((m, i) => this.chip(m, i, ctx))))
        .child(this.button(`nt-add-${pane}`, "plus", "New nested tab (right-click: start an agent)",
          () => S.add(behind.pane, behind.base), () => this.menu("new", behind.pane, behind.base))))
      .child(h_flex().flex_none().gap(1).items_center()
        .child(tool("search", "search", "Search the chat", head.searching, chat("search")))
        .child(text("font-down", "A−", "Smaller text in chats", chat("font-smaller")))
        .child(text("font-size", String(head.font),
          head.fontSet ? `Chat text ${head.font} px (terminals ${head.termFont}): click to match them` : `Chat text matches the terminals (${head.termFont} px)`,
          chat("font-reset"), head.fontSet ? t.foreground : t.dim))
        .child(text("font-up", "A+", "Larger text in chats", chat("font-bigger")))
        .child(tool("term", "terminal-side", head.termOn ? "Hide the agent's terminal (the chat keeps the session)" : "Show the agent's terminal",
          head.termOn, chat("terminal")))
        .child(tool("back", "terminal-window", "Close this chat and continue in the terminal (the session keeps running)", false, chat("back"))))
      .child(div().flex_none().w(1).h(16).bg(t.border))
      .child(this.paneButtons(me, pane, null));
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
      .h(24)
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
      // Behind a chat (spec 021) the agent's own has none: closing it ends the chat's agent.
      .when(!(m.base && ctx.pair), (el) => el.child(
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
      ));
  }

  // The chat's entry in a strip (spec 021): first, no number or ×, cow and the agent.
  chatChip(id, active, head, onClick) {
    const t = theme();
    return h_flex()
      .id(id)
      .flex_none()
      .max_w(240)
      .h(24)
      .px(8)
      .gap(6)
      .items_center()
      .rounded(8)
      .border_1()
      .cursor_pointer()
      .text_size(13)
      .when(active, (el) => el.bg(t.raised).border_color(t.border).text_color(t.foreground))
      .when(!active, (el) => el.border_color("#00000000").text_color(t.muted).hover((s) => s.bg(t.hover)))
      .tooltip(`Chat${head?.sub ? " · " + head.sub : ""}`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(); })
      .child(svg(ICON("cow")).size(15).flex_none())
      .child(div().flex_none().max_w(150).truncate().child(head?.agent ? `${head.agent} chat` : "Chat"));
  }

  // A drop at the end of a drag in a strip: the window's mouse-up comes before the
  // chip's own (seen in the tab bar), so the move is made here, onto the chip last hovered.
  dropIn(pane, base) {
    return (_e, cx) => {
      const from = this.drag, onto = this.over;
      if (!from) return;
      this.drag = null;
      this.over = null;
      if (onto && onto !== from) S.reorder(pane, base, from, onto);
      cx.notify();
    };
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
    const pair = Chat.pairOfStack(base);
    if (list.length < 2 && !pair) return sized(this.single(me, pane, base));
    const t = theme();
    const ctx = { t, pane, base, shown: S.shownOf(pane, base), count: list.length, pair: Boolean(pair) };
    const head = pair ? shared("ushi-naruse.heads")?.[pair.chatPane] : null;
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
      .on_window_mouse_up("left", this.dropIn(pane, base))
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
          .when(Boolean(pair), (el) => el.child(this.chatChip(`nt-chatchip-${pane}`, false, head, () => Chat.toChat(pair.chatTab, pair.chatPane))))
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
