// git (spec 003): the focused terminal's repository at a glance — branch and upstream
// distance, its worktrees with a light per agent working in each, the pending changes as
// lazygit groups them, and a short set of lazygit keys. Writes are refused while an agent
// works in the shown worktree. Diffs and files open in cria-file-preview.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, hc, watchFolder, window, theme, settings, terminals, notify, nextCommand, checking, run, shared } from "herdr";
import {
  READ, parseStatus, parseNumstat, parseWorktrees, worktreeOf, placeAgent, lockedBy, within, WORKTREE_LABEL,
  indexWorktrees, visibleWorktrees,
  stageArgs, unstageArgs, stageAllArgs, unstageAllArgs, commitArgs, pullArgs, pushArgs, fetchArgs,
  LOG_FORMAT, parseLog, ago, gitKeyAction, WRITES, COMMIT_FORMAT, parseCommit, parseCommitFiles,
} from "./lib/git.js";
import { openInViewer } from "./lib/open.js";
import { editFile } from "./lib/edit-open.js";
import { terminalLocation, fallbackLocation } from "./lib/location.js";

const REMOTE_POLL = 5000;
const AGENT_POLL = 3000;
const ROW = 24;
const LONG = 120000; // pull, push, fetch
const RECENT = 50;  // commits in the Recent pane (R8)
const WT_CAP = 12;  // worktree rows shown unless "show all" (R3)
// One sh round trip for the changed-file count of several worktrees: "<path>\t<n>" lines.
const COUNTS_SH = 'for w; do n=$(git -C "$w" --no-optional-locks -c core.fsmonitor=false status --porcelain=v1 --untracked-files=normal 2>/dev/null | wc -l) && printf "%s\\t%s\\n" "$w" "$n"; done';
// Pane sizes in px (R15): horizontal column widths, vertical section heights. Dragged
// by the dividers between them; remembered in localStorage.
const SIZES = "git.sizes";
const SIZE_DEFAULTS = { wt: 300, recent: 320, wtH: 150, recentH: 140 };
const SIZE_LIMITS = { wt: [140, 900], recent: [140, 900], wtH: [60, 900], recentH: [60, 900] };

