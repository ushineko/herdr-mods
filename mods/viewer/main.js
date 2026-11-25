// One file in a tab (spec 001): Markdown rendered or as source, code highlighted,
// images drawn, git diffs coloured. Follows the file as it changes on disk.
// Opened through lib/open.js: tab.new { mod: "viewer", props: { path, on, line, diff } }.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { props, theme, settings, exec, readTextFile, watchFolder, window, appHome, shared, notify, checking } from "herdr";
import { fileType, baseName, isBinary, bounded, lineCount, extension } from "./lib/filetype.js";
import { parseDiff, untrackedDiff } from "./lib/diff.js";
import { parseRules, pickRule, argvFor } from "./lib/external.js";
import { viewerKey } from "./lib/open.js";

const LIMIT = 2_000_000;
const CACHE = "data/herdr-mods-viewer";
const CACHE_KEEP = 20;
const REMOTE_POLL = 5000;
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];

// Per machine: { platform, home, rules, error, at }. Shared by copies; refreshed after a minute.
const machineInfo = new Map();

async function infoFor(on) {
  const cached = machineInfo.get(on ?? "");
  if (cached && Date.now() - cached.at < 60000) return cached;
  const r = await exec("sh", ["-c", 'uname -s; printf "%s\\n" "$HOME"; cat "$HOME/.config/herdr-mods/external.json" 2>/dev/null'], { on });
  const [os, home, ...rest] = r.stdout.split("\n");
  const { rules, error } = parseRules(rest.join("\n").trim() || null);
  const info = { platform: os.trim() === "Darwin" ? "macos" : "linux", home: home.trim(), rules, error, at: Date.now() };
  machineInfo.set(on ?? "", info);
  return info;
}

