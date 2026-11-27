// herdr-mods addition (not upstream): a file's git diff, chosen when the preview is
// opened with props.diff = { repo, staged } (working tree or index) or { repo, commit }
// (what that commit changed in the file). An untracked file diffs against nothing.
//
// Spec 017 R2: unified or side by side (a toggle, remembered); the words that changed
// within a line pair marked; the file's language coloured (a small generic
// highlighter, lib/diff.js syntaxRuns); long unchanged stretches folded (click opens);
// for a commit, its files listed on the left to step through. Pure parts in lib/diff.js.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, readTextFile, theme, settings, props } from "herdr";
import { parseDiff, untrackedDiff, sideBySide, wordChanges, foldContext, paintLine } from "../lib/diff.js";
import { extension } from "../kinds.js";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const ROWS = 5000;
const CONTEXT = 12;
const MODE_KEY = "cria-file-preview.diff-mode";
const tint = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + a : c);
let views = 0;

// The diff of `file` (relative to the repository or absolute), parsed, with each
// changed line pair's word changes attached (row.changed: character ranges).
async function diffOf(repo, file, { staged, commit }, on) {
  const git = (args) => exec("git", [...READ, ...args], { cwd: repo, on });
  const r = commit
    ? await git(["show", "--format=", "--no-color", "--no-ext-diff", `-U${CONTEXT}`, commit, "--", file])
    : await git(["diff", ...(staged ? ["--cached"] : []), "--no-color", "--no-ext-diff", `-U${CONTEXT}`, "--", file]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "git diff failed");
  let parsed = parseDiff(r.stdout);
  if (!parsed.rows.length && !staged && !commit) {
    const tracked = await git(["ls-files", "--error-unmatch", "--", file]);
    if (tracked.code !== 0) {
      const text = await readTextFile(file, { on }).catch(() => null);
      if (text !== null && !text.includes("\0")) parsed = untrackedDiff(text);
    }
  }
  for (const p of sideBySide(parsed.rows)) {
    if (p.left?.kind !== "del" || p.right?.kind !== "add") continue;
    const w = wordChanges(p.left.text, p.right.text);
    p.left.changed = w.old;
    p.right.changed = w.new;
  }
  return parsed;
}

// A commit's files: [{ status, path }].
async function commitFiles(repo, commit, on) {
  const r = await exec("git", [...READ, "show", "--format=", "--name-status", "--no-renames", commit], { cwd: repo, on });
  if (r.code !== 0) return [];
  return r.stdout.split("\n").filter(Boolean).map((l) => { const [status, ...p] = l.split("\t"); return { status: status[0], path: p.join("\t") }; });
}

function mode() { try { return localStorage.getItem(MODE_KEY) === "split" ? "split" : "unified"; } catch { return "unified"; } }
function setMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch {} }

