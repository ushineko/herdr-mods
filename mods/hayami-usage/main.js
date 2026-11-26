// hayami-usage (spec 010): Claude Code and Codex usage under the dock's nav and git,
// read from the hayami service (lib/hayami.js) on the machine the dock follows: the
// focused terminal's, local or remote, as nav and git follow it. Replaces the lower
// dock's hayami-tui terminal.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, window, theme, settings, checking } from "herdr";
import { readings, usageRows, until, pollEvery } from "./lib/hayami.js";
import { terminalLocation, fallbackLocation } from "./lib/location.js";

const ROW = 20;

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

export default class HayamiUsage extends View {
  init(_props, cx) {
    this.on = undefined; // the machine shown; undefined until the first location
    this.usage = null; // usageRows of the last good reading on this.on
    this.failure = null; // { kind, message } of the last read, if it failed
    this.readAt = 0;
    this.reading = false;
    this.every = pollEvery(null);
    const loc = terminalLocation() ?? fallbackLocation();
    if (loc) this.follow(loc.on, cx);
    if (checking()) return;
    cx.timer.every(5000, (cx) => {
      if (window()?.visible === false || this.on === undefined) return;
      if (Date.now() - this.readAt >= this.every) this.read(cx);
    });
  }

  follow(on, cx) {
    if (on === this.on) return;
    this.on = on;
    this.usage = null; // another machine's figures are not this one's (R6)
    this.failure = null;
    this.read(cx);
  }

  read(cx) {
    if (this.reading || checking()) return;
    this.reading = true;
    const on = this.on;
    cx.spawn(async (cx) => {
      try {
        const platform = await platformOf(on);
        const r = await readings(exec, platform, ["usage"], { on });
        if (on !== this.on) return; // followed elsewhere meanwhile
        if (r.ok && r.readings.usage) {
          this.usage = usageRows(r.readings.usage);
          this.every = pollEvery(this.usage.interval_s);
          this.failure = null;
        } else {
          this.failure = r.ok ? { kind: "bad-json", message: "no usage section" } : r;
        }
      } finally {
        this.readAt = Date.now();
        this.reading = false;
        cx.notify();
      }
    });
  }

  render(cx) {
    const loc = terminalLocation();
    if (loc) this.follow(loc.on, cx);
    const t = theme();
    const mono = settings().font_family;
    const machine = this.on ?? "this machine";
    const u = this.usage;

    const note = (text, color = t.dim) => div().h(ROW).flex_none().truncate().text_color(color).child(text);
    const header = h_flex().h(ROW).gap(8).items_center().text_size(11.5)
      .child(div().flex_none().font_semibold().text_color(t.muted).child("Usage"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(machine))
      .children((u?.absences ?? []).map((a, i) => div().id(`abs-${i}`).flex_none().text_color(t.dim)
        .child(a.detail ? `${a.text}, ${a.detail}` : a.text)))
      .children(u && this.failure ? [div().flex_none().text_color(t.working).child("stale")] : []);

    let body;
    if (!u && this.failure?.kind === "no-service") body = [note(`${machine}: hayami service not running`)];
    else if (!u && this.failure) body = [note(this.failure.message, t.blocked)];
    else if (!u) body = [note(this.on === undefined ? "No terminal to follow" : "Reading…")];
    else if (u.error && !u.accounts.length) body = [note(u.error, t.blocked)];
    else if (!u.accounts.length) body = [note("No accounts")];
    else body = u.accounts.flatMap((a, ai) => a.windows.map((w, wi) => this.row(t, mono, a, w, `${ai}-${wi}`)));

    return v_flex().id("hayami-usage").size_full().px(10).py(6).gap(2).overflow_hidden()
      .text_size(12).text_color(t.foreground)
      .child(header)
      .children(body);
  }

  // One usage window: account and badge, window, meter, percentage, reset or note.
  // Fixed widths, so a changing figure never moves the row (glance rule).
  row(t, mono, a, w, key) {
    const color = w.pct >= 90 ? t.blocked : w.pct >= 70 ? t.working : t.accent;
    const tail = w.note ?? (w.resets_at ? `↻ ${until(w.resets_at)}` : "");
    return h_flex().id(`u-${key}`).h(ROW).flex_none().gap(8).items_center()
      .child(h_flex().w(120).flex_none().gap(4).items_center()
        .child(div().min_w(0).truncate().font_semibold().child(a.name))
        .children(a.badge ? [div().flex_none().px(4).rounded(3).bg(t.raised).text_size(10).text_color(t.muted).child(a.badge)] : []))
      .child(div().w(44).flex_none().truncate().text_color(t.muted).child(w.name))
      .child(div().flex_1().min_w(40).h(6).rounded(3).bg(t.raised)
        .child(div().h_full().rounded(3).bg(color).w(`${w.pct}%`)))
      .child(div().w(40).flex_none().font_family(mono).text_color(color).child(`${String(Math.round(w.pct)).padStart(3, " ")}%`))
      .child(div().w(140).flex_none().truncate().font_family(mono).text_color(t.dim).child(tail));
  }
}
