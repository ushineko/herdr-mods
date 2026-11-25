// Terminal right-click menu for the terminals-dock layout ("terminal_menu").
//
// The shipped menu ("menu") only knows tab panes: for a terminal in a layout
// block (the docks' yazi/lazygit/shells, the usage strip) it drops every pane
// item and showed an almost empty popup. This mod:
//   - a terminal in a tab pane: hands over to the shipped menu, sized to it;
//   - a dock terminal: restart its yazi/lazygit, new / rename / close dock
//     tab, hide the dock, and where its right-clicks go;
//   - any other block terminal (the usage strip): where its right-clicks go.
// The app opens this at a fixed size, so the first copy reopens itself at
// the pointer, sized to its items ({ sized: true }), and closes.
//
// Props (from the app): { tab: "pane", target: { pane, terminal }, overlay }.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { panes, terminals, run, theme, props, openOverlay, closeOverlay, hc, checking, keys, window as win } from "herdr";

// Close an overlay by id; a no-op without one (herdr-app check has none).
const close = (id) => { if (id) closeOverlay(id); };

const ICON = (n) => `mods/workspace-chrome/${n}.svg`;
const ROW = 31, SEP = 9, PAD = 10, WIDTH = 290;
const DOCKS = ["dock-right", "dock-bottom"];
const TITLE = "nt.title";

const dockOf = (pane) => DOCKS.find((d) => pane?.startsWith(`${d}-`) && pane !== `${d}-tabs` && pane !== `${d}-stack`) ?? null;
const baseOf = (name) => (name && name.includes("/") ? name.slice(name.indexOf("/") + 1) : name ?? "");
const toolOf = (name) => (/^dock-yazi(-|$)/.test(baseOf(name)) ? "yazi" : /^dock-lazygit(-|$)/.test(baseOf(name)) ? "lazygit" : null);

function rightClickItem(term) {
  if (!term) return [];
  return term.labels?.["herdr.right-click"] === "program"
    ? [{ label: "Use Herdr right-click menu", icon: "terminal", run: ["terminal.right_click", { terminal: term.address, to: "menu" }] }]
    : [{ label: "Send right-clicks to the program", icon: "terminal", run: ["terminal.right_click", { terminal: term.address, to: "program" }] }];
}

// [{ label, icon, run: [command, args] | act: async fn } | { sep: true }]
function items(p) {
  const tg = p?.target ?? {};
  const term = terminals().find((t) => t.address === tg.terminal);
  const dock = dockOf(tg.pane);
  if (!dock) return rightClickItem(term);
  const tool = toolOf(term?.name);
  const out = [];
  if (tool) out.push({
    label: `Restart ${tool}`, icon: "spinner",
    // Quit it; its restart loop starts it again. A pause after the escapes:
    // an esc right before a key reads as Alt+key.
    act: async (cx) => { await hc(["keys", term.address, "esc", "esc"]); await cx.sleep(150); await hc(["keys", term.address, "q"]); },
  });
  out.push({ label: "New dock tab", icon: "plus", run: ["dock-tabs.add", {}] });
  if (term) out.push({
    label: "Rename dock tab…", icon: "square-pen",
    act: () => openOverlay({ mod: "dock-tabs", kind: "dialog", width: 380, props: { rename: true, target: term.address, value: term.labels?.[TITLE] ?? "" } }),
  });
  out.push({ sep: true }, ...rightClickItem(term), { sep: true });
  const shows = keyFor(`layout.toggle:${dock}`);
  out.push({ label: shows ? `Hide the dock (${shows} to show)` : "Hide the dock", icon: dock === "dock-right" ? "panel-right" : "panel-bottom", run: ["layout.hide", { id: dock }] });
  out.push({ label: "Close dock tab", icon: "x", run: ["dock-tabs.close", {}] });
  return out.filter((it, k, all) => !(it.sep && (k === 0 || k === all.length - 1 || all[k - 1]?.sep)));
}

// The key bound to an action, as this platform writes it ("⌘⇧Y" on macOS,
// "Ctrl+Shift+Y" elsewhere), or null.
function keyFor(action) {
  // `action` as keys.json writes it ("layout.toggle:dock-right"); keys() may
  // give it whole or as an action with an id argument.
  const [cmd, arg] = action.split(":");
  const k = (keys() ?? []).find((b) => b.action === action || (b.action === cmd && (b.args?.id ?? b.args) === arg))?.keys;
  if (!k) return null;
  const parts = k.split("-");
  if (win()?.platform === "macos") {
    const MAC = { cmd: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃" };
    return parts.map((x) => MAC[x] ?? x.toUpperCase()).join("");
  }
  const NAME = { ctrl: "Ctrl", shift: "Shift", alt: "Alt", cmd: "Super" };
  return parts.map((x) => NAME[x] ?? x.toUpperCase()).join("+");
}

const heightOf = (list) => PAD + list.reduce((h, it) => h + (it.sep ? SEP : ROW), 0);

// The shipped menu's item count for a tab pane (its rows and one separator
// before "Close pane"), to open it at its size.
function shippedHeight(tg) {
  const all = terminals();
  const term = all.find((t) => t.address === tg.terminal);
  const parent = term?.parent && all.find((t) => t.address === term.parent);
  const n = 4 + (term ? 1 : 0) + (parent ? 1 : 0) + 1;
  return PAD + n * ROW + SEP;
}

export default class TermMenu extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.at = 0;
    this.handle = cx.focus_handle();
    if (p.sized) { this.handle.focus(); return; }
    if (checking()) return;
    // First copy: open the real one at the pointer, at its size, and go.
    const tg = p.target ?? {};
    const inTab = panes().some((x) => x.pane === tg.pane);
    if (inTab) openOverlay({ mod: "menu", kind: "popup", width: 220, height: shippedHeight(tg), props: { tab: "pane", target: tg } });
    else openOverlay({ mod: "term-menu", kind: "popup", width: WIDTH, height: heightOf(items(p)), props: { tab: "pane", target: tg, sized: true } });
    close(p.overlay);
  }

  choose(it, cx) {
    if (!it || it.sep) return;
    const overlay = props()?.overlay;
    if (it.run) { close(overlay); run(it.run[0], it.run[1]); return; }
    cx.spawn(async (cx) => { try { await it.act(cx); } finally { close(overlay); } });
  }

  render(cx) {
    const p = props() ?? {};
    if (!p.sized) return div();
    const t = theme();
    const list = items(p);
    const real = list.map((it, k) => (it.sep ? -1 : k)).filter((k) => k >= 0);
    if (!real.includes(this.at)) this.at = real[0] ?? 0;
    return v_flex()
      .id("term-menu")
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
        else if (e.key === "enter") this.choose(list[this.at], cx);
        else if (e.key === "escape") close(p.overlay);
        else return;
        cx.notify();
      })
      .children(list.map((it, k) => it.sep
        ? div().mx(7).my(4).h(1).bg(t.border)
        : h_flex().id(`tm-${k}`).h(ROW).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
            .when(k === this.at, (el) => el.bg(t.selected)).hover((x) => x.bg(t.hover))
            .on_click((_e, cx) => this.choose(it, cx))
            .child(svg(ICON(it.icon)).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().truncate().child(it.label))));
  }
}
