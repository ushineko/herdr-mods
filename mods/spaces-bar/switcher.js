// The Ctrl+Tab switcher (spec 015), Vivaldi-style: the tabs in the order they were
// last shown, this window's (every machine) and the other windows' on this computer.
// Hold Ctrl: Tab opens it with the previous tab selected, Tab / Shift+Tab move,
// releasing Ctrl switches; Esc cancels; a click switches.
//
// The bar copy records the shown tab (recordShown) and takes the key commands
// (switcher.command); the dialog is another copy of this mod (props.switcher). They
// share this module's SW, so a second Ctrl+Tab steps the open dialog.
import { svg, image, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, terminals, run, theme, props, closeOverlay, shared, setShared, window as win } from "herdr";
import { tabEntry, recordTab, liveOrder, switcherList } from "./lib/tab-order.js";
import { machineColor } from "./lib/machine-color.js";
import { OTHERS, showInWindow } from "./others.js";
import { openDialog, openKind, dialogClosed } from "./dialogs.js";

// This window's order, in its app home's shared state; the other windows' is read
// from their homes' shared.json.
export const ORDER_KEY = "spaces-bar.tab-order";

// The open dialog: its rows, the selected one, and when it last drew (an Esc the
// app handles closes it without telling us: one not seen for a second is gone).
const SW = { open: false, alive: 0, rows: [], sel: 0 };
const isOpen = () => SW.open && Date.now() - SW.alive < 1000;
const tick = () => setShared("spaces-bar.switcher.tick", Date.now());

// This window's tabs now (settled ones left out), in space and tab order.
function entries() {
  const ps = panes(), ts = terminals();
  return spaces().flatMap((s) => s.tabs.filter((t) => !t.settled).map((t) => tabEntry(t, s, ps, ts)));
}

/**
 * Records the shown tab at the front of this window's order when it changed, and
 * stamps it again when this window gets the focus: across windows (njv-cachyos's
 * default and work), going back to a window counts as using its tab, so the merged
 * order follows what was used, not only what was switched to.
 */
let wasActive = false;
export function recordShown() {
  const s = spaces().find((x) => x.active);
  const t = s?.tabs.find((x) => x.active);
  const active = win()?.active !== false;
  const focused = active && !wasActive;
  wasActive = active;
  if (!t) return;
  const order = shared(ORDER_KEY) ?? [];
  if (order[0]?.key === t.id && !focused) return;
  setShared(ORDER_KEY, recordTab(order, tabEntry(t, s, panes(), terminals()), Date.now()));
}

/** A key command (from the bar copy): opens the dialog, or steps the open one. */
export function command(c) {
  const d = c === "switch-back" ? -1 : 1;
  if (isOpen() && openKind() === "switch") { step(d); return; }
  openDialog("switch", { mod: "spaces-bar", kind: "dialog", width: 640, props: { switcher: true, back: d < 0 } }, () => { SW.open = false; });
}

function step(d) {
  if (!SW.rows.length) return;
  SW.sel = (SW.sel + d + SW.rows.length) % SW.rows.length;
  tick();
}


/** The dialog copy's start: its rows (this window's and the others'), the selection. */
export function initDialog(view, cx) {
  view.handle = cx.focus_handle();
  view.handle.focus();
  SW.open = true;
  SW.alive = Date.now();
  // The other windows' orders, as the bar last read them (others.js).
  const others = OTHERS.list.map((o) => ({ window: o.window, order: Array.isArray(o.data?.[ORDER_KEY]) ? o.data[ORDER_KEY] : [] }));
  SW.rows = switcherList(liveOrder(shared(ORDER_KEY) ?? [], entries()), others);
  // The most recent other tab (any window's), or the oldest for Ctrl+Shift+Tab.
  SW.sel = props()?.back ? Math.max(0, SW.rows.length - 1) : Math.min(1, SW.rows.length - 1);
  cx.timer.every(250, () => { if (SW.open) SW.alive = Date.now(); });
}

// Switches to a row: this window's tab here; another window's there, raised.
function pick(r) {
  SW.open = false;
  dialogClosed("switch");
  closeOverlay(props()?.overlay);
  if (!r) return;
  if (r.window) return showInWindow(r.window, [["space.select", { id: r.space }], ["tab.select", { id: r.tab }]]);
  run("space.select", { id: r.space });
  run("tab.select", { id: r.tab });
  // A chat landed on takes the keyboard back from this closing dialog (ushi-naruse).
  setShared("ushi-naruse.focus-request", Date.now());
}

function cancel() {
  SW.open = false;
  dialogClosed("switch");
  closeOverlay(props()?.overlay);
}

/** The dialog. */
export function renderDialog(view) {
  const t = theme();
  SW.alive = Date.now();
  const rows = SW.rows;
  const known = spaces().map((s) => s.machine);
  const tag = (text, color, bg) => div().flex_none().max_w(170).truncate().px(6).rounded(5).bg(bg).text_color(color).text_size(11).child(text);
  const icon = (p) => (!p?.icon ? div().w(15).flex_none() : p.tint ? svg(p.icon).size(15).flex_none().text_color(t.foreground) : image(p.icon).w(15).h(15).flex_none());
  return v_flex()
    .id("sb-switcher")
    .track_focus(view.handle)
    .w_full()
    .p(6)
    .gap(1)
    .bg(t.popover)
    .text_size(13)
    // Releasing Ctrl switches (the Vivaldi way); so does Tab coming up without it
    // (a quick tap can release Ctrl before this dialog has the keyboard).
    .on_modifiers_changed((e) => { if (!e.modifiers.control) pick(rows[SW.sel]); })
    .on_key_up((e) => { if (e.key === "tab" && !e.modifiers.control) pick(rows[SW.sel]); })
    .on_key_down((e, cx) => {
      if (e.key === "escape") return cancel();
      if (e.key === "enter") return pick(rows[SW.sel]);
      if (e.key === "down") step(1);
      else if (e.key === "up") step(-1);
      else return;
      cx.notify();
    })
    .child(h_flex().px(8).pt(2).pb(6).text_size(11).text_color(t.dim)
      .child(div().flex_1().child("Recent tabs"))
      .child(div().child("Tab / Shift+Tab to move · release Ctrl to switch · Esc to cancel")))
    .when(!rows.length, (el) => el.child(div().px(8).py(6).text_color(t.dim).child("No other tabs yet.")))
    .children(rows.map((r, i) => {
      const mc = r.machine ? machineColor(r.machine, known) : null;
      return h_flex()
        .id(`sb-sw-${i}`)
        .h(34)
        .px(8)
        .gap(8)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .when(i === SW.sel, (el) => el.bg(t.selected))
        .when(i === 0 && !r.window, (el) => el.text_color(t.muted))
        .hover((x) => x.bg(t.hover))
        .on_click(() => pick(r))
        // macOS turns a click with Ctrl held (as it is while the switcher is open)
        // into a right-click: that chooses too.
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); pick(r); })
        .child(icon(r.program))
        .child(div().flex_none().max_w(300).truncate().font_medium().child(r.title))
        .when(Boolean(r.project), (el) => el.child(tag(r.project, t.muted, t.raised)))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(i === 0 && !r.window ? "shown now" : r.spaceName ?? ""))
        .when(Boolean(r.machine), (el) => el.child(tag(r.machine, mc, mc + "26")))
        .when(Boolean(r.window), (el) => el.child(tag(r.window.title, t.accent, t.accent + "26")));
    }));
}
