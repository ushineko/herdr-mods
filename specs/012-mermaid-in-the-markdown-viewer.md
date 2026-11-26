# 012 — Mermaid diagrams in the Markdown viewer

**Issue**: #30

## Status: INCOMPLETE

## Executive Summary

The Markdown viewer (`cria-file-preview`) shows a ` ```mermaid ` fenced block as
code. It now draws it as a diagram: Mermaid's own CLI (`mmdc`) renders each block
to a PNG in the viewer's cache, in the background, and the diagram takes the
block's place, in the app's light or dark theme. A missing `mmdc` or a diagram
that doesn't parse leaves the code block, with a note saying why.

## Context

- The viewer splits Markdown into blocks around images (`markdown-blocks.js`,
  vendored from herdr-cria) and draws pictures from its cache folder
  (`data/cria-file-preview/`, bounded to a day and 200 files) with `image()`.
- Herdr's runtime has no DOM, so Mermaid's JavaScript can't run in the mod. The
  renderer chosen (operator, 2026-11-25) is `mmdc` (`@mermaid-js/mermaid-cli`):
  every diagram type, the same drawing as GitHub's, through headless Chrome.
  Rejected: merman (fewer diagram types, a RUSTSEC advisory, a cargo build per
  machine) and mermaid.ink (sends the diagram to a web service).
- PNG, not SVG: Mermaid's SVG puts labels in `<foreignObject>` HTML, which the app's
  SVG renderer does not draw.
- Installed: njv-cachyos (pacman `mermaid-cli` 12.2.0, with Chromium);
  njv-mbp-m1 (Homebrew `mermaid-cli`, 2026-11-25). Windows: `npm i -g
  @mermaid-js/mermaid-cli`, untested.
- Herdr's own environment lacks the login shell's PATH (Homebrew's
  `/opt/homebrew/bin` on the Mac), as `lib/edit-open.js` already works around.

## Requirements

- R1 **Blocks.** A fenced block whose info string is `mermaid` (backticks or tildes,
  any fence length) becomes a diagram block `{ mermaid: { source } }`; the text on
  either side stays as it was. Other fences, and `mermaid` inside other fences,
  are untouched.
- R2 **Drawing.** On the window's machine, `mmdc` draws the source to
  `data/cria-file-preview/mermaid-<key>.png` at scale 2 with a transparent
  background, `<key>` naming the source and theme, so an unchanged diagram is
  drawn once (until the cache prunes it). The document shows at once; each
  diagram says "drawing…" until its picture arrives, one at a time. A file on
  another machine is drawn here too (its text is already read).
- R3 **Theme.** Mermaid's `dark` theme when the app's background is dark, else
  `default`.
- R4 **Shown.** A diagram is drawn at its natural size (half its pixels), no wider
  than the text column. Clicking it opens the picture in the image viewer (zoom
  and pan); Back returns.
- R5 **Failures.** No `mmdc`: the code block, with a note "Mermaid isn't installed
  (mermaid-cli)". A diagram error: the code block, with Mermaid's first error line.
  A run over 30 s: "Mermaid took too long". Nothing else in the document changes.
- R6 **Finding mmdc.** POSIX: `mmdc` on Herdr's PATH, else Homebrew's and the usual
  npm global folders, else the login shell's `command -v mmdc`; its folder goes on
  PATH for the run (it is a node script). Windows: `mmdc` through PowerShell, as the
  viewer's other Windows commands (untested).
- R7 **Pure parts tested.** Block splitting, the theme choice, the command lines
  per system and the error wording live in pure code with unit tests
  (`tests/mermaid.test.js`).
- R8 **Vendored mod.** Changes to `cria-file-preview` are marked `herdr-mods` and
  listed in `vendor/cria/VENDOR.md`.

## Acceptance Criteria

- [ ] R1: unit tests: a mermaid fence becomes one diagram block between text
  blocks; tilde fences and long fences work; a `mermaid` fence inside another fence
  stays text.
- [ ] R2/R4: a Markdown file with a flowchart and a sequence diagram shows both
  drawn in the viewer, on njv-mbp-m1 and on njv-cachyos; reopening draws nothing
  again (cached); a click opens the picture zoomable.
- [ ] R3: the diagrams follow a dark theme (dark) and a light one (light).
- [ ] R5: a broken diagram shows its code and Mermaid's error line; with `mmdc`
  not found, the note says Mermaid isn't installed.
- [ ] R6/R7: unit tests for the command lines (POSIX and Windows) and theme
  choice pass on macOS, Linux and Windows.
- [ ] R8: VENDOR.md lists the changes.
- [ ] `herdr-app check` passes; `herdr-app status` shows no errors (both machines).

## Test approach

Unit (node --test, plain data): `splitBlocks` on mermaid fences; `isDark` on theme
colours; the render command per system (argv shape, values passed as arguments,
never spliced into script text); the error line from `mmdc`'s stderr. The drawing
itself (`mmdc`, the cache, `image()`) is checked in the real window: a sample
document under `vendor/cria/samples/`-style `docs/samples/mermaid.md`.

## E2E (real window)

Open `docs/samples/mermaid.md` in the viewer on each machine: both diagrams drawn,
"drawing…" first on a fresh cache, nothing redrawn on reopening; the broken
diagram's note; a click on a diagram opens it in the image viewer. Switch the app
theme and reopen.

## Threat model delta

`mmdc` runs headless Chrome on the diagram text from a file being viewed. Mermaid's
default `securityLevel` (`strict`) applies: no scripts or click handlers from the
diagram run, and the output is a PNG, not live content. The source reaches `mmdc`
through a file in the viewer's cache and argument lists, never a shell string.
Nothing leaves the machine.
