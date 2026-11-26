// hayami (specs 010, 011): hayami's readings under the dock's nav and git, from the
// hayami service (lib/hayami.js, hayami-js) on the machine the dock follows: the
// shown space's, local or remote. The sections shown
// are chosen in the block (its header's button, or a right-click), one choice per
// app home; side by side when the block is wide, one under another when narrow.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, window, theme, settings, checking, props, shared, setShared, run, openOverlay, closeOverlay, nextCommand, spaces } from "herdr";
import {
  readings, usageRows, windowTail, leadWindow, otherFigures, quotaStatus,
  ORDER, TITLES, shownSections, due, arrange, blockHeight,
  bandwidthRows, coolerRows, peripheralRows, clockRow,
} from "./lib/hayami.js";
import { shownSpace } from "./lib/location.js";

const ROW = 20;
const SECTIONS = "hayami.sections"; // shared: the shown section keys, per app home
const HEIGHTS = "hayami.px"; // shared: { "dock-bottom": px, "dock-right": px }, for dock-tabs

const ROWS = { bandwidth: bandwidthRows, cooler: coolerRows, peripherals: peripheralRows };

// Per machine: "linux" | "macos" | "windows". "" is this computer.
const platforms = new Map();
async function platformOf(on) {
  const known = platforms.get(on ?? "");
  if (known) return known;
  let p;
  if (!on) p = window()?.platform ?? "linux";
  else {
    try {
      const r = await exec("sh", ["-c", "uname -s"], { on });
      p = r.stdout.trim() === "Darwin" ? "macos" : "linux";
    } catch {
      p = "windows"; // no sh there
    }
  }
  platforms.set(on ?? "", p);
  return p;
}

const shown = () => shownSections(shared(SECTIONS));

// The machine the dock follows: the shown space's. Every terminal in a space runs on
// its machine, and a chat or a mod pane with focus (which has no terminal to ask)
// is in that space too. undefined while no space is shown.
function followedMachine() {
  const id = shownSpace();
  const space = id ? spaces().find((s) => s.id === id) : null;
  return space ? space.machine ?? null : undefined;
}

function setSection(key, on) {
  const now = shown();
  const next = on ? [...now, key] : now.filter((k) => k !== key);
  if (next.length) setShared(SECTIONS, shownSections(next)); // at least one stays (R2)
}
const toggleSection = (key) => setSection(key, !shown().includes(key));

function openChecklist() {
  openOverlay({ mod: "hayami", kind: "popup", width: 200, props: { menu: true } });
}

export default class Hayami extends View {
  init(_props, cx) {
    if (props()?.menu) { this.initMenu(cx); return; }
    this.on = undefined; // the machine shown; undefined until the first location
    this.sections = {}; // key -> the last good Section read on this.on
    this.last = {}; // key -> when it was last asked for (ms)
    this.failure = null; // { kind, message } of the last read, if it failed
    this.reading = false;
    const on = followedMachine();
    if (on !== undefined) this.follow(on, cx);
    if (checking()) return;
    // The palette's "hayami: show/hide <section>": idempotent, so every copy may act.
    cx.spawn(async (cx) => {
      for (;;) {
        const m = /^(show|hide)-(\w+)$/.exec(await nextCommand());
        if (m && ORDER.includes(m[2])) setSection(m[2], m[1] === "show");
        cx.notify();
      }
    });
    cx.timer.every(1000, (cx) => {
      if (window()?.visible === false || this.on === undefined) return;
      this.read(cx);
      // The clock ticks between reads; a minute is all it shows.
      if (shown().includes("clock") && new Date().getSeconds() === 0) cx.notify();
    });
  }

  follow(on, cx) {
    if (on === this.on) return;
    this.on = on;
    this.sections = {}; // another machine's readings are not this one's (010 R6)
    this.last = {};
    this.failure = null;
    this.read(cx);
  }

