// The quick switcher (spec 016): Ctrl+Space, type part of a name, Enter switches to
// it: a tab, a nested tab, a space or a machine, in this window or another window on
// this computer. lib/quick-find.js builds the items and ranks them.
//
// The bar copy publishes what this window has open (publish) and opens the dialog;
// the dialog is another copy of this mod (props.finder).
import { svg, image, div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { spaces, panes, terminals, run, theme, props, closeOverlay, shared, setShared } from "herdr";
import { findItems, quickFind } from "./lib/quick-find.js";
import { machineColor } from "./lib/machine-color.js";
import { ORDER_KEY } from "./switcher.js";
import { OTHERS, showInWindow } from "./others.js";
import { openDialog, dialogClosed } from "./dialogs.js";

// What this window has open, in its app home's shared state, for the other windows.
export const ITEMS_KEY = "spaces-bar.find-items";
const ICON = (n) => `mods/spaces-bar/${n}.svg`;

const own = () => findItems({ spaces: spaces(), panes: panes(), terms: terminals(), order: shared(ORDER_KEY) ?? [] });

/** Publishes this window's items for the other windows, when they changed (bar copy). */
export function publish() {
  const items = own().map(({ nested, ...rest }) => rest);
  if (JSON.stringify(items) !== JSON.stringify(shared(ITEMS_KEY) ?? [])) setShared(ITEMS_KEY, items);
}

export function open() {
  openDialog("find", { mod: "spaces-bar", kind: "dialog", width: 680, props: { finder: true } });
}

/** The dialog copy's start: the box (focused), this window's items and the others'. */
export function initDialog(view, cx) {
  view.items = [
    ...own(),
    ...OTHERS.list.flatMap((o) => (Array.isArray(o.data?.[ITEMS_KEY]) ? o.data[ITEMS_KEY] : []).map((x) => ({ ...x, key: `${o.window.session}:${x.key}`, window: o.window }))),
  ];
  view.sel = 0;
  view.query = InputState.new({ placeholder: "Find a tab, nested tab, space or machine…" });
  view.query.on("change", (_e, cx) => { view.sel = 0; cx.notify(); });
  view.query.on("submit", () => pick(view.results?.[view.sel]));
  cx.timer.after(1, () => view.query.focus());
}

// Shows an item: here, in order (a nested tab through nested-tabs' request); in
// another window through its CLI, that window brought forward.
function pick(it) {
  closeOverlay(props()?.overlay);
  dialogClosed("find");
  if (!it) return;
  if (it.window) return showInWindow(it.window, it.steps);
  for (const [c, args] of it.steps) run(c, args);
  if (it.nested) setShared("nested-tabs.request", { ...it.nested, at: Date.now() });
  // A chat landed on takes the keyboard back from this closing dialog (ushi-naruse).
  setShared("ushi-naruse.focus-request", Date.now());
}

/** The dialog. */
export function renderDialog(view) {
  const t = theme();
  const q = view.query.value();
  const results = view.results = quickFind(view.items, q, 40);
  if (view.sel >= results.length) view.sel = Math.max(0, results.length - 1);
  const first = q.trim().split(/\s+/)[0] ?? "";
  const known = spaces().map((s) => s.machine);
  const tag = (text, color, bg) => div().flex_none().max_w(170).truncate().px(6).rounded(5).bg(bg).text_color(color).text_size(11).child(text);
  const kindIcon = (it) => {
    const p = it.program;
    if (it.kind === "machine") return svg(ICON("server")).size(14).flex_none().text_color(machineColor(it.machine, known) ?? t.dim);
    if (it.kind === "space") return div().w(15).flex_none().text_color(t.dim).child("#");
    if (p?.icon) return p.tint ? svg(p.icon).size(15).flex_none().text_color(t.foreground) : image(p.icon).w(15).h(15).flex_none();
    return div().w(15).flex_none();
  };
  // The title with the first word's match marked.
  const title = (it) => {
    if (it.mark < 0 || !first) return div().flex_none().max_w(320).truncate().child(it.title);
    const s = String(it.title);
    return h_flex().flex_none().max_w(320).overflow_hidden()
      .child(div().flex_none().child(s.slice(0, it.mark)))
      .child(div().flex_none().text_color(t.accent).font_semibold().child(s.slice(it.mark, it.mark + first.length)))
      .child(div().truncate().child(s.slice(it.mark + first.length)));
  };
  const kindWord = { tab: "tab", nested: "nested tab", space: "space", machine: "machine" };
  return v_flex()
    .id("sb-finder")
    .w_full()
    .p(6)
    .gap(4)
    .bg(t.popover)
    .text_size(13)
    .on_key_down((e, cx) => {
      if (e.key === "escape") { dialogClosed("find"); return closeOverlay(props()?.overlay); }
      const n = Math.max(1, results.length);
      if (e.key === "down") view.sel = (view.sel + 1) % n;
      else if (e.key === "up") view.sel = (view.sel - 1 + n) % n;
      else return;
      cx.stop_propagation();
      cx.notify();
    })
    .child(Input.new(view.query).h(36).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(14))
    .when(!results.length, (el) => el.child(div().px(8).py(8).text_color(t.dim).child(q.trim() ? "Nothing open matches." : "Nothing open yet.")))
    .child(v_flex().gap(1).children(results.map((it, i) => {
      const mc = it.machine ? machineColor(it.machine, known) : null;
      return h_flex()
        .id(`sb-find-${i}`)
        .h(32)
        .px(8)
        .gap(8)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .when(i === view.sel, (el) => el.bg(t.selected))
        .hover((x) => x.bg(t.hover))
        .on_click(() => pick(it))
        .child(kindIcon(it))
        .child(title(it))
        .when(Boolean(it.project), (el) => el.child(tag(it.project, t.muted, t.raised)))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim)
          .child(it.kind === "tab" || it.kind === "nested" ? `${kindWord[it.kind]} · ${it.place}` : kindWord[it.kind]))
        .when(Boolean(it.machine) && it.kind !== "machine", (el) => el.child(tag(it.machine, mc, mc + "26")))
        .when(Boolean(it.window), (el) => el.child(tag(it.window.title, t.accent, t.accent + "26")));
    })))
    .child(div().px(8).pt(2).text_size(11).text_color(t.dim).child("↑↓ to move · Enter to switch · Esc to close"));
}
