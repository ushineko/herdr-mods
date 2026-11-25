# 001 — a viewer that opens files as tabs

**Issue**: #1

## Status: INCOMPLETE

## Executive Summary

One file in a tab of the current space: Markdown rendered (images and
in-document links working), code highlighted, images, PDF pages, CSV/TSV
tables, JSON as a tree, and git diffs. `nav` (002) and `git` (003) open files
through it, so it comes first.

**Revised 2026-11-24**: the viewer is `gsydler/herdr-cria`'s file preview,
vendored as `mods/cria-file-preview` (Apache-2.0; `vendor/cria/VENDOR.md`),
with local additions for diffs, external apps and a bounded cache. The first
build (our own `viewer` mod) rendered Markdown through Herdr's `TextView`,
which draws no images and cannot scroll to anchors; the operator found both,
and two gallery mods had already solved them. `herdr-cria` was chosen over
`ryanthedev/herdr-md` (richer, but macOS-only tools and `npm install` +
Chrome at run time): **cross-platform is non-negotiable** (`.claude/CLAUDE.md`).

The spec also brings the `lib/` mechanism: pure helpers shared by mods, copied
in by `install.sh` and unit-tested with `node --test`.

## Context

The shipped `files` mod previews a file by replacing its own tree with a
read-only editor. In a dock that is the wrong place: the dock is narrow, and
the tree is lost while reading. yazi's preview has the same problem. A file is
read in a tab, beside the terminal that is working on it.

## Requirements

### From the vendored base (cria file preview)

- R1 **Opening**: `tab.new { name, space, mod: "cria-file-preview", props: { file, on, diff? } }`,
  `file` absolute, `on` the herdr machine or null.
- R4 **Kinds** by extension: Markdown, image, PDF, CSV/TSV, JSON, else code
  (cria `kinds.js`). Binary text says so.
- R5 **Markdown**: rendered; local images drawn between text blocks; web
  images after a click; `#anchor`, relative and absolute file links work, with
  Back; table of contents; Preview | Raw.
- R6 **Code**: read-only editor, syntax colours from `theme()`, wrap toggle.
- R7 **Images**: fitted, zoomable; local only.
- R8 Large text is cut with a note; missing and unreadable files say so.
- R10 **Follows the file**: a local file reloads when it changes on disk.
- R11 Header: name, folder and size (click copies), the viewer's controls, ⋯
  menu (open in editor / default app, reveal, copy path).
- R12 Colours from `theme()` only.

### Local additions (herdr-mods)

- R2 **No duplicates.** Opening a path already shown in a viewer tab of that
  space selects that tab. `lib/open.js` records tab ids in shared state
  (`viewer.open`), learning a new tab's id by what appeared (S3).
- R3 **One helper for callers**: `lib/open.js` `openInViewer(cx, { path, on, line, diff, space, focus })`,
  used by `nav`, `git`, the agent inbox (005) and later a link handler.
- R7a **The cache is bounded**: copies older than a day are pruned, at most 200
  files are kept (newest), and staging a changed image removes its older copy.
  Pruned when an image, PDF or Markdown document with pictures opens.
- R9 **Diffs**: with `props.diff = { repo, staged }`, `git diff [--cached]` for
  the file, coloured, with old/new line numbers; an untracked file diffs
  against nothing.
- R13 **`lib/`**: pure modules a mod lists in `mod.json` (`"lib": [...]`);
  `install.sh` copies them into the installed mod's `lib/`, and fails on a
  missing one.
- R14 **Open external**: "Open in <app> ↗" in the header for the file's rule in
  `~/.config/herdr-mods/external.json` (005 R9–R11; default Markdown → Zettlr,
  else the system opener; Windows: the system opener). Runs on the file's
  machine.

### Not done (follow-ups, not blocking)

- `line` (jump to a line in a code view): our first viewer had it (S1); cria
  does not. Needed when `git`/agents open at a line.
- A **machine pill** in the header for a remote file (our first viewer had one).
- Pictures inside a **remote** Markdown file: cria shows a chip instead.
  Fetching them (base64 over `exec`, chunked as `herdr-md` does) is a later
  local change.

## Spikes

| # | Question | Answer (2026-11-24, njv-mbp-m1) |
|---|---|---|
| S1 | Does `EditorState.set_selected_range` scroll a read-only editor to that range? | **Yes** (line 250 of 300 scrolled into view, its number bold). |
| S2 | Does `image()` accept an absolute path outside the app home? | **No**: absolute paths and `file://` draw nothing; paths under the app home's `data/` draw. A hidden folder inside a mod does not survive `install.sh`. cria stages pictures into `data/cria-file-preview/` the same way. |
| S3 | Can a mod learn its own tab? | **No**: `props()` holds only what `tab.new` passed, and in-mod `run()` returns null. `openInViewer` diffs the space's tab ids before and after. Shared state does not survive an app restart, so a file opened before a restart may get a second tab. |
| S4 | Does `TextView.markdown` draw images, or report link clicks? | **Draws no images** in any form (relative, absolute, app-home, `file://`, HTML `<img>`); links are clickable and `on_link_click` overrides opening. Why the base was replaced. |

## Acceptance Criteria

- [x] `npm test`: ours (filetype, diff incl. untracked, external rules incl.
      Windows defaults) and cria's (programs incl. bounded prune and stale-copy
      removal, samples, links, paths, windows commands) pass; no temp folders
      left behind.
- [x] `install.sh` copies listed `lib/` files and fails on a missing one;
      `shellcheck install.sh run-tests.sh` clean.
- [x] `herdr-app check` passes for `cria-file-preview`.
- [x] Real window (Mac): Markdown with a local image renders the image,
      including one written inline in a sentence (`doc.md` fixture).
- [x] Real window: the hayami README renders with ToC, Preview | Raw, ⋯.
- [x] Real window: a diff tab for a modified file shows coloured hunks, line
      numbers, `+2 −1`, "Working tree".
- [ ] Real window: an `#anchor` link scrolls to its heading; a relative `.md`
      link opens that file with Back (operator click).
- [ ] Real window: "Open in Zettlr" on a Markdown file opens Zettlr (Mac); on a
      njv-cachyos file it opens on that machine (operator click).
- [x] Real window: a remote Markdown file on `njv-cachyos-default` opens (hayami README, 136 KB).
- [x] Real window: editing an open local file from the terminal updates it (within 2 s).
- [ ] Opening the same file twice through `openInViewer` selects the first tab
      (checked with `nav`, 002).
- [ ] The cache folder never holds more than 200 files; an edited image leaves
      one copy.

## Threat model delta

The vendored code reads files the person's terminals can already read and runs
fixed argument vectors (`git`, `sh`, `file`/`sips`, `pdftoppm`/PDFKit, PowerShell
on Windows). New: web images are downloaded with `curl` (https only, 5 MB,
10 s) **only after a click** on the document's "Load them" bar. "Open in
editor" asks the login shell for `$VISUAL`/`$EDITOR`. External apps come from
the person's own config. Diffs run `git diff` with paths after `--`.

## Risks & Assumptions

- Upstream changes are merged by hand (VENDOR.md); local changes are marked
  `herdr-mods` in the code.
- `watchFolder` has a 64-folder limit across mods; one watch per open preview.
