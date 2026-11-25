// UI Lab: a capability demo. Claude writes ~/.cache/herdr-ui-lab/state.json,
// this panel renders it; clicks and form submits go back to Claude via `hc send`.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView, SliderState, Slider, SliderTrack, SliderIndicator, SliderThumb } from "gpui-base";
import { exec, hc, home, theme, settings, readTextFile, watchFolder, checking, notify, window, props, openOverlay, closeOverlay, nextCommand } from "herdr";

const HISTORY = 40;

export default class UiLab extends View {
  init(_props, cx) {
    // The pop-out: a floating window showing only the usage meters.
    this.compact = Boolean(props()?.compact);
    if (this.compact) {
      if (checking()) return;
      this.pullUsage(cx);
      cx.timer.every(60000, (cx) => this.pullUsage(cx));
      return;
    }
    this.dir = `${home()}/.cache/herdr-ui-lab`;
    this.state = {};
    this.sent = null;
    this.note = InputState.new({ placeholder: "Type a note for Claude" });
    this.note.on("submit", (_e, cx) => this.sendForm(cx));
    this.level = SliderState.new({ min: 0, max: 100, value: 40 });
    this.level.on("change", (_v, cx) => cx.notify());
    this.enabled = true;
    this.load = [];
    this.disk = null;
    this.cmdOut = "";

    this.reload(cx);
    if (checking()) return;
    cx.spawn(async (cx) => {
      for (;;) {
        await watchFolder(this.dir);
        this.reload(cx);
      }
    });
    // `herdr-app do ui-lab.float` reaches this copy while its tab is shown.
    cx.spawn(async () => {
      for (;;) if ((await nextCommand()) === "float") this.popOut();
    });
    this.sample(cx);
    this.pullUsage(cx);
    cx.timer.every(60000, (cx) => { if (window()?.visible !== false) this.pullUsage(cx); });
    cx.timer.every(3000, (cx) => { if (window()?.visible !== false) this.sample(cx); });
  }

