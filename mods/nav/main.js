// nav (spec 002): the folder the focused terminal is in, on whichever machine, with a
// light that says whether it is following. Browsable by mouse and keyboard; files open
// in cria-file-preview. No file operations: those are asked of the agent.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { exec, watchFolder, window, theme, settings, home, notify, nextCommand, checking, shared, setShared, props, openOverlay, closeOverlay } from "herdr";
import { breadcrumb, parentOf, childOf, parseListing, sortEntries, filterEntries, parsePorcelain, marksFor, keyAction } from "./lib/nav.js";
import { fileType } from "./lib/filetype.js";
import { openExternal, openDefault, externalRule } from "./lib/external-open.js";
import { editFile } from "./lib/edit-open.js";
import { openInViewer } from "./lib/open.js";
import { terminalLocation, fallbackLocation, shownSpace } from "./lib/location.js";
import { SpaceLocks } from "./lib/space-locks.js";

const PER_FOLDER = 500;
const REMOTE_POLL = 5000;
const ROW = 26;
const CELL = 240; // a grid cell's width in the horizontal layout
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

export default class Nav extends View {
  init(_props, cx) {
    if (props()?.menu) { this.initMenu(cx); return; }
    this.copyId = Math.random().toString(36).slice(2); // for its context menu's requests
    this.follow = true;
    this.path = null; this.on = null; this.space = null;
    this.entries = []; this.overflow = false; this.error = null;
    this.marks = { files: {}, folders: {} }; this.repo = null; this.branch = null; this.dirty = 0;
    this.showHidden = false; this.selected = null; this.query = "";
    this.handle = cx.focus_handle();
    // Agent requests (005) newer than this are carried out: a copy that starts just after
    // one (first shown, or reloaded) still takes a request from the last 10 s.
    this.requestAt = Date.now() - 10000;
    this.locks = new SpaceLocks(shownSpace());
    this.scroll = ScrollHandle.new();
    this.filter = InputState.new({ placeholder: "Filter" });
    this.filter.on("change", (_e, cx) => { this.query = this.filter.value(); this.keepSelection(); cx.notify(); });
    this.filter.on("submit", (_e, cx) => { this.filtering = false; this.handle.focus(); cx.notify(); });
    this.last = terminalLocation() ?? fallbackLocation();
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
    const loc = terminalLocation() ?? this.last ?? fallbackLocation();
    if (loc) this.go(loc.cwd, loc.on, cx, { space: loc.space });
    cx.notify();
  }