  // One request for the shown sections that are due (R3).
  read(cx) {
    if (this.reading || checking()) return;
    const keys = due(shown(), this.last, Date.now(), this.sections.usage?.interval_s);
    if (!keys.length) return;
    this.reading = true;
    const on = this.on;
    const at = Date.now();
    for (const k of keys) this.last[k] = at;
    cx.spawn(async (cx) => {
      try {
        const platform = await platformOf(on);
        const r = await readings(exec, platform, keys, { on });
        if (on !== this.on) return; // followed elsewhere meanwhile
        if (r.ok) {
          for (const k of keys) if (r.readings[k]) this.sections[k] = r.readings[k];
          this.failure = null;
        } else this.failure = r;
      } finally {
        this.reading = false;
        cx.notify();
      }
    });
  }

  // ---- the checklist popup -------------------------------------------------------

  initMenu(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  renderMenu() {
    const t = theme();
    const on = shown();
    const box = (k) => div().flex_none().size(16).rounded(4).border_2()
      .border_color(on.includes(k) ? t.accent : t.muted).when(on.includes(k), (el) => el.bg(t.accent))
      .flex().items_center().justify_center().text_size(11).font_bold().text_color("#ffffff")
      .child(on.includes(k) ? "✓" : "");
    return v_flex().id("hayami-menu").track_focus(this.handle).w_full().p(5).bg(t.popover).text_color(t.foreground).text_size(12.8)
      .on_key_down((e) => { if (e.key === "escape") closeOverlay(props().overlay); })
      .child(div().px(9).py(4).text_size(11).text_color(t.dim).child("Sections"))
      .children(ORDER.map((k) => h_flex().id(`hayami-mi-${k}`).h(28).px(9).gap(8).rounded(6).items_center()
        .hover((s) => s.bg(t.hover)).cursor_pointer()
        .on_click(() => toggleSection(k))
        .child(box(k))
        .child(div().flex_1().child(TITLES[k]))));
  }

  // ---- the block -----------------------------------------------------------------

  render(cx) {
    if (props()?.menu) return this.renderMenu();
    const on = followedMachine();
    if (on !== undefined) this.follow(on, cx);
    const t = theme();
    const mono = settings().font_family;
    const zoom = Number(settings().zoom) || 1;
    const width = this.size ? this.size.width / zoom : 0;
    const machine = this.on ?? "this machine";
    const keys = shown();
    const how = arrange(width, keys.length);
    const colWidth = how === "columns" ? width / keys.length : width;

    const bodies = keys.map((k) => this.section(t, mono, k, colWidth));
    this.fit(cx, blockHeight(bodies.map((b) => b.lines), how));

    const button = div().id("hayami-sections").flex_none().px(6).rounded(4).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => openChecklist()).child("☰");
    const header = h_flex().h(22).flex_none().gap(8).items_center().text_size(11.5)
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(machine))
      .children(this.failure && Object.keys(this.sections).length ? [div().flex_none().text_color(t.working).child("stale")] : [])
      .child(button);

    const blocks = bodies.map((b, i) => v_flex().id(`hayami-s-${keys[i]}`).min_w(0).gap(2).overflow_hidden()
      .when(how === "columns", (el) => el.flex_1())
      .child(b.title).children(b.rows));
    const body = how === "columns"
      ? h_flex().w_full().items_start().gap(16).children(blocks)
      : v_flex().w_full().gap(8).children(blocks);