const join = (dir, rel) => `${dir.replace(/[\\/]+$/, "")}/${rel}`;
const base = (p) => String(p ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop();

// Agents on `on` (null: this computer): terminal records whose program is an agent.
function agentsOn(on) {
  return terminals().filter((t) => {
    const remote = String(t.address ?? "").includes("/");
    const machine = remote ? t.address.split("/")[0] : null;
    return machine === (on ?? null) && (t.program?.agent || (t.agent && t.agent !== "zsh" && t.agent !== "sh" && t.agent !== "env"));
  });
}

export default class Git extends View {
  init(_props, cx) {
    this.follow = true;
    this.loc = null; this.root = null; this.worktrees = []; this.shown = null;
    this.status = null; this.numstat = { staged: {}, unstaged: {} }; this.log = []; this.counts = {};
    this.error = null; this.busy = null; this.zone = "changes"; this.cursor = 0; this.wtCursor = 0;
    this.collapsed = {}; this.help = false; this.programs = new Map();
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SIZES) ?? "{}") ?? {}; } catch { /* defaults */ }
    this.sizes = { ...SIZE_DEFAULTS, ...saved };
    this.drag = null;
    this.handle = cx.focus_handle();
    // Agent requests (005) newer than this are carried out: a copy that starts just after
    // one (first shown, or reloaded) still takes a request from the last 10 s.
    this.requestAt = Date.now() - 10000;
    this.message = InputState.new({ placeholder: "Commit message (Enter commits, Esc cancels)" });
    this.message.on("submit", (_e, cx) => this.commitNow(cx));
    this.last = terminalLocation() ?? fallbackLocation();
    if (this.last) this.goTo(this.last, cx);
    if (checking()) return;
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) !== "focus") continue;
        this.handle.focus();
        cx.timer.after(150, () => this.handle.focus());
      }
    });
    cx.timer.every(REMOTE_POLL, (cx) => { if (this.loc?.on && window()?.visible !== false) this.refresh(cx); });
    cx.timer.every(AGENT_POLL, (cx) => { if (window()?.visible !== false) this.readPrograms(cx); });
  }

  close() { this.watch?.cancel(); }

  goTo(loc, cx) {
    const moved = !this.loc || loc.cwd !== this.loc.cwd || loc.on !== this.loc.on;
    this.loc = loc;
    if (moved) { this.root = undefined; this.watchHere(cx); }
    this.refresh(cx);
  }

  relock(cx) {
    this.follow = true;
    const loc = terminalLocation() ?? this.last ?? fallbackLocation();
    if (loc) this.goTo(loc, cx);
    cx.notify();
  }

  git(args, opts = {}) {
    return exec("git", args, { on: this.loc?.on ?? null, ...opts });
  }

  watchHere(cx) {
    this.watch?.cancel();
    this.watch = null;
    if (!this.loc || this.loc.on || checking()) return;
    const loc = this.loc;
    cx.spawn(async (cx) => {
      try {
        while (this.loc === loc) {
          // The shown worktree once known, else the folder: changes anywhere in it refresh.
          this.watch = watchFolder(this.shown ?? loc.cwd);
          const changed = await this.watch;
          if (!changed.length || this.loc !== loc) return;
          this.refresh(cx);
        }
      } catch { /* watch refused (Linux tree limit): r refreshes by hand */ }
    });
  }

  refresh(cx) {
    if (!this.loc) return;
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    const loc = this.loc;
    cx.spawn(async (cx) => {
      try {
        if (this.root === undefined) {
          const r = await this.git([...READ, "-C", loc.cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"]).catch(() => null);
          this.root = r?.code === 0 ? r.stdout.trim().replace(/[\\/]\.git[\\/]?$/, "") : null;
        }
        if (this.loc !== loc) return;
        if (!this.root) { this.error = null; this.worktrees = []; this.status = null; return; }
        const wt = await this.git([...READ, "-C", this.root, "worktree", "list", "--porcelain"]);
        this.worktrees = wt.code === 0 ? parseWorktrees(wt.stdout) : [{ path: this.root, main: true }];
        // Indexed once: repositories with many worktrees (80 in platform-backend) are
        // looked up on every render.
        this.index = indexWorktrees(this.worktrees);
        const here = this.index.lookup(loc.cwd);
        if (this.follow || !this.worktrees.some((w) => w.path === this.shown)) this.shown = here?.path ?? this.worktrees[0]?.path;
        await this.readShown();
        await this.readCounts();
        this.error = null;
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        this.loading = false;
        cx.notify();
        if (this.again) { this.again = false; this.refresh(cx); }
      }
    });
  }

  async readShown() {
    const w = this.shown;
    const [st, ns, nc, lg] = await Promise.all([
      this.git([...READ, "-C", w, "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=normal"]),
      this.git([...READ, "-C", w, "diff", "--numstat", "-z", "--no-ext-diff", "--no-textconv"]),
      this.git([...READ, "-C", w, "diff", "--cached", "--numstat", "-z", "--no-ext-diff", "--no-textconv"]),
      this.git([...READ, "-C", w, "log", `-n${RECENT}`, `--format=${LOG_FORMAT}`]),
    ]);
    if (st.code !== 0) throw new Error(st.stderr.trim() || "git status failed");
    this.status = parseStatus(st.stdout);
    this.numstat = { unstaged: parseNumstat(ns.stdout), staged: parseNumstat(nc.stdout) };
    this.log = lg.code === 0 ? parseLog(lg.stdout) : [];
  }

  // Changed-file counts for the worktree rows on screen only: one sh round trip
  // (one git per row on Windows, which has no sh).
  async readCounts() {
    const rows = this.stripRows().filter((w) => !w.prunable).map((w) => w.path);
    if (!rows.length) { this.counts = {}; return; }
    const counts = {};
    if (!this.loc?.on && window()?.platform === "windows") {
      await Promise.all(rows.map(async (p) => {
        const r = await this.git([...READ, "-C", p, "status", "--porcelain=v1", "-z", "--untracked-files=normal"]).catch(() => null);
        counts[p] = r?.code === 0 ? r.stdout.split("\0").filter(Boolean).length : null;
      }));
    } else {
      const r = await exec("sh", ["-c", COUNTS_SH, "counts", ...rows], { on: this.loc?.on ?? null }).catch(() => null);
      for (const line of (r?.stdout ?? "").split("\n")) {
        const tab = line.lastIndexOf("\t");
        if (tab > 0) counts[line.slice(0, tab)] = Number(line.slice(tab + 1).trim());
      }
    }
    this.counts = counts;
  }

  // The worktree rows the strip shows (R3): capped unless "show all".
  stripRows(placed = this.lastPlaced ?? {}) {
    const here = this.index?.lookup(this.last?.cwd)?.path ?? null;
    return visibleWorktrees(this.worktrees, { shown: this.shown, here, agents: placed, counts: this.counts, cap: WT_CAP, all: this.allWorktrees }).rows;
  }

  // Signals 1 and 2 (R5a): each agent's label and its program's own folder, both from
  // `hc get` (terminals(), like `hc ls`, carries no labels).
  readPrograms(cx) {
    if (!this.loc || this.readingPrograms) return;
    this.readingPrograms = true;
    cx.spawn(async (cx) => {
      try {
        let changed = false;
        for (const t of agentsOn(this.loc.on)) {
          const r = await hc(["get", t.address, "--json"]).catch(() => null);
          if (r?.code !== 0) continue;
          let got = null;
          try {
            const d = JSON.parse(r.stdout);
            got = { program: d?.foreground?.cwd ?? null, label: d?.labels?.[WORKTREE_LABEL] ?? null };
          } catch { /* not JSON */ }
          const had = this.programs.get(t.address);
          if (got && (had?.program !== got.program || had?.label !== got.label)) { this.programs.set(t.address, got); changed = true; }
        }
        if (changed) cx.notify();
      } finally { this.readingPrograms = false; }
    });
  }

  // The agents placed in each worktree: { [path]: [{ address, name, status, source }] }.
  placed() {
    const out = {};
    if (!this.worktrees.length || !this.loc) return out;
    for (const t of agentsOn(this.loc.on)) {
      const known = this.programs.get(t.address);
      const at = placeAgent({ label: known?.label ?? t.labels?.[WORKTREE_LABEL], program: known?.program, terminal: t.cwd }, this.index ?? this.worktrees);
      if (!at) continue;
      (out[at.worktree.path] ??= []).push({ address: t.address, name: t.program?.name ?? t.name ?? t.address, status: t.status, source: at.source });
    }
    return out;
  }

  // The rows of the change list, in order: [{ group, file }].
  items() {
    const s = this.status;
    if (!s) return [];
    const groups = [["Conflicts", s.conflicts], ["Staged", s.staged], ["Unstaged", s.unstaged], ["Untracked", s.untracked]];
    const out = [];
    for (const [group, files] of groups) if (!this.collapsed[group]) for (const file of files) out.push({ group, file });
    return out;
  }

  // Runs a writing git command in the shown worktree, unless an agent works there.
  write(label, args, cx, { long = false } = {}) {
    const lock = lockedBy(this.placed()[this.shown] ?? []);
    if (lock) {
      notify({ title: "Locked", body: `${lock.name} is working in this worktree`, level: "warning", timeout: 3000 });
      return;
    }
    if (this.busy) return;
    this.busy = label;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await this.git(["-C", this.shown, ...args], long ? { timeout: LONG } : {});
        const text = (r.code === 0 ? r.stdout || r.stderr : r.stderr || r.stdout).trim().split("\n").filter(Boolean);
        if (r.code === 0) { if (long || label === "Commit") notify({ title: `${label}: done`, body: text.at(-1) ?? "", level: "success", timeout: 3000 }); }
        else notify({ title: `${label} failed`, body: text.at(-1) ?? `git exited ${r.code}`, level: "error" });
      } catch (e) {
        notify({ title: `${label} failed`, body: String(e?.message ?? e), level: "error" });
      } finally {
        this.busy = null;
        this.refresh(cx);
      }
    });
  }

  commitNow(cx) {
    const msg = this.message.value().trim();
    this.committing = false;
    this.message.set_value("");
    this.message.blur();
    this.handle.focus();
    if (msg) this.write("Commit", commitArgs(msg), cx);
    cx.notify();
  }

  // ---- one commit (R8a): details, files, and diff / view / edit per file ----------

  openCommit(hash, cx) {
    const w = this.shown;
    this.commit = { hash, loading: true, info: null, files: [], cursor: 0 };
    cx.notify();
    cx.spawn(async (cx) => {
      const [info, names, nums] = await Promise.all([
        this.git([...READ, "-C", w, "show", "-s", `--format=${COMMIT_FORMAT}`, hash]),
        this.git([...READ, "-C", w, "show", "--format=", "--name-status", "-z", "--no-renames", hash]),
        this.git([...READ, "-C", w, "show", "--format=", "--numstat", "-z", "--no-renames", hash]),
      ]).catch((e) => [{ code: 1, stderr: String(e) }]);
      if (this.commit?.hash !== hash) return;
      if (info.code !== 0) { this.commit = { ...this.commit, loading: false, error: (info.stderr || "git show failed").trim() }; cx.notify(); return; }
      this.commit = { ...this.commit, loading: false, info: parseCommit(info.stdout), files: parseCommitFiles(names.stdout, nums.stdout) };
      cx.notify();
    });
  }

  commitFileAction(kind, f, cx) {
    const path = join(this.shown, f.path);
    const at = { on: this.loc.on, space: this.loc.space ?? undefined };
    if (kind === "diff") openInViewer(cx, { path, ...at, diff: { repo: this.shown, commit: this.commit.info?.hash ?? this.commit.hash } });
    else if (kind === "view") openInViewer(cx, { path, ...at });
    else editFile({ path, on: this.loc.on });
  }

  actCommit(action, cx) {
    const c = this.commit;
    const f = c.files[c.cursor];
    switch (action) {
      case "down": c.cursor = Math.min(c.files.length - 1, c.cursor + 1); break;
      case "up": c.cursor = Math.max(0, c.cursor - 1); break;
      case "diff": if (f) this.commitFileAction("diff", f, cx); break;
      case "open": if (f && f.code !== "D") this.commitFileAction("view", f, cx); break;
      case "edit": if (f && f.code !== "D") this.commitFileAction("edit", f, cx); break;
      case "escape": this.commit = null; break;
      case "help": this.help = !this.help; break;
      default: return false; // writes and the rest do nothing here
    }
    cx.notify();
    return true;
  }

  renderCommit(t) {
    const c = this.commit, i = c.info;
    const back = div().id("git-commit-back").px(8).h(24).flex().items_center().rounded(6).cursor_pointer().text_size(12)
      .text_color(t.muted).hover((x) => x.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { this.commit = null; cx.notify(); }).child("← Back");
    const chip = (id, label, act, enabled = true) => div().id(id).px(6).h(20).flex().items_center().rounded(5).text_size(11)
      .when(enabled, (el) => el.cursor_pointer().text_color(t.muted).bg(t.raised).hover((x) => x.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); act(cx); }))
      .when(!enabled, (el) => el.text_color(t.dim).opacity(0.5))
      .child(label);
    const codeColor = { M: t.blocked, A: t.ansi2, D: t.ansi1, R: t.ansi4, C: t.ansi4, T: t.blocked };
    const head = h_flex().flex_none().px(10).py(6).gap(10).items_center().border_b(1).border_color(t.border)
      .child(back)
      .child(div().font_family(settings().font_family).text_color(t.ansi4).child((i?.hash ?? c.hash).slice(0, 10)))
      .when(Boolean(i), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim)
        .child(`${i.author} · ${new Date(i.time * 1000).toLocaleString()} · ${ago(i.time)} ago`)));
    if (c.loading) return v_flex().flex_1().min_h(0).child(head).child(div().p(12).text_color(t.dim).child("Reading the commit…"));
    if (c.error) return v_flex().flex_1().min_h(0).child(head).child(div().p(12).text_color(t.ansi1).child(c.error));
    const rows = c.files.map((f, k) => {
      const slash = f.path.lastIndexOf("/");
      const cur = k === c.cursor, gone = f.code === "D";
      return h_flex().id(`git-cf-${k}`).h(26).px(10).mx(4).gap(8).items_center().rounded(6).cursor_pointer()
        .when(cur, (el) => el.bg(t.selected)).hover((x) => x.bg(cur ? t.selected : t.hover))
        .on_click((_e, cx) => { c.cursor = k; this.commitFileAction("diff", f, cx); cx.notify(); })
        .child(div().w(12).flex_none().font_semibold().text_size(11.5).text_color(codeColor[f.code] ?? t.muted).child(f.code))
        .child(h_flex().flex_1().min_w(0).gap(4).text_size(12.5)
          .child(div().flex_shrink(0).max_w(240).truncate().child(slash < 0 ? f.path : f.path.slice(slash + 1)))
          .when(slash >= 0, (el) => el.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(f.path.slice(0, slash)))))
        .when(f.added != null, (el) => el.child(h_flex().flex_none().gap(4).text_size(11)
          .child(div().text_color(t.ansi2).child(`+${f.added}`)).child(div().text_color(t.ansi1).child(`−${f.removed}`))))
        .child(h_flex().flex_none().gap(4)
          .child(chip(`git-cf-diff-${k}`, "diff", (cx) => this.commitFileAction("diff", f, cx)))
          .child(chip(`git-cf-view-${k}`, "view", (cx) => this.commitFileAction("view", f, cx), !gone))
          .child(chip(`git-cf-edit-${k}`, "edit", (cx) => this.commitFileAction("edit", f, cx), !gone)));
    });
    return v_flex().flex_1().min_h(0).child(head)
      .child(v_flex().id("git-commit-body").flex_1().min_h(0).overflow_y_scrollbar().pb(8)
        .child(v_flex().px(12).pt(10).pb(6).gap(6)
          .child(div().font_semibold().text_size(13.5).child(i.subject))
          .when(Boolean(i.body), (el) => el.child(div().text_size(12.5).text_color(t.muted).child(i.body))))
        .child(h_flex().h(22).px(10).mt(6).gap(6).items_center().text_size(10.5).font_semibold().text_color(t.dim)
          .child(div().child("FILES")).child(div().child(String(c.files.length)))
          .child(div().flex_1()).child(div().text_size(10.5).text_color(t.dim).child("enter diff · o view · e edit · esc back")))
        .children(rows));
  }

  act(action, cx) {
    if (this.commit) return this.actCommit(action, cx);
    const items = this.items();
    const sel = items[Math.min(this.cursor, items.length - 1)];
    if (WRITES.has(action)) {
      const lock = lockedBy(this.placed()[this.shown] ?? []);
      if (lock) { notify({ title: "Locked", body: `${lock.name} is working in this worktree`, level: "warning", timeout: 3000 }); return true; }
    }
    const hasHead = Boolean(this.status?.branch.oid);
    switch (action) {
      case "down": case "up": {
        const d = action === "down" ? 1 : -1;
        if (this.zone === "worktrees") this.wtCursor = Math.max(0, Math.min(this.stripRows().length - 1, this.wtCursor + d));
        else this.cursor = Math.max(0, Math.min(items.length - 1, this.cursor + d));
        cx.notify();
        return true;
      }
      case "worktrees": this.zone = this.zone === "worktrees" ? "changes" : "worktrees"; cx.notify(); return true;
      case "escape":
        if (this.help) this.help = false;
        else this.zone = "changes";
        cx.notify();
        return true;
      case "diff":
        if (this.zone === "worktrees") { this.showWorktree(this.stripRows()[this.wtCursor], cx); return true; }
        if (sel) this.openDiff(sel, cx);
        return true;
      case "open": if (sel) openInViewer(cx, { path: join(this.shown, sel.file.path.replace(/\/$/, "")), on: this.loc.on, space: this.loc.space ?? undefined }); return true;
      case "toggle":
        if (!sel) return true;
        this.write(sel.group === "Staged" ? "Unstage" : "Stage", sel.group === "Staged" ? unstageArgs([sel.file.path], hasHead) : stageArgs([sel.file.path]), cx);
        return true;
      case "all": {
        const s = this.status;
        const pending = s && (s.unstaged.length || s.untracked.length || s.conflicts.length);
        this.write(pending ? "Stage all" : "Unstage all", pending ? stageAllArgs() : unstageAllArgs(hasHead), cx);
        return true;
      }
      case "commit":
        if (!this.status?.staged.length) { notify({ title: "Nothing staged", body: "Stage files first (space, or a for all)", level: "warning", timeout: 2500 }); return true; }
        this.committing = true; this.message.focus(); cx.notify(); return true;
      case "pull": this.write("Pull", pullArgs(), cx, { long: true }); return true;
      case "push": this.write("Push", pushArgs(this.status?.branch.head, this.status?.branch.upstream), cx, { long: true }); return true;
      case "fetch": this.write("Fetch", fetchArgs(), cx, { long: true }); return true;
      case "refresh": this.refresh(cx); this.readPrograms(cx); return true;
      case "help": this.help = !this.help; cx.notify(); return true;
      case "follow": this.relock(cx); return true;
      default: return false;
    }
  }

  showWorktree(w, cx) {
    if (!w) return;
    this.follow = false;
    this.shown = w.path;
    this.zone = "changes";
    this.cursor = 0;
    this.watchHere(cx);
    this.refresh(cx);
  }

  openDiff(item, cx) {
    const path = join(this.shown, item.file.path.replace(/\/$/, ""));
    if (item.group === "Conflicts") openInViewer(cx, { path, on: this.loc.on, space: this.loc.space ?? undefined });
    else openInViewer(cx, { path, on: this.loc.on, space: this.loc.space ?? undefined, diff: { repo: this.shown, staged: item.group === "Staged" } });
  }

  // A divider between two panes: dragging it resizes `key` (a column width when
  // `axis` is "x", a section height when "y"); `invert` for a pane on the far side.
  divider(id, key, axis, invert, t) {
    const vertical = axis === "x";
    return div().id(id).flex_none().when(vertical, (el) => el.w(5).h_full().cursor_col_resize())
      .when(!vertical, (el) => el.h(5).w_full().cursor_row_resize())
      .flex().items_center().justify_center()
      .child(div().when(vertical, (el) => el.w(1).h_full()).when(!vertical, (el) => el.h(1).w_full())
        .bg(this.drag?.key === key ? t.accent : t.border))
      .hover((x) => x.bg(t.hover))
      .on_mouse_down("left", (e, cx) => {
        this.drag = { key, axis, invert, start: vertical ? e.position.x : e.position.y, orig: this.sizes[key] };
        cx.stop_propagation();
        cx.notify();
      });
  }

  dragTo(e, cx) {
    const d = this.drag;
    if (!d) return;
    if (e.pressed_button && e.pressed_button !== "left") { this.endDrag(); cx.notify(); return; }
    const zoom = settings().zoom ?? 1;
    let delta = ((d.axis === "x" ? e.position.x : e.position.y) - d.start) / zoom;
    if (d.invert) delta = -delta;
    const [lo, hi] = SIZE_LIMITS[d.key];
    this.sizes[d.key] = Math.round(Math.max(lo, Math.min(hi, d.orig + delta)));
    cx.notify();
  }

  endDrag() {
    if (!this.drag) return;
    this.drag = null;
    try { localStorage.setItem(SIZES, JSON.stringify(this.sizes)); } catch { /* not kept */ }
  }

  // An agent's request (spec 005, R1a): show a worktree, or follow again.
  takeRequest(cx) {
    const q = shared("git.request");
    if (!q || q.at <= this.requestAt) return;
    this.requestAt = q.at;
    if (q.action === "follow") { this.relock(cx); return; }
    this.follow = false;
    this.shown = q.path;
    this.goTo({ cwd: q.path, on: q.on ?? null, space: this.loc?.space ?? null }, cx);
  }

  render(cx) {
    this.takeRequest(cx);
    const loc = terminalLocation();
    if (loc) this.last = loc;
    if (this.follow && loc && (!this.loc || loc.cwd !== this.loc.cwd || loc.on !== this.loc.on)) this.goTo(loc, cx);

    const t = theme();
    const s = this.status, b = s?.branch;
    // Horizontal in a wide, short block (the bottom dock), vertical otherwise (R14).
    const zoom = settings().zoom ?? 1;
    const wide = Boolean(this.size) && this.size.width / zoom > 1.8 * (this.size.height / zoom);
    const placed = this.placed();
    this.lastPlaced = placed;
    const hereWt = this.index?.lookup(this.last?.cwd)?.path ?? null;
    const lock = lockedBy(placed[this.shown] ?? []);
    const items = this.items();
    if (this.cursor >= items.length) this.cursor = Math.max(0, items.length - 1);

    const lightColor = { working: t.accent, blocked: t.blocked, done: t.done ?? t.ansi2, idle: t.dim };
    const agentLight = (a, i) => div().id(`git-agent-${a.address}-${i}`).size(9).rounded(5).cursor_pointer()
      .bg(lightColor[a.status] ?? t.dim)
      .when(a.status === "working", (el) => el.loop("opacity", { from: 0.3, to: 1, period: 1400 }))
      .tooltip(`${a.name} · ${a.status} (by ${a.source === "label" ? "its herdr-nav label" : a.source === "program" ? "its program's folder" : "its terminal's folder"})`)
      .on_click((_e, cx) => { run("agent.focus", { terminal: a.address }); cx.stop_propagation(); });

    const followLight = div().id("git-follow").size(14).flex_none().rounded(7).cursor_pointer()
      .border_2().border_color(this.follow ? t.accent : t.dim).when(this.follow, (el) => el.bg(t.accent))
      .tooltip(this.follow ? "Following the focused terminal (click: stay here)" : "Not following (click or F: follow the focused terminal)")
      .on_click((_e, cx) => { if (this.follow) { this.follow = false; cx.notify(); } else this.relock(cx); });

    const topRow = h_flex().gap(8).items_center()
        .child(followLight)
        .child(div().px(7).h(20).flex().items_center().rounded(10).border_1().border_color(t.border).text_size(11).text_color(t.muted).child(this.loc?.on ?? "local"))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(this.root ? base(this.root) : ""))
        .when(Boolean(lock), (el) => el.child(div().id("git-lock").px(6).h(20).flex().items_center().rounded(10).bg(t.raised).text_size(11).text_color(t.working)
          .tooltip(`Locked: ${lock.name} is working in this worktree`).child("🔒 locked")))
        .when(Boolean(this.busy) || Boolean(this.loading), (el) => el.child(div().size(8).rounded(4).bg(t.accent).loop("opacity", { from: 0.2, to: 1, period: 700 })));
    const branchRow = b && h_flex().gap(8).items_center().text_size(12)
        .child(h_flex().gap(5).items_center().px(7).h(20).rounded(10).bg(t.raised)
          .child(div().text_color(t.muted).child("⎇"))
          .child(div().max_w(200).truncate().child(b.head ?? `detached ${String(b.oid ?? "").slice(0, 7)}`)))
        .child(b.upstream
          ? h_flex().gap(6).child(div().text_color(b.ahead ? t.ansi2 : t.dim).child(`↑${b.ahead}`)).child(div().text_color(b.behind ? t.ansi1 : t.dim).child(`↓${b.behind}`))
          : div().text_color(t.dim).child("no upstream"))
        .when(Boolean(this.busy), (el) => el.child(div().text_color(t.muted).child(`${this.busy}…`)));
    const header = wide
      ? h_flex().flex_none().h(34).px(10).gap(14).items_center().border_b(1).border_color(t.border)
        .when(Boolean(branchRow), (el) => el.child(branchRow)).child(topRow.flex_1().min_w(0))
      : v_flex().flex_none().px(10).pt(8).pb(6).gap(6).border_b(1).border_color(t.border)
        .child(topRow).when(Boolean(branchRow), (el) => el.child(branchRow));

    const section = (title, count, extra) => h_flex().h(22).px(10).mt(6).gap(6).items_center().text_size(10.5).font_semibold().text_color(t.dim)
      .child(div().child(title.toUpperCase())).child(div().child(String(count))).when(Boolean(extra), (el) => el.child(extra));

    const wtRow = (w, i) => {
      const here = w.path === hereWt;
      const shown = w.path === this.shown;
      const cur = this.zone === "worktrees" && i === this.wtCursor;
      const ag = placed[w.path] ?? [];
      const rel = w.main ? "main" : within(w.path, this.root) ? w.path.slice(this.root.length + 1) : base(w.path);
      const n = this.counts[w.path];
      return h_flex().id(`git-wt-${i}`).h(26).px(10).gap(8).items_center().rounded(6).mx(4).cursor_pointer()
        .when(shown, (el) => el.bg(t.selected)).when(cur && !shown, (el) => el.bg(t.hover)).hover((x) => x.bg(shown ? t.selected : t.hover))
        .on_click((_e, cx) => this.showWorktree(w, cx))
        .child(div().w(10).text_color(t.accent).child(here ? "●" : ""))
        .child(div().max_w(150).truncate().font_medium().child(w.branch ?? `detached ${String(w.head ?? "").slice(0, 7)}`))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(rel))
        .children(ag.map(agentLight))
        .child(div().w(28).text_right().text_size(11).text_color(n ? t.blocked : t.dim).child(n == null ? "" : n ? String(n) : "✓"));
    };

    const codeColor = { M: t.blocked, A: t.ansi2, D: t.ansi1, R: t.ansi4, C: t.ansi4, T: t.blocked, U: t.ansi1, "?": t.dim };
    const fileRow = ({ group, file }, i) => {
      const cur = this.zone === "changes" && i === this.cursor;
      const p = file.path.replace(/\/$/, "");
      const slash = p.lastIndexOf("/");
      const ns = (group === "Staged" ? this.numstat.staged : this.numstat.unstaged)[file.path];
      return h_flex().id(`git-file-${i}`).h(ROW).px(10).mx(4).gap(8).items_center().rounded(6).cursor_pointer()
        .when(cur, (el) => el.bg(t.selected)).hover((x) => x.bg(cur ? t.selected : t.hover))
        .on_click((_e, cx) => { this.cursor = i; this.zone = "changes"; this.openDiff({ group, file }, cx); cx.notify(); })
        .child(div().w(12).flex_none().font_semibold().text_size(11.5).text_color(codeColor[file.code] ?? t.muted).child(file.code))
        .child(h_flex().flex_1().min_w(0).gap(4).text_size(12.5)
          .child(div().flex_shrink(0).max_w(220).truncate().child(slash < 0 ? p : p.slice(slash + 1)))
          .when(slash >= 0, (el) => el.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(p.slice(0, slash)))))
        .when(Boolean(ns) && ns.added != null, (el) => el.child(h_flex().gap(4).text_size(11)
          .child(div().text_color(t.ansi2).child(`+${ns.added}`)).child(div().text_color(t.ansi1).child(`−${ns.removed}`))));
    };

    const groupHeader = (group, files) => section(group, files.length, null)
      .id(`git-group-${group}`).cursor_pointer().on_click((_e, cx) => { this.collapsed[group] = !this.collapsed[group]; cx.notify(); })
      .child(div().text_color(t.dim).child(this.collapsed[group] ? "▸" : "▾"));

    let body;
    if (this.error) body = div().p(12).text_size(12).text_color(t.ansi1).child(this.error);
    else if (!this.loc) body = div().p(12).text_size(12).text_color(t.dim).child("Focus a terminal in a repository");
    else if (this.root === null) body = div().p(12).text_size(12).text_color(t.dim).child("Not a git repository");
    else if (!s) body = div().p(12).text_size(12).text_color(t.dim).child("Reading…");
    else if (this.commit && !this.help) body = this.renderCommit(t);
    else if (this.help) {
      const keys = [["j / k", "move"], ["space", "stage / unstage"], ["a", "stage all / unstage all"], ["c", "commit"], ["p", "pull (fast-forward only)"], ["P", "push"], ["f", "fetch"],
        ["enter", "open the diff"], ["o", "open the file"], ["w", "worktrees"], ["r", "refresh"], ["F", "follow the terminal"], ["?", "close this"],
        ["click a commit", "its details and files; there: enter diff, o view, e edit, esc back"]];
      body = v_flex().p(12).gap(4).text_size(12.5).children(keys.map(([k, what]) => h_flex().gap(10)
        .child(div().w(70).text_color(t.accent).child(k)).child(div().text_color(t.muted).child(what))))
        .child(div().pt(8).text_size(11.5).text_color(t.dim).child("Writes are locked while an agent works in this worktree."));
    } else {
      const groups = [["Conflicts", s.conflicts], ["Staged", s.staged], ["Unstaged", s.unstaged], ["Untracked", s.untracked]].filter(([, f]) => f.length);
      let idx = 0;
      const changeBlocks = groups.flatMap(([g, files]) => [groupHeader(g, files), ...(this.collapsed[g] ? [] : files.map((file) => fileRow({ group: g, file }, idx++)))]);
      const strip = visibleWorktrees(this.worktrees, { shown: this.shown, here: hereWt, agents: placed, counts: this.counts, cap: WT_CAP, all: this.allWorktrees });
      const more = this.worktrees.length > WT_CAP
        ? [div().id("git-wt-more").mx(14).my(2).text_size(11.5).text_color(t.accent).cursor_pointer()
          .on_click((_e, cx) => { this.allWorktrees = !this.allWorktrees; this.refresh(cx); cx.notify(); })
          .child(this.allWorktrees ? "show fewer" : `show all ${this.worktrees.length} (${strip.hidden} more)`)]
        : [];
      const worktreeBlock = this.worktrees.length ? [section("Worktrees", this.worktrees.length, null), ...strip.rows.map(wtRow), ...more] : [];
      const changesBlock = [
        ...(changeBlocks.length ? changeBlocks : [div().px(14).py(10).text_size(12).text_color(t.dim).child("Nothing to commit · working tree clean")]),
        ...(this.committing ? [div().px(10).pt(8).child(Input.new(this.message).h(30).px(8).rounded(6).border_1().border_color(t.accent).bg(t.background).text_size(12.5))] : []),
      ];
      const recentBlock = this.log.length ? [section("Recent", this.log.length, null), ...this.log.map((c, i) => h_flex().id(`git-log-${i}`).h(22).px(10).mx(4).gap(8).items_center().rounded(6).text_size(11.5).text_color(t.dim)
        .cursor_pointer().hover((x) => x.bg(t.hover)).tooltip("Details, files and diffs")
        .on_click((_e, cx) => this.openCommit(c.hash, cx))
        .child(div().w(64).flex_none().truncate().font_family(settings().font_family).text_color(t.ansi4).child(c.hash.slice(0, 8))).child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(c.subject)).child(div().flex_none().child(ago(c.time))))] : [];
      const pane = (id, kids) => v_flex().id(id).min_h(0).min_w(0).overflow_y_scrollbar().pb(8).children(kids);
      const sz = this.sizes;
      body = wide
        // Horizontal: worktrees | changes | recent, the outer two resizable.
        ? h_flex().flex_1().min_h(0).items_start()
          .when(worktreeBlock.length > 0, (el) => el.child(pane("git-col-wt", worktreeBlock).w(sz.wt).h_full().flex_none())
            .child(this.divider("git-div-wt", "wt", "x", false, t)))
          .child(pane("git-col-changes", changesBlock).flex_1().h_full())
          .when(recentBlock.length > 0, (el) => el.child(this.divider("git-div-recent", "recent", "x", true, t))
            .child(pane("git-col-recent", recentBlock).w(sz.recent).h_full().flex_none()))
        // Vertical: worktrees / changes / recent, the outer two resizable.
        : v_flex().flex_1().min_h(0)
          .when(worktreeBlock.length > 0, (el) => el.child(pane("git-sec-wt", worktreeBlock).h(sz.wtH).flex_none())
            .child(this.divider("git-div-wth", "wtH", "y", false, t)))
          .child(pane("git-sec-changes", changesBlock).flex_1())
          .when(recentBlock.length > 0, (el) => el.child(this.divider("git-div-recenth", "recentH", "y", true, t))
            .child(pane("git-sec-recent", recentBlock).h(sz.recentH).flex_none()));
    }

    const footer = h_flex().h(26).flex_none().px(10).gap(10).items_center().border_t(1).border_color(t.border).text_size(10.5).text_color(t.dim)
      .child(div().flex_1().truncate().child(lock ? "locked while the agent works" : "space stage · c commit · p pull · P push · f fetch"))
      .child(div().id("git-help").cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.help = !this.help; cx.notify(); }).child("? keys"));

    return v_flex().id("git").track_focus(this.handle)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_window_mouse_move((e, cx) => this.dragTo(e, cx))
      .on_window_mouse_up("left", (_e, cx) => { if (this.drag) { this.endDrag(); cx.notify(); } })
      .on_key_down((e, cx) => {
        if (this.committing) {
          if (e.key === "escape") { this.committing = false; this.message.set_value(""); this.message.blur(); this.handle.focus(); cx.notify(); cx.stop_propagation(); }
          return;
        }
        const action = gitKeyAction(e);
        if (action && this.act(action, cx)) cx.stop_propagation();
      })
      .size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(header).child(body).child(footer);
  }
}