  // Not following is per space (#8): entering a space shows the folder locked there, or
  // follows its terminal.
  enterSpace(cx) {
    const held = this.follow ? null : { path: this.path, on: this.on, space: this.space, select: this.selected };
    const lock = this.locks.enter(shownSpace(), held);
    if (lock === undefined) return;
    this.follow = !lock;
    const loc = lock ? null : terminalLocation() ?? fallbackLocation();
    if (lock) this.go(lock.path, lock.on, cx, { space: lock.space, select: lock.select });
    else if (loc) this.go(loc.cwd, loc.on, cx, { space: loc.space });
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

  // An agent's request (spec 005 via dock-follow's inbox): nav, reveal or follow.
  takeRequest(cx) {
    const q = shared("nav.request");
    if (!q || q.at <= this.requestAt) return;
    this.requestAt = q.at;
    // Carried out from a timer, not inside render (where cx.notify() throws).
    cx.timer.after(1, (cx) => { this.carryOut(q, cx); cx.notify(); });
  }

  carryOut(q, cx) {
    const reveal = q.action === "reveal";
    const lock = q.action === "follow" ? null : {
      path: reveal ? parentOf(q.path) : q.path, on: q.on ?? null, space: q.space ?? this.space,
      select: reveal ? q.path.split(/[\\/]/).filter(Boolean).pop() : null,
    };
    // A request from a terminal in another space waits there (#8).
    if (q.space && q.space !== this.locks.space) { this.locks.set(q.space, lock); return; }
    if (!lock) { this.relock(cx); return; }
    this.follow = false;
    this.go(lock.path, lock.on, cx, { select: lock.select });
  }

  // ---- the context menu (a popup copy of this mod) ------------------------------
  // props: { menu: true, path, on, dir, repo, from }. "Open" goes back to the copy
  // it came from (`from`), which owns the viewer bookkeeping; the rest act here.

  initMenu(cx) {
    const p = props();
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (!p.dir) cx.spawn(async (cx) => { this.rule = await externalRule(p.path, p.on ?? null); cx.notify(); });
  }

  menuItems() {
    const p = props();
    const on = p.on ?? null;
    const copy = (text, what) => (cx) => { cx.write_to_clipboard(text); notify({ title: `${what} copied`, body: text, level: "success", timeout: 2000 }); };
    const open = () => setShared("nav.menu", { from: p.from, action: p.dir ? "browse" : "view", path: p.path, on, at: Date.now() });
    const items = p.dir
      ? [{ label: "Open", act: open }, { label: "Open with default app", act: () => openDefault(p.path, on) }]
      : [
          { label: "Open", act: open },
          { label: "Edit", act: () => editFile({ path: p.path, on }) },
          ...(this.rule && this.rule.app !== "default app" ? [{ label: `Open in ${this.rule.app}`, act: () => openExternal(p.path, on) }] : []),
          { label: "Open with default app", act: () => openDefault(p.path, on) },
        ];
    items.push({ sep: true }, { label: "Copy path", act: copy(p.path, "Path") });
    if (p.repo && p.path.startsWith(p.repo + "/")) items.push({ label: "Copy path from repository root", act: copy(p.path.slice(p.repo.length + 1), "Relative path") });
    return items;
  }

  choose(it, cx) {
    if (!it || it.sep || this.busy) return;
    this.busy = true;
    const overlay = props()?.overlay;
    // Run the entry, then close: closing the popup cancels its pending calls.
    cx.spawn(async (cx) => { try { await it.act(cx); } finally { closeOverlay(overlay); } });
  }

  renderMenu() {
    const t = theme();
    const items = this.menuItems();
    const real = items.map((it, k) => (it.sep ? -1 : k)).filter((k) => k >= 0);
    if (!real.includes(this.at)) this.at = real[0] ?? 0;
    return v_flex().id("nav-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_color(t.foreground).text_size(12.8)
      .on_key_down((e, cx) => {
        const pos = real.indexOf(this.at);
        if (e.key === "down") this.at = real[(pos + 1) % real.length];
        else if (e.key === "up") this.at = real[(pos - 1 + real.length) % real.length];
        else if (e.key === "enter") this.choose(items[this.at], cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(items.map((it, k) => it.sep
        ? div().mx(7).my(4).h(1).bg(t.border)
        : h_flex().id(`nav-mi-${k}`).h(30).px(9).rounded(6).items_center()
            .when(k === this.at, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover)).cursor_pointer()
            .on_click((_e, cx) => this.choose(it, cx))
            .child(div().flex_1().truncate().child(it.label))));
  }

  // A menu's "Open" for this copy: view a file, or browse into a folder.
  takeMenu(cx) {
    const q = shared("nav.menu");
    if (!q || q.from !== this.copyId || q.at <= (this.menuAt ?? 0)) return;
    this.menuAt = q.at;
    if (q.action === "browse") this.browse(q.path, cx);
    else openInViewer(cx, { path: q.path, on: q.on, space: this.space ?? undefined });
  }

  openMenu(entry) {
    const full = childOf(this.path, entry.name);
    openOverlay({ mod: "nav", kind: "popup", width: 250,
      props: { menu: true, path: full, on: this.on, dir: entry.dir, repo: this.repo ?? null, from: this.copyId } });
  }

  render(cx) {
    if (props()?.menu) return this.renderMenu();
    this.takeMenu(cx);
    this.enterSpace(cx);
    this.takeRequest(cx);
    // Following: a focus change, tab switch or cd moves nav; a mod pane or dock block does not.
    const loc = terminalLocation();
    if (loc) this.last = loc;
    if (this.follow && loc && (loc.cwd !== this.path || loc.on !== this.on)) this.go(loc.cwd, loc.on, cx, { space: loc.space });

    const t = theme();
    // Horizontal in a wide, short block (the bottom dock), vertical otherwise (R14).
    const zoom = settings().zoom ?? 1;
    const wide = Boolean(this.size) && this.size.width / zoom > 1.8 * (this.size.height / zoom);
    const crumbs = this.path ? breadcrumb(this.path, this.home) : [];
    const rows = this.rows();
    const lit = this.follow;

    const light = div().id("nav-follow").size(14).flex_none().rounded(7).cursor_pointer()
      .border_2().border_color(lit ? t.accent : t.dim).when(lit, (el) => el.bg(t.accent))
      .tooltip(lit ? "Following the focused terminal (click: stay here)" : "Not following (click or F: follow the focused terminal)")
      .on_click((_e, cx) => { if (this.follow) { this.follow = false; cx.notify(); } else this.relock(cx); });

    const pill = div().px(7).h(20).flex().flex_none().items_center().rounded(10).border_1().border_color(t.border).text_size(11).text_color(t.muted)
      .child(this.on ?? "local");
    const branchChip = this.branch && h_flex().flex_none().gap(5).items_center().px(7).h(20).rounded(10).bg(t.raised).text_size(11.5)
      .child(div().text_color(t.muted).child("⎇"))
      .child(div().max_w(160).truncate().child(this.branch))
      .when(this.dirty > 0, (el) => el.child(div().size(7).rounded(4).bg(t.blocked)));
    const crumbRow = h_flex().gap(2).items_center().text_size(12.5).when(!wide, (el) => el.flex_wrap()).when(wide, (el) => el.flex_1().min_w(0).overflow_hidden())
      .children(crumbs.flatMap((c, i) => {
        const last = i === crumbs.length - 1;
        const seg = div().id(`nav-crumb-${i}`).flex_none().px(4).rounded(4).cursor_pointer().hover((s) => s.bg(t.hover))
          .text_color(last ? t.foreground : t.muted).when(last, (el) => el.font_semibold())
          .on_click((_e, cx) => this.browse(c.path, cx)).child(c.label);
        return i ? [div().flex_none().text_color(t.dim).child("›"), seg] : [seg];
      }));
    const header = wide
      ? h_flex().flex_none().h(34).px(10).gap(8).items_center().border_b(1).border_color(t.border)
        .child(light).child(pill).child(crumbRow).when(Boolean(branchChip), (el) => el.child(branchChip))
      : v_flex().flex_none().px(10).pt(8).pb(6).gap(6).border_b(1).border_color(t.border)
        .child(h_flex().gap(8).items_center().child(light).child(pill).child(div().flex_1()).when(Boolean(branchChip), (el) => el.child(branchChip)))
        .child(crumbRow);

    const mark = { M: t.blocked, A: t.ansi2, D: t.ansi1, U: t.ansi1, "?": t.ansi2 };
    const row = (e, i) => {
      const sel = e.name === this.selected;
      const kind = e.dir ? "folder" : fileType(e.name).kind;
      const tint = e.dir ? t.ansi4 : kind === "markdown" ? t.ansi6 : kind === "image" ? t.ansi3 : t.muted;
      const m = e.dir ? null : this.marks.files[e.name];
      const count = e.dir ? this.marks.folders[e.name] : 0;
      return h_flex().id(`nav-row-${i}`).h(ROW).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer().when(wide, (el) => el.w(CELL))
        .when(sel, (el) => el.bg(t.selected)).hover((s) => s.bg(sel ? t.selected : t.hover))
        // A click right after a right-click is the same press: the menu, not "open".
        .on_click((_e, cx) => { if (Date.now() - (this.rightAt ?? 0) < 500) return; this.selected = e.name; this.activate(e, cx); cx.notify(); })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.rightAt = Date.now(); this.selected = e.name; this.openMenu(e); cx.notify(); })
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
          : wide
            ? h_flex().id("nav-list").flex_1().min_h(0).p(4).flex_wrap().content_start().items_start().overflow_y_scrollbar().track_scroll(this.scroll).children(rows.map(row))
            : v_flex().id("nav-list").flex_1().min_h(0).p(4).overflow_y_scrollbar().track_scroll(this.scroll).children(rows.map(row));

    const footer = h_flex().h(28).flex_none().px(10).gap(8).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
      .when(this.filtering || Boolean(this.query), (el) => el.child(Input.new(this.filter).flex_1().h(22).px(6).rounded(5).border_1().border_color(t.input).bg(t.background).text_size(12)))
      .when(!this.filtering && !this.query, (el) => el
        .child(div().flex_1().child(`${rows.length}${this.overflow ? "+" : ""} items${this.showHidden ? " · hidden shown" : ""}`))
        .child(div().child("/ filter · . hidden · F follow")));

    return v_flex().id("nav").track_focus(this.handle)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
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
