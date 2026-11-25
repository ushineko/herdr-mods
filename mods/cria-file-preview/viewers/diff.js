// herdr-mods addition (not upstream): a file's git diff, chosen when the preview is
// opened with props.diff = { repo, staged } (working tree or index) or { repo, commit }
// (what that commit changed in the file). Hunk headers on `raised`, added lines on a
// green tint, removed on a red one, old and new line numbers in a gutter. An untracked
// file diffs against nothing (every line added).
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, readTextFile, theme, settings, props } from "herdr";
import { parseDiff, untrackedDiff } from "../lib/diff.js";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const ROWS = 5000;
const tint = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + a : c);
let views = 0;

export default {
  id: "diff",
  async load(file, env) {
    const { repo, staged = false, commit = null } = props()?.diff ?? {};
    if (!repo) throw new Error("No repository given for this diff");
    const git = (args) => exec("git", [...READ, ...args], { cwd: repo, on: env.on });
    const r = commit
      ? await git(["show", "--format=", "--no-color", "--no-ext-diff", commit, "--", file])
      : await git(["diff", ...(staged ? ["--cached"] : []), "--no-color", "--no-ext-diff", "--", file]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "git diff failed");
    let parsed = parseDiff(r.stdout);
    if (!parsed.rows.length && !staged && !commit) {
      const tracked = await git(["ls-files", "--error-unmatch", "--", file]);
      if (tracked.code !== 0) {
        const text = await readTextFile(file, { on: env.on }).catch(() => null);
        if (text !== null && !text.includes("\0")) parsed = untrackedDiff(text);
      }
    }
    return { ...parsed, staged, commit, id: `cria-file-preview-diff-${++views}` };
  },

  toolbar: (state) => {
    const t = theme();
    return h_flex().gap(10).items_center().text_size(12)
      .child(div().text_color(t.ansi2).child(`+${state.added}`))
      .child(div().text_color(t.ansi1).child(`−${state.removed}`))
      .child(div().px(8).py(2).rounded(5).bg(t.raised).text_color(t.muted).child(state.commit ? `Commit ${state.commit.slice(0, 7)}` : state.staged ? "Staged" : "Working tree"));
  },

  render(state) {
    const t = theme(), s = settings();
    if (!state.rows.length) return div().p(14).text_color(t.dim).child("No changes");
    const bg = { add: tint(t.ansi2, "1f"), del: tint(t.ansi1, "1f") };
    const fg = { add: t.ansi2, del: t.ansi1, note: t.dim, ctx: t.foreground };
    const rows = state.rows.filter((r) => r.kind !== "meta").slice(0, ROWS);
    return div().id(state.id).flex_1().min_h(0).overflow_y_scrollbar().font_family(s.font_family).text_size(s.font_size ?? 13)
      .child(v_flex().w_full().py(6).children(rows.map((r, i) => {
        const row = h_flex().id(`${state.id}-${i}`).w_full().min_h(20).items_center();
        if (r.kind === "hunk") return row.mt(i ? 8 : 0).px(12).bg(t.raised).text_color(t.ansi4).child(div().truncate().child(r.text));
        return row.when(Boolean(bg[r.kind]), (el) => el.bg(bg[r.kind]))
          .child(div().w(44).flex_none().pr(8).text_right().text_color(t.dim).child(r.old == null ? "" : String(r.old)))
          .child(div().w(44).flex_none().pr(8).text_right().text_color(t.dim).child(r.new == null ? "" : String(r.new)))
          .child(div().w(16).flex_none().text_color(fg[r.kind]).child(r.kind === "add" ? "+" : r.kind === "del" ? "−" : ""))
          .child(div().flex_1().min_w(0).text_color(fg[r.kind]).child(r.text || " "));
      })));
  },
};
