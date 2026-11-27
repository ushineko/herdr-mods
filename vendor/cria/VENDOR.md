# Vendored: cria file preview

- **Upstream**: https://github.com/gsydler/herdr-cria, folder `file-preview/`
- **Commit**: `6cff06a13f5416c6010f5f07a5276d4a65f0c228` (2026-11-18, "Fix import check on Windows paths (#9)")
- **Licence**: Apache-2.0 (`LICENSE` here and in `mods/cria-file-preview/`)
- **Adopted**: 2026-11-24, as the viewer for spec 001 (issue #1): cross-platform
  (macOS, Linux, Windows), runs only `git`/`sh` (PowerShell on Windows), web
  images only after a click, tests included.

## Layout here

| Upstream | Here |
|---|---|
| `file-preview/mods/cria-file-preview/` | `mods/cria-file-preview/` (name kept, so upstream diffs apply) |
| `file-preview/tests/` | `vendor/cria/tests/` (imports point at `../../../mods/cria-file-preview/`) |
| `file-preview/samples/` | `vendor/cria/samples/` |
| `file-preview/RECIPE.md`, `CHANGELOG.md` | `vendor/cria/` (reference) |

`npm test` (`run-tests.sh`) runs these tests with ours, under a private TMPDIR
that is removed afterwards (the upstream tests create temp folders and do not
delete them).

## Local changes (each marked `herdr-mods` in the code)

| File | Change | Why |
|---|---|---|
| `programs.js` | Cache prune: a day (was 14 days) and at most `KEEP` = 200 files, newest kept; POSIX `PRUNE` script and `PRUNE_WINDOWS`. Staging a changed file removes that file's older copies (not PDF pages). | Cache must stay bounded (operator's rule). Tested on macOS, Linux and Windows (win11-kvm). |
| `media.js` | Comment for the new prune. | |
| `viewers/markdown.js` | Calls `pruneCache()` when a document has pictures. | Upstream pruned only from the image and PDF views. |
| `viewers/diff.js` (new) | A file's git diff, for `props.diff = { repo, staged }`. Uses `lib/diff.js`. | Spec 001 R9; `git` (003) opens diffs here. |
| `viewers/index.js` | Registers `diff`. | |
| `external-open.js` (new) | "Open in <app>" from `~/.config/herdr-mods/external.json` rules (`lib/external.js`), run on the file's machine. | Spec 001 R14 / spec 005 R9–R11. |
| `preview.js` | Picks `diff` for `props.diff`; looks up the external rule once; header button "Open in <app> ↗". | |
| `mod.json` | `"lib": ["filetype.js", "diff.js", "external.js"]` (copied in by `install.sh`). | |
| `markdown-blocks.js` | A ```` ```mermaid ```` fence is its own block, `{ mermaid: { source } }`. | Spec 012 R1. |
| `programs.js` | `mermaid` command: `MERMAID` (sh) and `MERMAID_WINDOWS` draw a diagram with `mmdc` into the cache as `mermaid-<key>.png`. | Spec 012 R2, R6. |
| `media.js` | `drawMermaid(source, theme)`: runs it, returns the picture at half its pixels (drawn at scale 2). | Spec 012 R2, R4. |
| `viewers/markdown.js` | Draws diagrams in the background after the document shows; "drawing…", the picture (a click opens it in the image viewer), or the code with why not. | Spec 012 R2–R5. |
| `mod.json` | `"lib"` adds `"mermaid.js"` (theme choice, failure wording). | Spec 012. |
| `kinds.js` | `ipynb` → `notebook`; `html`, `htm`, `docx`, `doc`, `odt`, `rtf` → `document`. | Spec 017. |
| `viewers/notebook.js` (new) | A notebook as Markdown (`lib/notebook.js`), drawn by the Markdown viewer; its pictures staged into the cache. | Spec 017 R1. |
| `viewers/markdown.js` | `loadText(text, file, env, previous, pictures)` exported (`load` calls it); `nbimg:` picture references resolved through `pictures`. | Spec 017 R1. |
| `media.js` | `stageData(ext, data)`: base64 text written to the cache, then decoded by `programs.decode`. | Spec 017 R1: a binary `fs.writeFile` leaves an empty file on Windows. |
| `programs.js` | `decode` (POSIX `base64 -d`, Windows `WriteAllBytes`); `convert`: `CONVERT` (sh) and `CONVERT_WINDOWS` print HTML to PDF with a headless browser (Chromium/Chrome/chrome-headless-shell; Chrome/Edge) and convert Word/RTF/ODT with LibreOffice, into the cache as `<key>-<mtime>.pdf`. | Spec 017 R3–R5. |
| `viewers/document.js` (new) | HTML and documents through `convert`, then the PDF viewer; HTML gets Rendered/Raw. The browser gets a copy without scripts (`lib/html-print.js`). | Spec 017 R3, R4. |
| `viewers/diff.js` | Unified or side by side (remembered), word changes, syntax colours, folded context, a commit's file list. | Spec 017 R2. |
| `viewers/sheet.js` (new) | Spreadsheets: `convert` kind `sheet` (LibreOffice to `.fods`), `lib/fods.js`, drawn by the table viewer; sheets picked in the toolbar. `kinds.js` maps `xlsx`, `xls`, `ods`. | Spec 017 R4a. |
| `media.js`, `viewers/pdf.js`, `viewers/image.js` | `fetchHere(file, on)`: a remote file copied into the cache (base64 over sh); the PDF and image views use it instead of refusing remote files. | Spec 017 R4b. |
| `viewers/index.js` | Registers `notebook`, `document` and `sheet`. | Spec 017. |
| `mod.json` | `"lib"` adds `"notebook.js"`, `"html-print.js"`, `"fods.js"`. | Spec 017. |
| `vendor/cria/tests/programs.test.mjs` | Prune test is "over a day old"; new tests: keeps newest `KEEP`, stage replaces an older copy. | Follows the prune change. |
| `vendor/cria/tests/windows.test.mjs` | `linux.prune` is now `sh`, not `find`. | Follows the prune change. |

## Updating from upstream

1. Clone upstream at the new commit; diff `file-preview/mods/cria-file-preview/`
   against the commit above (`git diff <old>..<new> -- file-preview/`).
2. Apply that diff here; resolve conflicts around the `herdr-mods` markers.
3. Copy new/changed tests and samples; re-point imports to `../../../mods/`.
4. `npm test`, `./install.sh cria-file-preview`, `herdr-app check`, then the
   real-window checks in spec 001.
5. Update the commit line above.