  reload(cx) {
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${this.dir}/state.json`);
      try { this.state = text ? JSON.parse(text) : {}; this.error = null; }
      catch (e) { this.error = `state.json: ${e.message}`; }
      cx.notify();
    });
  }

  sample(cx) {
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", "sysctl -n vm.loadavg; df -k / | tail -1; sysctl -n hw.ncpu"]);
      const [loadLine, dfLine, cpuLine] = r.stdout.trim().split("\n");
      this.ncpu = Number(cpuLine) || 1;
      const one = parseFloat(loadLine.replace(/[{}]/g, "").trim().split(/\s+/)[0]);
      if (!Number.isNaN(one)) this.load = [...this.load, one].slice(-HISTORY);
      const pct = dfLine?.match(/(\d+)%/);
      this.disk = pct ? Number(pct[1]) : null;
      cx.notify();
    });
  }

  // hayami's `readings` JSON, from this Mac and from njv-cachyos (machine name as herdr knows it).
  pullUsage(cx) {
    cx.spawn(async (cx) => {
      const rows = [];
      for (const [label, on] of [["this Mac", null], ["njv-cachyos", "njv-cachyos-default"]]) {
        try {
          const r = await exec("hayami-tui", ["readings", "--sections", "usage"], { on, timeout: 20000 });
          for (const d of JSON.parse(r.stdout).usage?.data ?? []) rows.push({ ...d, host: label });
        } catch (e) {
          rows.push({ host: label, error: String(e.message ?? e) });
        }
      }
      this.usage = rows;
      this.usageAt = new Date();
      cx.notify();
    });
  }

  popOut() {
    openOverlay({ mod: "ui-lab", props: { compact: true }, kind: "window", key: "ui-lab-usage", width: 380, frame: "none" });
  }

  usageRows(t) {
    const bar = (pct, color) => div().w_full().h(6).rounded(3).bg(t.raised)
      .child(div().h_full().rounded(3).bg(color).w(`${Math.max(0, Math.min(100, pct))}%`).transition("width", { duration: 300 }));
    const until = (iso) => {
      const ms = new Date(iso) - Date.now();
      if (!(ms > 0)) return "now";
      const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
      return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
    };
    const color = (f) => (f >= 0.9 ? t.blocked : f >= 0.7 ? t.working : t.accent);
    if (!this.usage) return [div().text_color(t.dim).child("Loading…")];
    return this.usage.map((u, i) => u.error
      ? div().text_size(12).text_color(t.blocked).child(`${u.host}: ${u.error}`)
      : v_flex().gap(4).id(`u-${i}`)
        .child(h_flex().gap(8).items_center().text_size(12)
          .child(div().w(70).font_semibold().child(u.Account))
          .child(div().w(44).text_color(t.muted).child(u.Name))
          .child(div().flex_1().text_color(t.dim).truncate().child(u.host))
          .child(div().w(40).child(`${Math.round(u.Fraction * 100)}%`))
          .child(div().w(64).text_color(t.dim).child(`↻ ${until(u.ResetsAt)}`)))
        .child(bar(u.Fraction * 100, color(u.Fraction))));
  }

  renderCompact(t) {
    const p = props();
    return v_flex().id("ui-lab-float").w_full().p(12).gap(8).rounded(12).border_1().border_color(t.border)
      .bg(t.popover).text_color(t.foreground).text_size(13)
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().font_semibold().child("hayami usage"))
        .child(div().text_size(11).text_color(t.dim).child(this.usageAt?.toLocaleTimeString() ?? ""))
        .child(div().id("float-close").px(6).rounded(4).text_color(t.muted).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(() => closeOverlay(p.overlay)).child("✕")))
      .children(this.usageRows(t));
  }

  send(text, cx) {
    const target = this.state.target;
    if (!target) { notify({ title: "UI Lab", body: "No target terminal in state.json", level: "warning" }); return; }
    cx.spawn(async (cx) => {
      const r = await hc(["send", target, text]);
      this.sent = r.code === 0 ? `Sent to ${target}: ${text}` : `hc send failed: ${r.stderr.trim()}`;
      cx.notify();
    });
  }

  sendForm(cx) {
    const note = this.note.value().trim();
    this.send(`[UI Lab form] note="${note}" level=${Math.round(this.level.value())} enabled=${this.enabled}`, cx);
  }

  runCommand(cx) {
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", "uname -srm; sw_vers 2>/dev/null; uptime"]);
      this.cmdOut = (r.stdout + r.stderr).trim();
      cx.notify();
    });
  }

  render() {
    const t = theme();
    if (this.compact) return this.renderCompact(t);
    const card = (title, ...kids) => v_flex().gap(10).p(14).rounded(10).border_1().border_color(t.border).bg(t.surface)
      .child(div().text_size(11.5).font_semibold().text_color(t.dim).child(title.toUpperCase()))
      .children(kids);
    const button = (id, text, primary, action) => h_flex().id(id).h(30).px(12).items_center().rounded(7)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).cursor_pointer()
      .hover((s) => s.opacity(0.85)).on_click(action).child(text);
    const bar = (pct, color) => div().w_full().h(8).rounded(4).bg(t.raised)
      .child(div().h_full().rounded(4).bg(color).w(`${Math.max(0, Math.min(100, pct))}%`).transition("width", { duration: 300 }));

    const s = this.state;
    const maxLoad = Math.max(this.ncpu ?? 1, ...this.load);
    const level = Math.round(this.level.value());

    const fromClaude = card("From Claude (state.json)",
      this.error ? div().text_color(t.blocked).child(this.error) : TextView.markdown("lab-md", s.markdown ?? "_Nothing yet._").selectable(true),
      ...(s.question ? [div().pt(4).font_semibold().child(s.question)] : []),
      h_flex().gap(8).flex_wrap().children((s.choices ?? []).map((c, i) =>
        button(`choice-${i}`, c, i === 0, (_e, cx) => this.send(`[UI Lab] picked: ${c}`, cx)))));

    const usage = card("hayami usage (readings JSON, every 60s)",
      ...this.usageRows(t),
      h_flex().justify_between().items_center()
        .child(div().text_size(11).text_color(t.dim).child(this.usageAt ? `updated ${this.usageAt.toLocaleTimeString()}` : ""))
        .child(button("pop-out", "Pop out ↗", false, () => this.popOut())));

    const controls = card("Controls → Claude",
      Input.new(this.note).h(34).px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.5),
      h_flex().gap(12).items_center()
        .child(div().w(70).text_size(12).text_color(t.muted).child(`Level ${level}`))
        .child(div().flex_1().child(
          Slider.new(this.level).child(
            SliderTrack.new(this.level).flex().items_center().h(22).w_full().child(
              SliderIndicator.new(this.level).relative().w_full().h(6).rounded(3).bg(t.raised)
                .range_style((fill) => fill.rounded(3).bg(t.accent))
                .child(SliderThumb.new(this.level).size(16).rounded(8).bg(t.accent).ml(-8)))))),
      h_flex().gap(12).items_center()
        .child(h_flex().id("toggle").w(36).h(20).rounded(10).p(2).cursor_pointer()
          .bg(this.enabled ? t.accent : t.raised).when(this.enabled, (el) => el.justify_end())
          .on_click((_e, cx) => { this.enabled = !this.enabled; cx.notify(); })
          .child(div().size(16).rounded(8).bg(t.foreground)))
        .child(div().flex_1().text_size(12).text_color(t.muted).child(this.enabled ? "Enabled" : "Disabled"))
        .child(button("send-form", "Send to Claude", true, (_e, cx) => this.sendForm(cx))),
      ...(this.sent ? [div().text_size(11.5).text_color(t.dim).child(this.sent)] : []));

    const live = card("Live system (exec every 3s)",
      h_flex().justify_between().text_size(12).child(`Load (1m): ${this.load.at(-1)?.toFixed(2) ?? "…"}`).child(div().text_color(t.dim).child(`${this.ncpu ?? "?"} cores · last ${this.load.length} samples`)),
      h_flex().h(60).items_end().gap(2).children(this.load.map((v, i) =>
        div().flex_1().rounded(2).bg(v > (this.ncpu ?? 1) * 0.75 ? t.blocked : t.working).h(`${Math.max(4, (v / maxLoad) * 100)}%`).id(`l-${i}`))),
      h_flex().justify_between().text_size(12).child(`Disk / used`).child(`${this.disk ?? "…"}%`),
      bar(this.disk ?? 0, (this.disk ?? 0) > 85 ? t.blocked : t.accent));

    const cmd = card("Run a command",
      h_flex().child(button("run-cmd", "Run uname / sw_vers / uptime", false, (_e, cx) => this.runCommand(cx))),
      ...(this.cmdOut ? [div().p(10).rounded(6).bg(t.background).font_family(settings().font_family).text_size(12).child(this.cmdOut)] : []));

    return v_flex().id("ui-lab").size_full().bg(t.canvas).text_color(t.foreground).text_size(13).overflow_y_scrollbar()
      .child(v_flex().p(16).gap(12).max_w(760)
        .child(h_flex().items_center().gap(8)
          .child(div().text_size(18).font_semibold().child("UI Lab"))
          .child(div().text_size(12).text_color(t.dim).child(`target: ${s.target ?? "none"}`)))
        .child(fromClaude).child(usage).child(controls).child(live).child(cmd));
  }
}