export default {
  id: "diff",
  async load(file, env) {
    const { repo, staged = false, commit = null } = props()?.diff ?? {};
    if (!repo) throw new Error("No repository given for this diff");
    const parsed = await diffOf(repo, file, { staged, commit }, env.on);
    const files = commit ? await commitFiles(repo, commit, env.on) : [];
    // The file as the commit's list names it (relative to the repository).
    const rel = String(file).startsWith(`${repo}/`) ? String(file).slice(repo.length + 1) : String(file);
    return { ...parsed, repo, staged, commit, files, current: rel, lang: extension(rel), open: new Set(), mode: mode(), on: env.on, id: `cria-file-preview-diff-${++views}` };
  },

  toolbar: (state) => {
    const t = theme();
    const seg = (m, label) => div().id(`${state.id}-mode-${m}`).px(8).py(2).rounded(5).cursor_pointer()
      .text_color(state.mode === m ? t.foreground : t.muted).when(state.mode === m, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { state.mode = m; setMode(m); cx.notify(); }).child(label);
    return h_flex().gap(10).items_center().text_size(12)
      .child(div().text_color(t.ansi2).child(`+${state.added}`))
      .child(div().text_color(t.ansi1).child(`−${state.removed}`))
      .child(h_flex().gap(2).p(2).rounded(7).bg(t.raised).child(seg("unified", "Unified")).child(seg("split", "Side by side")))
      .child(div().px(8).py(2).rounded(5).bg(t.raised).text_color(t.muted).child(state.commit ? `Commit ${state.commit.slice(0, 7)}` : state.staged ? "Staged" : "Working tree"));
  },

  render(state) {
    const t = theme(), s = settings();
    const color = { keyword: t.ansi5, string: t.ansi2, number: t.ansi3, comment: t.dim };
    const line = { add: tint(t.ansi2, "1a"), del: tint(t.ansi1, "1a") };
    const word = { add: tint(t.ansi2, "55"), del: tint(t.ansi1, "55") };
    const fg = { add: t.foreground, del: t.foreground, note: t.dim, ctx: t.foreground };
    // A line's text: syntax colours, its changed words on the stronger tint.
    const text = (r) => h_flex().flex_1().min_w(0).flex_wrap().children(
      (r.text ? paintLine(r.text, state.lang, r.changed ?? []) : [{ text: " ", kind: null, changed: false }]).map((p) =>
        div().text_color(p.kind ? color[p.kind] ?? fg[r.kind] : fg[r.kind]).when(p.changed, (el) => el.bg(word[r.kind] ?? "#00000000").rounded(2)).child(p.text)));
    const num = (n) => div().w(44).flex_none().pr(8).text_right().text_color(t.dim).child(n == null ? "" : String(n));
    const fold = (f, i) => h_flex().id(`${state.id}-fold-${i}`).w_full().h(22).px(12).items_center().cursor_pointer()
      .bg(t.surface).text_color(t.dim).hover((x) => x.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { state.open.add(f.id); cx.notify(); })
      .child(`⋯  ${f.count} unchanged line${f.count === 1 ? "" : "s"} (click to show)`);
    const hunk = (r, i) => h_flex().id(`${state.id}-h-${i}`).w_full().min_h(20).mt(i ? 8 : 0).px(12).items_center().bg(t.raised).text_color(t.ansi4).child(div().truncate().child(r.text));
    const rows = foldContext(state.rows.filter((r) => r.kind !== "meta"), state.open).slice(0, ROWS);

    let body;
    if (!state.rows.length) body = div().p(14).text_color(t.dim).child("No changes");
    else if (state.mode === "split") {
      // Side by side: old on the left, new on the right, changed pairs on one row.
      const half = (r) => !r ? h_flex().flex_1().min_w(0).bg(t.surface)
        : h_flex().flex_1().min_w(0).items_start().when(Boolean(line[r.kind]), (el) => el.bg(line[r.kind]))
          .child(num(r.kind === "add" ? r.new : r.old ?? r.new))
          .child(div().w(14).flex_none().text_color(r.kind === "add" ? t.ansi2 : r.kind === "del" ? t.ansi1 : t.dim).child(r.kind === "add" ? "+" : r.kind === "del" ? "−" : ""))
          .child(text(r));
      body = v_flex().w_full().py(6).children(sideBySide(rows).map((p, i) => p.hunk ? hunk(p.hunk, i) : p.fold ? fold(p.fold, i)
        : h_flex().id(`${state.id}-${i}`).w_full().min_h(20).items_stretch()
          .child(half(p.left?.kind === "add" ? null : p.left))
          .child(half(p.right?.kind === "del" ? null : p.right).border_l(1).border_color(t.border))));
    } else {
      body = v_flex().w_full().py(6).children(rows.map((r, i) => {
        if (r.kind === "hunk") return hunk(r, i);
        if (r.kind === "fold") return fold(r, i);
        return h_flex().id(`${state.id}-${i}`).w_full().min_h(20).items_start()
          .when(Boolean(line[r.kind]), (el) => el.bg(line[r.kind]))
          .child(num(r.old)).child(num(r.new))
          .child(div().w(16).flex_none().text_color(r.kind === "add" ? t.ansi2 : r.kind === "del" ? t.ansi1 : t.dim).child(r.kind === "add" ? "+" : r.kind === "del" ? "−" : ""))
          .child(text(r));
      }));
    }

    const diff = div().id(state.id).flex_1().min_w(0).min_h(0).overflow_y_scrollbar().font_family(s.font_family).text_size(s.font_size ?? 13).child(body);
    if (!state.files.length) return diff;
    // A commit: its files on the left; a click shows that file's diff here.
    const letter = { A: t.ansi2, D: t.ansi1, M: t.ansi3 };
    const list = v_flex().id(`${state.id}-files`).w(240).flex_none().h_full().min_h(0).overflow_y_scrollbar().py(8).px(6).gap(1)
      .border_r(1).border_color(t.border).bg(t.surface).text_size(12)
      .child(div().px(6).pb(6).text_size(11).font_semibold().text_color(t.dim).child(`${state.files.length} file${state.files.length === 1 ? "" : "s"} in this commit`))
      .children(state.files.map((f, i) => {
        const on = f.path === state.current;
        const slash = f.path.lastIndexOf("/");
        return h_flex().id(`${state.id}-f-${i}`).px(6).py(3).gap(6).rounded(5).cursor_pointer().items_center()
          .when(on, (el) => el.bg(t.selected)).hover((x) => x.bg(t.hover))
          .tooltip(f.path)
          .on_click((_e, cx) => {
            if (on) return;
            cx.spawn(async (cx) => {
              try {
                const p = await diffOf(state.repo, f.path, { commit: state.commit }, state.on);
                Object.assign(state, p, { current: f.path, lang: extension(f.path), open: new Set() });
              } catch (e) { Object.assign(state, { rows: [{ kind: "note", text: String(e?.message ?? e), old: null, new: null }], added: 0, removed: 0, current: f.path }); }
              cx.notify();
            });
          })
          .child(div().w(12).flex_none().font_semibold().text_color(letter[f.status] ?? t.muted).child(f.status))
          .child(div().flex_none().max_w(150).truncate().text_color(on ? t.foreground : t.muted).child(slash < 0 ? f.path : f.path.slice(slash + 1)))
          .when(slash >= 0, (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(f.path.slice(0, slash))));
      }));
    return h_flex().flex_1().min_h(0).child(list).child(diff);
  },
};