    return v_flex().id("hayami").size_full().px(10).py(6).overflow_hidden()
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openChecklist(); })
      .text_size(12).text_color(t.foreground)
      .child(header)
      .child(body);
  }

  // Resize this block's layout node to `px` when what is shown needs another height
  // (R5), and record it so dock-tabs builds the node at that height.
  fit(cx, px) {
    const dock = props()?.dock;
    if (!dock || checking() || px === this.fitted) return;
    this.fitted = px;
    cx.spawn(async () => {
      run("layout.resize", { id: `${dock}-hayami`, px });
      const all = shared(HEIGHTS) ?? {};
      if (all[dock] !== px) setShared(HEIGHTS, { ...all, [dock]: px });
    });
  }

  // A section: its title line (with its absences) and its lines, and how many lines
  // it has for the block's height.
  section(t, mono, key, colWidth) {
    const s = this.sections[key];
    const note = (text, color = t.dim) => div().h(ROW).flex_none().truncate().text_color(color).child(text);
    // Its absences in one line that gives way to the title (a long one is cut short).
    let absences = (s?.absences ?? []).map((a) => (a.detail ? `${a.text}, ${a.detail}` : a.text)).join(" · ");
    let rows;
    if (!s && this.failure?.kind === "no-service") rows = [note(`${this.on ?? "this machine"}: hayami service not running`)];
    else if (!s && this.failure) rows = [note(this.failure.message, t.blocked)];
    else if (!s) rows = [note(this.on === undefined ? "No space shown" : "Reading…")];
    else if (key === "usage") {
      const u = usageRows(s);
      rows = u.accounts.length ? u.accounts.map((a, ai) => this.usageRow(t, mono, a, colWidth, `${ai}`))
        : [note(u.error ?? "No accounts", u.error ? t.blocked : t.dim)];
    } else {
      const lines = key === "clock" ? [clockRow(s)] : ROWS[key](s);
      // Nothing to list: why goes on the line, where it has room, not in the title.
      if (!lines.length && !s.error && absences) { rows = [note(absences)]; absences = ""; }
      else rows = lines.length ? lines.map((r, i) => this.line(t, mono, r, `${key}-${i}`))
        : [note(s.error ?? "Nothing to show", s.error ? t.blocked : t.dim)];
    }
    const title = h_flex().h(ROW).flex_none().gap(8).items_center().text_size(11.5)
      .child(div().flex_none().font_semibold().text_color(t.muted).child(TITLES[key]))
      .child(div().flex_1().min_w(0).truncate().text_right().text_color(t.dim).child(absences));
    return { title, rows, lines: rows.length };
  }

  // A line of a section: its label, then its parts, each coloured by its status.
  line(t, mono, r, key) {
    const color = { good: t.ansi2, warn: t.working, bad: t.blocked, accent: t.accent, strong: t.foreground, info: t.muted };
    return h_flex().id(`l-${key}`).h(ROW).flex_none().gap(10).items_center().when(r.dim, (el) => el.opacity(0.5))
      .child(div().flex_1().min_w(40).max_w(160).truncate().child(r.label))
      .children(r.parts.map((p, i) => div().id(`p-${key}-${i}`).flex_none().font_family(mono).text_size(11.5)
        .text_color(color[p.status] ?? t.muted).when(p.status === "strong", (el) => el.font_semibold()).child(p.text)));
  }

  // One account, one line (#28), as hayami's panel draws it: the name and badge,
  // the lead window (leadWindow) as name, meter and share, the other windows'
  // figures when there is room, then the lead's reset or amounts. Fixed widths, so
  // a changing figure never moves the row (glance rule).
  usageRow(t, mono, a, width, key) {
    const figures = width >= 620, tail = width === 0 || width >= 400;
    const w = leadWindow(a.windows);
    const head = h_flex().w(110).flex_none().gap(4).items_center()
      .child(div().min_w(0).truncate().font_semibold().child(a.name))
      .children(a.badge ? [div().flex_none().px(4).rounded(3).bg(t.raised).text_size(10).text_color(t.muted).child(a.badge)] : []);
    const line = h_flex().id(`u-${key}`).h(ROW).flex_none().gap(8).items_center().child(head);
    if (!w) return line.child(div().text_color(t.dim).child("no windows"));
    const status = quotaStatus(w.pct);
    const color = status === "bad" ? t.blocked : status === "warn" ? t.working : t.accent;
    return line
      .child(div().w(44).flex_none().truncate().text_color(t.muted).child(w.name))
      .child(div().flex_1().min_w(40).h(6).rounded(3).bg(t.raised)
        .child(div().h_full().rounded(3).bg(color).w(`${w.pct}%`)))
      .child(div().w(36).flex_none().font_family(mono).text_color(color).child(`${String(Math.round(w.pct)).padStart(3, " ")}%`))
      .children(figures ? [div().w(250).flex_none().truncate().font_family(mono).text_size(11).text_color(t.dim).child(otherFigures(a.windows, w))] : [])
      .children(tail ? [div().w(140).flex_none().truncate().font_family(mono).text_color(t.dim).child(windowTail(w))] : []);
  }
}
