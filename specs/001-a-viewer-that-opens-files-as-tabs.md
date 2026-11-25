# 001 — a viewer that opens files as tabs

**Issue**: #1

## Status: INCOMPLETE

## Executive Summary

A `viewer` mod that shows one file in a tab of the current space: Markdown
rendered (with a source toggle), source code highlighted, images drawn, git
diffs coloured. `nav` (002) and `git` (003) open files through it, so it comes
first. It also brings the `lib/` mechanism: pure helpers shared by mods,
copied in by `install.sh` and unit-tested with `node --test`.

## Context

The shipped `files` mod previews a file by replacing its own tree with a
read-only editor. In a dock that is the wrong place: the dock is narrow, and
the tree is lost while reading. yazi's preview has the same problem. A file is
read in a tab, beside the terminal that is working on it.

## Requirements

### Opening

- R1 **One way in.** A viewer tab is opened with
  `run("tab.new", { name, space, mod: "viewer", props: { path, on, line?, diff? } })`:
  `path` absolute, `on` the herdr machine name or null for this computer,
  `line` 1-based, `diff` a `{ repo, staged }` request (R9). `name` is the file's
  base name (a diff: `Δ <base name>`).
- R2 **No duplicates.** Opening a path already shown in a viewer tab of that
  space selects that tab instead (and moves to `line` when given). Open viewer
  tabs are tracked in shared state (`viewer.open`: key `on|path|diff?` → tab
  id), pruned of tabs that no longer exist.
- R3 **A helper for callers.** `lib/open.js` exports `openInViewer({ path, on, line, diff })`,
  used by `nav`, `git`, `ui-lab`, the agent inbox (005) and later a terminal
  link handler.

### Showing

- R4 **Type by extension, then content**, decided by `lib/filetype.js`:
  `markdown` (`.md`, `.markdown`, `.mdx`), `image` (`.png`, `.jpg`, `.jpeg`,
  `.gif`, `.webp`, `.svg`), `code` (a language from a table covering at least
  js/ts/jsx/tsx/mjs, py, go, rs, sh/bash/zsh, json/jsonc, yaml/yml/toml, html,
  css, c/h/cpp, java, rb, lua, sql, Dockerfile, Makefile), else `text`.
  A file containing NUL is `binary`.
- R5 **Markdown** renders with `TextView.markdown`, selectable, links opening
  in the browser. A toggle in the header (and `m` when focused) switches to the
  source in the code editor with Markdown highlighting. The choice is
  remembered per tab.
- R6 **Code and text** show in a read-only `Editor` with line numbers, the
  person's terminal font, syntax colours from `theme()`, and soft wrap off
  (toggle `w`). `line` puts the cursor on that line (spike S1).
- R7 **Images** are drawn fitted to the tab, never upscaled past 2×, with their
  pixel size in the header when known. Local files only (spike S2); a remote
  image says so.
- R8 **Binary, missing, too large**: a short message in place of the content.
  Text over 2 MB shows the first 2 MB and says it was cut.
- R9 **Diffs.** With `props.diff`, the viewer runs
  `git diff [--cached] --no-color -- <path>` in `diff.repo` (on `on`), and draws
  it with hunk headers dimmed, `+` lines on a green tint, `-` lines on a red
  tint, and old/new line numbers in a gutter. An untracked file diffs against
  nothing (all `+`).

### Living with change

- R10 **Follows the file.** A local file is watched (`watchFolder` on its
  folder) and reloaded when it changes, keeping the scroll position where the
  editor allows; a remote file is re-read every 5 s while its tab is shown. A
  diff tab refreshes the same way. A reload that finds the file gone shows R8's
  "missing" message and keeps watching.

### Look

- R11 **Header**: file-type glyph, the path relative to the repository root if
  in one (else to home, `~/…`), a machine pill when `on` is set, size and line
  count, the Markdown toggle. Breadcrumb segments are clickable and open `nav`
  (002) at that folder once `nav` exists; until then they are plain text.
- R12 Colours come from `theme()` only, so light and dark themes both work.

### Open external

- R14 **An external app per file type**, configured per machine in
  `~/.config/herdr-mods/external.json` (format and defaults: 005 R9–R11;
  default Markdown → Zettlr). The header shows "Open in <app>" for the file's
  rule, and `e` does the same when the tab has the keyboard. It runs on the
  file's machine (005 R10). Diff tabs open the file itself.

### Shared code

- R13 **`lib/`**: pure modules with no `herdr`/`gpui-kit` imports. A mod lists
  the ones it uses in `mod.json` (`"lib": ["filetype.js", "open.js"]`);
  `install.sh` copies them into the mod's folder as `lib/<file>` before the
  rsync, and fails if a listed file is missing. `open.js` is the exception that
  imports `herdr` (it calls `run`); it is not unit-tested.

## Spikes

| # | Question | If no |
|---|---|---|
| S1 | Does `EditorState.set_selected_range` scroll a read-only editor to that range? | Drop `line` positioning; show the line number in the header instead |
| S2 | Does `image()` accept an absolute path outside the app home? | Copy the image into `mods/viewer/.cache/` (writable: under the app home) and show that; prune on close |
| S3 | Can a mod read a tab's name/props to rebuild `viewer.open` after an app restart? | Keep `viewer.open` best-effort; a duplicate tab after a restart is acceptable |

## Acceptance Criteria

- [ ] `node --test tests/` passes: `filetype` for every extension in R4, NUL
      detection, unknown extension → text; diff parsing (hunks, +/- lines, line
      numbers, an untracked file).
- [ ] `install.sh` copies `lib/` files listed in `mod.json`, and fails on a
      missing one; `shellcheck` clean.
- [ ] `herdr-app check` passes for `viewer`.
- [ ] Real window (Mac): a Markdown file renders and toggles to source; a `.go`
      and a `.py` file are highlighted; a PNG shows; a binary file shows the
      message; opening the same file twice selects the first tab.
- [ ] Real window: editing an open local file from the terminal updates the tab
      within 2 s.
- [ ] Real window: a diff tab for a modified file shows coloured hunks.
- [ ] Real window (Mac, remote file on njv-cachyos): a Markdown file on
      `njv-cachyos-default` opens and renders.
- [ ] Real window: "Open in Zettlr" on a Markdown tab opens Zettlr (Mac);
      with no `external.json`, a `.png` opens in the system viewer.
- [ ] Spike answers S1–S3 written into this spec.

## Threat model delta

No new boundary: the viewer reads files the person's terminals can already
read, through herdr's own `readTextFile`/`exec`. Paths come from other mods,
not from file content. `git diff` is run with an argument vector, never a
shell string.

## Risks & Assumptions

- Very large files make the editor slow; R8's 2 MB cut bounds it.
- `watchFolder` has a 64-folder limit across mods; one watch per open viewer
  tab is well inside it for normal use.

## E2E Test Plan

On the Mac: `open` the repo's README via `ui-lab`'s state file or `herdr-app do tab.new`
with props; screenshot; edit it with `echo >> README.md`; screenshot again;
toggle source; open a diff of a modified file. Repeat the Markdown case with a
file on njv-cachyos.
