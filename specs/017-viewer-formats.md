# 017 — Viewer: notebooks, a better diff, HTML, Office and RTF

**Issue**: #52

## Status: COMPLETE

## Executive Summary

The viewer (`cria-file-preview`) shows Markdown, PDF, images, CSV/TSV, JSON, code
and a file's git diff. This spec adds four kinds, in this order: Jupyter notebooks;
a better diff; HTML, rendered by a headless browser; and Word, RTF and OpenDocument
text, converted by LibreOffice. The last two reuse the PDF viewer: each file is
converted to a PDF in the viewer's cache, once per content, then shown page by page.

## Context

- Headless browsers on hand (2026-11-26): the Mac has Puppeteer's
  `chrome-headless-shell` (from mermaid-cli), njv-cachyos `chromium`, Windows Edge
  (`msedge --headless --print-to-pdf`). None has LibreOffice; installing it
  (pacman `libreoffice-fresh`, Homebrew cask `libreoffice`, winget
  `TheDocumentFoundation.LibreOffice`) was agreed by the operator, each install
  asked for when it comes.
- The vendored viewer's changes are marked `herdr-mods` and listed in
  `vendor/cria/VENDOR.md`.

## Requirements

- R1 **Notebooks** (`.ipynb`). Each cell in order: Markdown rendered; code with its
  language's colours and an In [n] mark; its outputs: text (stdout, results),
  errors (traceback, ANSI colours stripped), images (PNG, JPEG, SVG) and HTML
  tables as text. Pure parsing (`lib/`), tested. No tools.
- R2 **A better diff.** Unified or side by side (a toggle, remembered); changes
  within a line marked word by word; the file's language colours; long unchanged
  stretches folded (click to open); for a commit, its files listed to step through.
  Pure parts (pairing lines, word changes, folding) in `lib/`, tested.
- R3 **HTML** (`.html`, `.htm`). Printed to PDF by the machine's headless
  browser and shown in the PDF viewer (styles, images, selectable text); a
  Raw toggle shows it as code. A remote file's HTML is copied here first (its
  relative styles and pictures don't come along). Scripts don't run: the browser
  prints a copy with them removed (`lib/html-print.js`, tested; turning scripts off
  in Chrome stops it printing at all, found 2026-11-26). No browser: the source,
  with a note.
- R4 **Office and RTF** (`.docx`, `.doc`, `.odt`, `.rtf`). Converted to PDF
  by LibreOffice (`soffice --headless --convert-to pdf`) and shown in the PDF
  viewer. No LibreOffice: a note saying what to install.
- R4a **Spreadsheets** (`.xlsx`, `.xls`, `.ods`; added 2026-11-26). LibreOffice
  converts to flat OpenDocument (`.fods`); `lib/fods.js` (tested) reads each sheet's
  cells as shown (formatted values, computed formulas); the table viewer draws one
  sheet at a time, the sheets picked in the toolbar.
- R4b **Remote files** (operator's rule, 2026-11-26): a file on another machine is
  copied here first (`media.js fetchHere`), for the PDF, picture, document and
  spreadsheet views, instead of being refused.
- R5 **Every system**, with each system's tools in the viewer's per-system tables.
- R6 **Vendored mod**: changes marked and listed in VENDOR.md.

## Acceptance Criteria

- [x] R1: unit tests; a notebook with Markdown, code, text, an error and a plot
  shown in the window.
- [x] R2: unit tests; a diff with changed lines shown both ways, words marked,
  context folded; a commit's files stepped through.
- [x] R3: a styled HTML page shown as rendered, and its source; on each system.
- [x] R4: a .docx and an .rtf shown with their layout; on each system once
  LibreOffice is installed.
- [x] R4a: `budget.xlsx` and `budget.ods` shown with both sheets; `machines.csv`.
- [x] R4b: a document, PDF and picture from a remote space shown.
- [x] R5/R6, `herdr-app check`, tests on macOS, Linux and Windows.

## Verification (2026-11-26)

- Unit tests: `tests/notebook.test.js`, `tests/diff.test.js` (pairing, word changes,
  folding, highlighting), `tests/html-print.test.js`, `tests/fods.test.js`. macOS 314
  pass, Linux 315, Windows 307 (18 skipped), 0 failures.
- Real window, Mac (seen in screenshots): the notebook, the diff both ways,
  `page.html` rendered (styles kept, script removed), `document.docx`, `budget.xlsx`
  with Spending and Notes, a 159-page manual (LibreOffice Getting Started 26.2,
  four chapters) and the samples; the operator confirmed the rest, including remote
  files, on 2026-11-26 ("works").
- Linux and Windows: every conversion (HTML, DOCX, RTF, XLSX, ODS) run by the
  viewer's own scripts, each output checked to land in the cache;
  `herdr-app check` passes on every machine.
- Found on the way: Chrome's `--blink-settings=scriptEnabled=false` stops it
  printing at all (scripts are removed from a copy instead); PowerShell's comma
  binds tighter than `+` (the program search paths); a lost backslash put Windows
  output beside the cache folder.
