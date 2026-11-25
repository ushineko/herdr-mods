// git (spec 003): the focused terminal's repository at a glance — branch and upstream
// distance, its worktrees with a light per agent working in each, the pending changes as
// lazygit groups them, and a short set of lazygit keys. Writes are refused while an agent
// works in the shown worktree. Diffs and files open in cria-file-preview.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, hc, watchFolder, window, theme, settings, terminals, notify, nextCommand, checking, run } from "herdr";
import {
  READ, parseStatus, parseNumstat, parseWorktrees, worktreeOf, placeAgent, lockedBy, within, WORKTREE_LABEL,
  stageArgs, unstageArgs, stageAllArgs, unstageAllArgs, commitArgs, pullArgs, pushArgs, fetchArgs,
  LOG_FORMAT, parseLog, ago, gitKeyAction, WRITES,
} from "./lib/git.js";
import { openInViewer } from "./lib/open.js";
import { terminalLocation, fallbackLocation } from "./lib/location.js";

const REMOTE_POLL = 5000;
const AGENT_POLL = 3000;
const ROW = 24;
const LONG = 120000; // pull, push, fetch

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
    this.handle = cx.focus_handle();
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
        const here = worktreeOf(loc.cwd, this.worktrees);
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
      this.git([...READ, "-C", w, "log", "-n5", `--format=${LOG_FORMAT}`]),
    ]);
    if (st.code !== 0) throw new Error(st.stderr.trim() || "git status failed");
    this.status = parseStatus(st.stdout);
    this.numstat = { unstaged: parseNumstat(ns.stdout), staged: parseNumstat(nc.stdout) };
    this.log = lg.code === 0 ? parseLog(lg.stdout) : [];
  }

  async readCounts() {
    const counts = {};
    await Promise.all(this.worktrees.filter((w) => !w.prunable).map(async (w) => {
      const r = await this.git([...READ, "-C", w.path, "status", "--porcelain=v1", "-z", "--untracked-files=normal"]).catch(() => null);
      counts[w.path] = r?.code === 0 ? r.stdout.split("\0").filter(Boolean).length : null;
    }));
    this.counts = counts;
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
      const at = placeAgent({ label: known?.label ?? t.labels?.[WORKTREE_LABEL], program: known?.program, terminal: t.cwd }, this.worktrees);
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

  act(action, cx) {
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
        if (this.zone === "worktrees") this.wtCursor = Math.max(0, Math.min(this.worktrees.length - 1, this.wtCursor + d));
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
        if (this.zone === "worktrees") { this.showWorktree(this.worktrees[this.wtCursor], cx); return true; }
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

  render(cx) {
    const loc = terminalLocation();
    if (loc) this.last = loc;
    if (this.follow && loc && (!this.loc || loc.cwd !== this.loc.cwd || loc.on !== this.loc.on)) this.goTo(loc, cx);

    const t = theme();
    const s = this.status, b = s?.branch;
    // Horizontal in a wide, short block (the bottom dock), vertical otherwise (R14).
    const zoom = settings().zoom ?? 1;
    const wide = Boolean(this.size) && this.size.width / zoom > 1.8 * (this.size.height / zoom);
    const placed = this.placed();
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
      const at = this.last?.cwd;
      const here = Boolean(at) && worktreeOf(at, this.worktrees)?.path === w.path;
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
    else if (this.help) {
      const keys = [["j / k", "move"], ["space", "stage / unstage"], ["a", "stage all / unstage all"], ["c", "commit"], ["p", "pull (fast-forward only)"], ["P", "push"], ["f", "fetch"],
        ["enter", "open the diff"], ["o", "open the file"], ["w", "worktrees"], ["r", "refresh"], ["F", "follow the terminal"], ["?", "close this"]];
      body = v_flex().p(12).gap(4).text_size(12.5).children(keys.map(([k, what]) => h_flex().gap(10)
        .child(div().w(70).text_color(t.accent).child(k)).child(div().text_color(t.muted).child(what))))
        .child(div().pt(8).text_size(11.5).text_color(t.dim).child("Writes are locked while an agent works in this worktree."));
    } else {
      const groups = [["Conflicts", s.conflicts], ["Staged", s.staged], ["Unstaged", s.unstaged], ["Untracked", s.untracked]].filter(([, f]) => f.length);
      let idx = 0;
      const changeBlocks = groups.flatMap(([g, files]) => [groupHeader(g, files), ...(this.collapsed[g] ? [] : files.map((file) => fileRow({ group: g, file }, idx++)))]);
      const worktreeBlock = this.worktrees.length ? [section("Worktrees", this.worktrees.length, null), ...this.worktrees.map(wtRow)] : [];
      const changesBlock = [
        ...(changeBlocks.length ? changeBlocks : [div().px(14).py(10).text_size(12).text_color(t.dim).child("Nothing to commit · working tree clean")]),
        ...(this.committing ? [div().px(10).pt(8).child(Input.new(this.message).h(30).px(8).rounded(6).border_1().border_color(t.accent).bg(t.background).text_size(12.5))] : []),
      ];
      const recentBlock = this.log.length ? [section("Recent", this.log.length, null), ...this.log.map((c, i) => h_flex().id(`git-log-${i}`).h(22).px(14).gap(8).items_center().text_size(11.5).text_color(t.dim)
        .child(div().w(56).flex_none().text_color(t.ansi4).child(c.hash)).child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(c.subject)).child(div().flex_none().child(ago(c.time))))] : [];
      const column = (id, kids) => v_flex().id(id).min_h(0).h_full().overflow_y_scrollbar().pb(8).children(kids);
      body = wide
        ? h_flex().flex_1().min_h(0).items_start()
          .child(column("git-col-wt", worktreeBlock).w(300).flex_none().border_r(1).border_color(t.border))
          .child(column("git-col-changes", changesBlock).flex_1().min_w(0))
          .when(recentBlock.length > 0, (el) => el.child(column("git-col-recent", recentBlock).w(320).flex_none().border_l(1).border_color(t.border)))
        : v_flex().id("git-body").flex_1().min_h(0).overflow_y_scrollbar().pb(8).children([...worktreeBlock, ...changesBlock, ...recentBlock]);
    }

    const footer = h_flex().h(26).flex_none().px(10).gap(10).items_center().border_t(1).border_color(t.border).text_size(10.5).text_color(t.dim)
      .child(div().flex_1().truncate().child(lock ? "locked while the agent works" : "space stage · c commit · p pull · P push · f fetch"))
      .child(div().id("git-help").cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.help = !this.help; cx.notify(); }).child("? keys"));

    return v_flex().id("git").track_focus(this.handle)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
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
