// nav (spec 002): the folder the focused terminal is in, on whichever machine, with a
// light that says whether it is following. Browsable by mouse and keyboard; files open
// in cria-file-preview. No file operations: those are asked of the agent.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { spaces, panes, focused, terminals, exec, watchFolder, window, theme, settings, home, notify, nextCommand, checking } from "herdr";
import { breadcrumb, parentOf, childOf, parseListing, sortEntries, filterEntries, parsePorcelain, marksFor, keyAction } from "./lib/nav.js";
import { fileType } from "./lib/filetype.js";
import { openExternal, openDefault } from "./lib/external-open.js";
import { openInViewer } from "./lib/open.js";

const PER_FOLDER = 500;
const REMOTE_POLL = 5000;
const ROW = 26;
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];

// NUL-separated kind/name pairs, .git skipped, one past the cap so overflow shows.
// (The listing contract of Herdr's shipped files mod and munza/better-files.)
const LIST_SH = `n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=\${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt ${PER_FOLDER} ] && break; done; test -d "$1"`;
// The same contract in PowerShell, for Windows (no sh there). Output as UTF-8.
const LIST_PS = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$p = $args[0]; if (-not [IO.Directory]::Exists($p)) { [Console]::Error.WriteLine('Not a folder'); exit 1 }
$n = 0; $out = [Text.StringBuilder]::new()
foreach ($e in [IO.Directory]::EnumerateFileSystemEntries($p)) {
  $name = [IO.Path]::GetFileName($e); if ($name -eq '.git') { continue }
  $k = if ([IO.Directory]::Exists($e)) { 'd' } else { 'f' }
  [void]$out.Append($k).Append([char]0).Append($name).Append([char]0)
  $n++; if ($n -gt ${PER_FOLDER}) { break }
}
[Console]::Out.Write($out.ToString())`;

// Per machine: { platform, home }. "" is this computer.
const machineCache = new Map();
async function machineOf(on) {
  const known = machineCache.get(on ?? "");
  if (known) return known;
  let info;
  if (!on) info = { platform: window()?.platform ?? "macos", home: home() };
  else {
    try {
      const r = await exec("sh", ["-c", 'uname -s; printf "%s" "$HOME"'], { on });
      const [os, h] = r.stdout.split("\n");
      info = { platform: os.trim() === "Darwin" ? "macos" : "linux", home: (h ?? "").trim() };
    } catch {
      const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::Out.Write($env:USERPROFILE)"], { on });
      info = { platform: "windows", home: r.stdout.trim() };
    }
  }
  machineCache.set(on ?? "", info);
  return info;
}

// The focused tab pane's terminal folder. Layout blocks (dock shells, the usage strip)
// and mod panes (nav itself, git, a viewer) do not count: following keeps the last one.
function terminalLocation() {
  const f = focused();
  if (!f?.pane) return null;
  const pane = panes().find((p) => p.pane === f.pane);
  if (!pane?.terminal) return null;
  let cwd = pane.cwd;
  if (f.shown && f.shown !== pane.terminal) {
    const shown = terminals().find((t) => t.address === f.shown || t.id === f.shown);
    cwd = shown?.cwd ?? cwd;
  }
  if (!cwd) return null;
  const space = spaces().find((s) => s.id === f.space) ?? spaces().find((s) => s.active);
  return { cwd, on: space?.machine ?? null, space: space?.id ?? null };
}

export default class Nav extends View {
  init(_props, cx) {
    this.follow = true;
    this.path = null; this.on = null; this.space = null;
    this.entries = []; this.overflow = false; this.error = null;
    this.marks = { files: {}, folders: {} }; this.repo = null; this.branch = null; this.dirty = 0;
    this.showHidden = false; this.selected = null; this.query = "";
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.filter = InputState.new({ placeholder: "Filter" });
    this.filter.on("change", (_e, cx) => { this.query = this.filter.value(); this.keepSelection(); cx.notify(); });
    this.filter.on("submit", (_e, cx) => { this.filtering = false; this.handle.focus(); cx.notify(); });
    this.last = terminalLocation();
    if (this.last) this.go(this.last.cwd, this.last.on, cx, { space: this.last.space });
    if (checking()) return;
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) !== "focus") continue;
        this.handle.focus();
        // Focus can arrive before the copy is ready to take it (as pond-files found).
        cx.timer.after(150, () => this.handle.focus());
        cx.notify();
      }
    });
    cx.timer.every(REMOTE_POLL, (cx) => { if (this.on && window()?.visible !== false) this.load(cx); });
  }

  close() { this.watch?.cancel(); }

  // Point nav at a folder. Following stays as it is; browsing calls browse() instead.
  go(path, on, cx, { space = this.space, select = null } = {}) {
    const moved = path !== this.path || on !== this.on;
    this.path = path; this.on = on; this.space = space;
    if (moved) {
      this.entries = []; this.error = null; this.repo = undefined; this.query = "";
      this.selected = select;
      this.watchHere(cx);
    } else if (select) this.selected = select;
    this.load(cx);
  }

  browse(path, cx, select = null) {
    this.follow = false;
    this.go(path, this.on, cx, { select });
  }

  relock(cx) {
    this.follow = true;
    const loc = terminalLocation() ?? this.last;
    if (loc) this.go(loc.cwd, loc.on, cx, { space: loc.space });
    cx.notify();
  }

  watchHere(cx) {
    this.watch?.cancel();
    this.watch = null;
    if (this.on || checking()) return;
    const path = this.path;
    cx.spawn(async (cx) => {
      try {
        while (this.path === path && !this.on) {
          this.watch = watchFolder(path);
          const changed = await this.watch;
          if (!changed.length || this.path !== path) return;
          this.load(cx);
        }
      } catch { /* the 5 s refresh of a shown copy is not running locally; reopen to retry */ }
    });
  }

  load(cx) {
    if (!this.path) return;
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    const path = this.path, on = this.on;
    cx.spawn(async (cx) => {
      try {
        const m = await machineOf(on);
        this.home = m.home;
        const r = m.platform === "windows"
          ? await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", `& { ${LIST_PS} } '${path.replace(/'/g, "''")}'`], { on })
          : await exec("sh", ["-c", LIST_SH, "nav", path], { on });
        if (this.path !== path || this.on !== on) return;
        if (r.code !== 0) { this.error = (r.stderr || "Cannot list this folder").trim(); this.entries = []; }
        else {
          const { entries, overflow } = parseListing(r.stdout, PER_FOLDER);
          this.entries = entries; this.overflow = overflow; this.error = null;
        }
        await this.loadGit(path, on);
        this.keepSelection();
      } catch (e) {
        if (this.path === path) this.error = String(e?.message ?? e);
      } finally {
        this.loading = false;
        cx.notify();
        if (this.again) { this.again = false; this.load(cx); }
      }
    });
  }

  async loadGit(path, on) {
    if (this.repo === undefined) {
      const top = await exec("git", [...READ, "-C", path, "rev-parse", "--show-toplevel"], { on }).catch(() => null);
      this.repo = top?.code === 0 ? top.stdout.trim() : null;
    }
    if (!this.repo) { this.marks = { files: {}, folders: {} }; this.branch = null; this.dirty = 0; return; }
    const r = await exec("git", [...READ, "-C", this.repo, "status", "--porcelain=v1", "-z", "--no-renames", "-b", "--untracked-files=normal"], { on }).catch(() => null);
    if (r?.code !== 0) return;
    const [head, ...rest] = r.stdout.split("\0");
    this.branch = head.startsWith("## ") ? head.slice(3).replace(/\.\.\..*$/, "").replace(/^No commits yet on /, "") : null;
    const changes = parsePorcelain(rest.join("\0"));
    this.dirty = changes.length;
    this.marks = marksFor(changes, this.repo, path);
  }

  // The rows shown: sorted, hidden files as chosen, filtered.
  rows() {
    return filterEntries(sortEntries(this.entries, this.showHidden), this.query);
  }

  keepSelection() {
    const rows = this.rows();
    if (!rows.some((e) => e.name === this.selected)) this.selected = rows[0]?.name ?? null;
  }

  move(by, cx) {
    const rows = this.rows();
    if (!rows.length) return;
    let i = rows.findIndex((e) => e.name === this.selected);
    i = by === Infinity ? rows.length - 1 : by === -Infinity ? 0 : Math.max(0, Math.min(rows.length - 1, (i < 0 ? 0 : i) + by));
    this.selected = rows[i].name;
    this.scroll.scroll_to_item(i);
    cx.notify();
  }

  activate(entry, cx) {
    if (!entry) return;
    const full = childOf(this.path, entry.name);
    if (entry.dir) this.browse(full, cx);
    else openInViewer(cx, { path: full, on: this.on, space: this.space ?? undefined });
  }

  act(action, cx) {
    const rows = this.rows();
    const entry = rows.find((e) => e.name === this.selected);
    switch (action) {
      case "down": this.move(1, cx); break;
      case "up": this.move(-1, cx); break;
      case "top": this.move(-Infinity, cx); break;
      case "bottom": this.move(Infinity, cx); break;
      case "open": this.activate(entry, cx); break;
      case "parent": {
        const here = this.path, up = parentOf(here);
        if (up !== here) this.browse(up, cx, here.split(/[\\/]/).filter(Boolean).pop());
        break;
      }
      case "hidden": this.showHidden = !this.showHidden; this.keepSelection(); cx.notify(); break;
      case "follow": this.relock(cx); break;
      case "filter": this.filtering = true; this.filter.focus(); cx.notify(); break;
      case "escape":
        if (this.query) { this.query = ""; this.filter.set_value(""); this.keepSelection(); cx.notify(); }
        break;
      case "copy": if (entry) {
        const full = childOf(this.path, entry.name);
        cx.write_to_clipboard(full);
        notify({ title: "Path copied", body: full, level: "success", timeout: 2000 });
      } break;
      case "system": if (entry) openDefault(childOf(this.path, entry.name), this.on); break;
      case "external": if (entry && !entry.dir) openExternal(childOf(this.path, entry.name), this.on); break;
      default: return false;
    }
    return true;
  }

  render(cx) {
    // Following: a focus change, tab switch or cd moves nav; a mod pane or dock block does not.
    const loc = terminalLocation();
    if (loc) this.last = loc;
    if (this.follow && loc && (loc.cwd !== this.path || loc.on !== this.on)) this.go(loc.cwd, loc.on, cx, { space: loc.space });

    const t = theme();
    const crumbs = this.path ? breadcrumb(this.path, this.home) : [];
    const rows = this.rows();
    const lit = this.follow;

    const light = div().id("nav-follow").size(14).flex_none().rounded(7).cursor_pointer()
      .border_2().border_color(lit ? t.accent : t.dim).when(lit, (el) => el.bg(t.accent))
      .tooltip(lit ? "Following the focused terminal (click: stay here)" : "Not following (click or F: follow the focused terminal)")
      .on_click((_e, cx) => { if (this.follow) { this.follow = false; cx.notify(); } else this.relock(cx); });

    const header = v_flex().flex_none().px(10).pt(8).pb(6).gap(6).border_b(1).border_color(t.border)
      .child(h_flex().gap(8).items_center()
        .child(light)
        .child(div().px(7).h(20).flex().items_center().rounded(10).border_1().border_color(t.border).text_size(11).text_color(t.muted)
          .child(this.on ?? "local"))
        .child(div().flex_1())
        .when(Boolean(this.branch), (el) => el.child(h_flex().gap(5).items_center().px(7).h(20).rounded(10).bg(t.raised).text_size(11.5)
          .child(div().text_color(t.muted).child("⎇"))
          .child(div().max_w(160).truncate().child(this.branch))
          .when(this.dirty > 0, (el) => el.child(div().size(7).rounded(4).bg(t.blocked))))))
      .child(h_flex().flex_wrap().gap(2).items_center().text_size(12.5)
        .children(crumbs.flatMap((c, i) => {
          const last = i === crumbs.length - 1;
          const seg = div().id(`nav-crumb-${i}`).px(4).rounded(4).cursor_pointer().hover((s) => s.bg(t.hover))
            .text_color(last ? t.foreground : t.muted).when(last, (el) => el.font_semibold())
            .on_click((_e, cx) => this.browse(c.path, cx)).child(c.label);
          return i ? [div().text_color(t.dim).child("›"), seg] : [seg];
        })));

    const mark = { M: t.blocked, A: t.ansi2, D: t.ansi1, U: t.ansi1, "?": t.ansi2 };
    const row = (e, i) => {
      const sel = e.name === this.selected;
      const kind = e.dir ? "folder" : fileType(e.name).kind;
      const tint = e.dir ? t.ansi4 : kind === "markdown" ? t.ansi6 : kind === "image" ? t.ansi3 : t.muted;
      const m = e.dir ? null : this.marks.files[e.name];
      const count = e.dir ? this.marks.folders[e.name] : 0;
      return h_flex().id(`nav-row-${i}`).h(ROW).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .when(sel, (el) => el.bg(t.selected)).hover((s) => s.bg(sel ? t.selected : t.hover))
        .on_click((_e, cx) => { this.selected = e.name; this.activate(e, cx); cx.notify(); })
        .child(svg(`mods/nav/${e.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(tint))
        .child(div().flex_1().min_w(0).truncate().text_color(e.name.startsWith(".") ? t.muted : t.foreground).when(e.dir, (el) => el.font_medium()).child(e.name))
        .when(Boolean(m), (el) => el.child(div().w(14).flex_none().text_size(11).font_semibold().text_color(mark[m] ?? t.muted).child(m)))
        .when(count > 0, (el) => el.child(div().flex_none().px(5).rounded(6).bg(t.raised).text_size(10.5).text_color(t.blocked).child(String(count))));
    };

    const body = this.error
      ? div().p(12).text_size(12).text_color(t.dim).child(this.error)
      : !this.path
        ? div().p(12).text_size(12).text_color(t.dim).child("Focus a terminal to show its folder")
        : !rows.length
          ? div().p(12).text_size(12).text_color(t.dim).child(this.loading ? "Loading…" : this.query ? "Nothing matches" : "Empty folder")
          : v_flex().id("nav-list").flex_1().min_h(0).p(4).overflow_y_scrollbar().track_scroll(this.scroll).children(rows.map(row));

    const footer = h_flex().h(28).flex_none().px(10).gap(8).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
      .when(this.filtering || Boolean(this.query), (el) => el.child(Input.new(this.filter).flex_1().h(22).px(6).rounded(5).border_1().border_color(t.input).bg(t.background).text_size(12)))
      .when(!this.filtering && !this.query, (el) => el
        .child(div().flex_1().child(`${rows.length}${this.overflow ? "+" : ""} items${this.showHidden ? " · hidden shown" : ""}`))
        .child(div().child("/ filter · . hidden · F follow")));

    return v_flex().id("nav").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (this.filtering && e.key !== "escape") return;
        if (this.filtering) { this.filtering = false; this.query = ""; this.filter.set_value(""); this.filter.blur(); this.handle.focus(); this.keepSelection(); cx.notify(); cx.stop_propagation(); return; }
        const action = keyAction(e);
        if (action && this.act(action, cx)) cx.stop_propagation();
      })
      .size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(header).child(body).child(footer);
  }
}