const dirname = (p) => p.slice(0, Math.max(1, p.lastIndexOf("/")));
const withAlpha = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + a : c);
// Short stable name for this file's image copies: a reload reuses it, so copies do not pile up.
const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(36); };
const human = (n) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default class Viewer extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.path = p.path ?? "";
    this.on = p.on ?? null;
    this.diff = p.diff ?? null;
    this.line = p.line ?? null;
    this.key = viewerKey({ path: this.path, on: this.on, diff: this.diff });
    this.type = this.diff ? { kind: "diff", lang: null } : fileType(this.path);
    this.mode = this.type.kind === "markdown" ? "rendered" : "source";
    this.wrap = false;
    this.id = hash(this.key);
    this.version = 0;
    this.handle = cx.focus_handle();
    this.gotoAt = Date.now();
    this.load(cx);
    if (checking()) return;
    this.locate(cx);
    if (!this.on) {
      this.pruneCache(cx);
      cx.spawn(async (cx) => {
        const dir = this.diff ? this.diff.repo : dirname(this.path);
        for (;;) {
          this.watch = watchFolder(dir);
          const changed = await this.watch;
          if (!changed.length) return; // cancelled
          if (this.diff || changed.some((c) => c === this.path || c === dir)) this.load(cx);
        }
      });
    } else {
      cx.timer.every(REMOTE_POLL, (cx) => { if (window()?.visible !== false) this.load(cx); });
    }
  }

  async close() {
    this.watch?.cancel();
    if (this.type.kind === "image") await this.dropCopies();
  }

  // Repository root (for the header path) and the external-app rule for this file.
  locate(cx) {
    cx.spawn(async (cx) => {
      try {
        const info = await infoFor(this.on);
        this.home = info.home;
        this.rule = pickRule(info.rules, this.path, info.platform);
        this.platform = info.platform;
        if (info.error) this.configError = info.error;
        const r = await exec("git", [...READ, "rev-parse", "--show-toplevel"], { cwd: dirname(this.path), on: this.on });
        if (r.code === 0) this.repo = r.stdout.trim();
      } catch { /* the header falls back to ~ */ }
      cx.notify();
    });
  }

  // Removes every copy of this file's image (all versions).
  dropCopies(keep = null) {
    return exec("sh", ["-c", 'for f in "$1"/"$2"-*; do [ -e "$f" ] && [ "$f" != "$3" ] && rm -f -- "$f"; done; true',
      "drop", `${appHome()}/${CACHE}`, this.id, keep ?? ""]).catch(() => null);
  }

  // Keeps this tab's image copy only: older than a day or past the newest 20 go.
  pruneCache(cx) {
    cx.spawn(async () => {
      const dir = `${appHome()}/${CACHE}`;
      await exec("sh", ["-c",
        'mkdir -p "$1" && find "$1" -type f -mmin +1440 -delete; ls -t "$1" | tail -n +"$2" | while IFS= read -r f; do rm -f -- "$1/$f"; done',
        "prune", dir, String(CACHE_KEEP + 1)]).catch(() => null);
    });
  }

  load(cx) {
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        if (this.type.kind === "diff") await this.loadDiff();
        else if (this.type.kind === "image") await this.loadImage();
        else await this.loadText();
      } catch (e) {
        this.message = this.type.kind === "diff" ? `git diff failed: ${e.message ?? e}` : "Cannot show this file (binary, too large, or unreadable)";
      } finally {
        this.loading = false;
        cx.notify();
        if (this.again) { this.again = false; this.load(cx); }
      }
    });
  }

  async loadText() {
    const text = await readTextFile(this.path, { on: this.on });
    if (text === null) { this.message = "This file is no longer there"; this.text = null; return; }
    if (isBinary(text)) { this.message = "Binary file · no preview"; return; }
    this.message = null;
    if (text === this.full) return; // unchanged: keep the editor and its scroll
    this.full = text;
    const { text: shown, cut } = bounded(text, LIMIT);
    this.text = shown;
    this.cut = cut;
    this.lines = lineCount(text);
    this.size = text.length; // UTF-16 units; close enough for a header
    if (this.editor) this.editor.set_value(shown);
    else this.makeEditor(shown);
    if (this.line) { this.goto(this.line); this.line = null; }
  }

  makeEditor(value) {
    const t = theme();
    this.editor = EditorState.new({
      language: this.type.lang ?? "txt", readonly: true, value, font_family: settings().font_family,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1,
        constant: t.ansi6, heading: t.ansi4, strong: t.foreground, code: t.ansi2, quote: t.dim, list: t.ansi5, link: t.ansi6 },
    });
    this.editor.set_soft_wrap(this.wrap);
  }

  goto(line) {
    if (!this.editor || !this.text) return;
    let at = 0;
    for (let n = 1; n < line && at >= 0; n++) at = this.text.indexOf("\n", at) + 1 || -1;
    if (at < 0) return;
    const end = this.text.indexOf("\n", at);
    this.editor.set_selected_range({ start: at, end: end < 0 ? this.text.length : end });
  }

  async loadImage() {
    if (this.on) { this.message = `Images on ${this.on} are not shown here; open it there (e)`; return; }
    const ext = extension(this.path);
    const name = `${CACHE}/${this.id}-${++this.version}.${ext}`;
    const dest = `${appHome()}/${name}`;
    const r = await exec("sh", ["-c", 'mkdir -p "$(dirname "$2")" && cp -- "$1" "$2" && file -b -- "$1"', "copy", this.path, dest]);
    if (r.code !== 0) { this.message = "This image is no longer there"; return; }
    this.image = name;
    this.message = null;
    const px = /(\d+)\s*x\s*(\d+)/.exec(r.stdout);
    this.px = px ? { w: Number(px[1]), h: Number(px[2]) } : null;
    await this.dropCopies(dest);
  }

  async loadDiff() {
    const { repo, staged } = this.diff;
    const git = (args) => exec("git", [...READ, ...args], { cwd: repo, on: this.on });
    const r = await git(["diff", ...(staged ? ["--cached"] : []), "--no-color", "--no-ext-diff", "--", this.path]);
    if (r.code !== 0) throw new Error(r.stderr.trim());
    let parsed = parseDiff(r.stdout);
    if (!parsed.rows.length && !staged) {
      const tracked = await git(["ls-files", "--error-unmatch", "--", this.path]);
      if (tracked.code !== 0) {
        const text = await readTextFile(this.path, { on: this.on });
        if (text !== null && !isBinary(text)) parsed = untrackedDiff(bounded(text, LIMIT).text);
      }
    }
    this.diffData = parsed;
    this.message = parsed.rows.length ? null : "No changes";
  }

  openExternal(cx) {
    cx.spawn(async (cx) => {
      const info = await infoFor(this.on).catch(() => null);
      const rule = info && pickRule(info.rules, this.path, info.platform);
      const argv = rule && argvFor(rule, info.platform, this.path);
      if (!argv) { notify({ title: "No external app", body: baseName(this.path), level: "warning" }); return; }
      try {
        const r = await exec(argv[0], argv.slice(1), { on: this.on });
        if (r.code === 0) notify({ title: `Opened in ${rule.app}`, body: this.on ? `${baseName(this.path)} · on ${this.on}` : baseName(this.path) });
        else notify({ title: `${rule.app} failed`, body: (r.stderr || r.stdout).trim().split("\n")[0], level: "error" });
      } catch (e) {
        notify({ title: `${rule.app} failed`, body: String(e.message ?? e), level: "error" });
      }
      cx.notify();
    });
  }

  key(e, cx) {
    const k = e.key;
    if (k === "m" && this.type.kind === "markdown") this.toggleMode(cx);
    else if (k === "w" && this.editor) { this.wrap = !this.wrap; this.editor.set_soft_wrap(this.wrap); cx.notify(); }
    else if (k === "e") this.openExternal(cx);
    else if (k === "r") this.load(cx);
    else return;
    cx.stop_propagation();
  }

  toggleMode(cx) {
    this.mode = this.mode === "rendered" ? "source" : "rendered";
    cx.notify();
  }

  // The path as the header shows it: relative to the repository, else to home.
  shownPath() {
    if (this.repo && this.path.startsWith(this.repo + "/")) return { root: baseName(this.repo), rest: this.path.slice(this.repo.length + 1) };
    if (this.home && this.path.startsWith(this.home + "/")) return { root: "~", rest: this.path.slice(this.home.length + 1) };
    return { root: "", rest: this.path.replace(/^\//, "") };
  }

  render() {
    const t = theme();
    const s = settings();
    const goto = shared("viewer.goto");
    if (goto?.key === this.key && goto.at > this.gotoAt) { this.gotoAt = goto.at; this.goto(goto.line); }

    const kind = this.type.kind;
    const glyph = { markdown: "MD", code: "</>", image: "IMG", text: "TXT", diff: "Δ" }[kind] ?? "TXT";
    const glyphColor = { markdown: t.ansi4, code: t.ansi5, image: t.ansi3, text: t.muted, diff: t.ansi2 }[kind] ?? t.muted;
    const { root, rest } = this.shownPath();
    let parts = rest.split("/");
    const file = parts.pop();
    if (parts.length > 3) parts = ["…", ...parts.slice(-3)];

    const chip = (id, text, on, action) => div().id(id).px(9).h(24).flex().items_center().rounded(6).text_size(11.5).cursor_pointer()
      .bg(on ? t.selected : "#00000000").text_color(on ? t.foreground : t.muted).hover((x) => x.bg(t.hover))
      .on_click(action).child(text);

    const meta = [];
    if (kind === "diff" && this.diffData) meta.push(`+${this.diffData.added} −${this.diffData.removed}`);
    else if (this.lines != null && kind !== "image") meta.push(`${this.lines} lines`, human(this.size));
    else if (this.px) meta.push(`${this.px.w} × ${this.px.h}`);

    const header = h_flex().h(42).flex_none().px(12).gap(10).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .child(div().px(6).h(20).flex().items_center().rounded(5).bg(withAlpha(glyphColor, "26")).text_color(glyphColor).text_size(10.5).font_semibold().child(glyph))
      .child(h_flex().flex_1().min_w(0).gap(4).items_center().text_size(12.5).truncate()
        .when(Boolean(root), (el) => el.child(div().text_color(t.dim).child(root)).child(div().text_color(t.dim).child("›")))
        .children(parts.flatMap((d, i) => [div().id(`crumb-${i}`).text_color(t.muted).child(d), div().text_color(t.dim).child("›")]))
        .child(div().font_semibold().text_color(t.foreground).child(file ?? "")))
      .when(Boolean(this.on), (el) => el.child(div().px(7).h(20).flex().items_center().rounded(10).border_1().border_color(t.border).text_size(11).text_color(t.muted).child(this.on)))
      .when(meta.length > 0, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(meta.join(" · "))))
      .when(kind === "markdown", (el) => el.child(h_flex().p(2).gap(2).rounded(8).bg(t.raised)
        .child(chip("mode-rendered", "Rendered", this.mode === "rendered", (_e, cx) => { if (this.mode !== "rendered") this.toggleMode(cx); }))
        .child(chip("mode-source", "Source", this.mode === "source", (_e, cx) => { if (this.mode !== "source") this.toggleMode(cx); }))))
      .when(Boolean(this.editor) && (kind === "code" || kind === "text" || this.mode === "source"), (el) => el.child(
        chip("wrap", "Wrap", this.wrap, (_e, cx) => { this.wrap = !this.wrap; this.editor.set_soft_wrap(this.wrap); cx.notify(); })))
      .when(Boolean(this.rule), (el) => el.child(div().id("external").px(10).h(26).flex().items_center().gap(6).rounded(7)
        .border_1().border_color(t.input).bg(t.raised).text_size(12).cursor_pointer().hover((x) => x.bg(t.hover))
        .on_click((_e, cx) => this.openExternal(cx)).child(`Open in ${this.rule.app}`).child(div().text_color(t.dim).child("↗"))));

    let body;
    if (this.message) {
      body = v_flex().flex_1().items_center().justify_center().gap(6).text_color(t.dim)
        .child(div().text_size(28).child(glyph)).child(div().text_size(13).child(this.message));
    } else if (kind === "markdown" && this.mode === "rendered" && this.text != null) {
      body = div().id("md-scroll").flex_1().min_h(0).overflow_y_scrollbar()
        .child(v_flex().w_full().max_w(880).px(32).py(24).text_size(14).child(TextView.markdown(`md-${this.id}`, this.text).selectable(true)));
    } else if (kind === "image" && this.image) {
      const box = this.box ?? { width: 800, height: 600 };
      const z = s.zoom ?? 1;
      let w = this.px?.w ?? 400, h = this.px?.h ?? 300;
      const scale = Math.min((box.width / z - 48) / w, (box.height / z - 48) / h, 2);
      w = Math.max(1, Math.floor(w * scale)); h = Math.max(1, Math.floor(h * scale));
      body = v_flex().id("img-box").flex_1().min_h(0).w_full().items_center().justify_center()
        .on_size_change((size, cx) => { this.box = size; cx.notify(); })
        .child(div().rounded(8).overflow_hidden().border_1().border_color(t.border).child(image(this.image).w(w).h(h)));
    } else if (kind === "diff" && this.diffData) {
      body = this.renderDiff(t, s);
    } else if (this.editor) {
      body = Editor.new(this.editor).font_family(s.font_family).text_size(s.font_size).flex_1().min_h(0);
    } else {
      body = div().flex_1().p(16).text_color(t.dim).child("Loading…");
    }

    return v_flex().id("viewer").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(header)
      .child(body)
      .when(Boolean(this.cut), (el) => el.child(div().h(26).flex_none().px(12).flex().items_center().border_t(1).border_color(t.border)
        .text_size(11.5).text_color(t.dim).child("Showing the first 2 MB of this file")))
      .when(Boolean(this.configError), (el) => el.child(div().h(26).flex_none().px(12).flex().items_center().border_t(1).border_color(t.border)
        .text_size(11.5).text_color(t.blocked).child(this.configError)));
  }

  renderDiff(t, s) {
    const tint = { add: withAlpha(t.ansi2, "1f"), del: withAlpha(t.ansi1, "1f") };
    const fg = { add: t.ansi2, del: t.ansi1, hunk: t.ansi4, meta: t.dim, note: t.dim, ctx: t.foreground };
    const rows = this.diffData.rows.slice(0, 5000);
    return div().id("diff-scroll").flex_1().min_h(0).overflow_y_scrollbar().font_family(s.font_family).text_size(s.font_size)
      .child(v_flex().w_full().py(6).children(rows.map((r, i) => {
        if (r.kind === "meta") return null;
        const row = h_flex().id(`d-${i}`).w_full().min_h(20).items_center();
        if (r.kind === "hunk") {
          return row.mt(i ? 8 : 0).px(12).bg(t.raised).text_color(fg.hunk).child(div().truncate().child(r.text));
        }
        return row.when(Boolean(tint[r.kind]), (el) => el.bg(tint[r.kind]))
          .child(div().w(44).flex_none().pr(8).text_right().text_color(t.dim).child(r.old == null ? "" : String(r.old)))
          .child(div().w(44).flex_none().pr(8).text_right().text_color(t.dim).child(r.new == null ? "" : String(r.new)))
          .child(div().w(16).flex_none().text_color(fg[r.kind]).child(r.kind === "add" ? "+" : r.kind === "del" ? "−" : ""))
          .child(div().flex_1().min_w(0).text_color(r.kind === "ctx" ? t.foreground : fg[r.kind]).child(r.text || " "));
      }).filter(Boolean)));
  }
}
