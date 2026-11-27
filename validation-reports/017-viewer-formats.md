# Validation report: spec 017, the viewer's new formats

- **Spec**: specs/017-viewer-formats.md (issue #52)
- **Date**: 2026-11-26
- **Commit**: the commit that closes #52.

## Phase 3: Tests

| Platform | Command | Result |
|---|---|---|
| macOS (njv-mbp-m1) | `npm test` | 328 tests: 314 pass, 0 fail |
| Linux (njv-cachyos) | `./run-tests.sh` | 328 tests: 315 pass, 0 fail |
| Windows (win11-kvm) | `node --test` on the working files (`tools/test-windows.sh` sends HEAD only, so it ran before the new tests were committed) | 325 tests: 307 pass, 0 fail, 18 skipped |

New and extended tests:
- **`tests/notebook.test.js`:** cells in order, In [n], outputs (streams, results,
  errors with ANSI stripped, pictures), fences longer than the code's backticks.
- **`tests/diff.test.js`:** side-by-side pairing, word changes, folded context, the
  generic highlighter.
- **`tests/html-print.test.js`:** scripts, `on…=` handlers and `javascript:` links
  removed; the `<base>` placement; folder URLs on POSIX and Windows.
- **`tests/fods.test.js`:** sheets in order, shown text, repeated rows and columns,
  trailing empties dropped, the limit, covered cells.

Conversions (the viewer's own `programs.js` scripts, each output checked to land
in the cache): HTML, DOCX, RTF, XLSX and ODS on Linux and Windows; HTML, DOCX and
XLSX on macOS. `herdr-app check` passes for cria-file-preview on every machine.

Real window: on the Mac, the samples and a 159-page manual were seen in
screenshots; the operator confirmed the rest, including remote files, on
2026-11-26.

## Phase 4: Code quality

- The copy of a remote file is in one place, `media.js` `fetchHere`, used by the
  PDF, image, document and spreadsheet views. Before this, the document view had
  its own copy, and the PDF and image views refused remote files.
- One conversion script per system (`CONVERT`, `CONVERT_WINDOWS`) covers HTML,
  documents and spreadsheets.
- The pure parsing is in `lib/`: `notebook.js`, `diff.js`, `html-print.js` and
  `fods.js`.
- The spreadsheet view reuses the table view's drawing.

## Phase 5: Security

- **Dependency scan:** the repository has no npm dependencies, so there is nothing
  to scan (`npm audit` needs a lockfile and finds none).
- **HTML:** the browser prints a copy with scripts, inline handlers and
  `javascript:` links removed. It runs headless, with a throwaway profile in the
  cache, which is removed afterwards. The `<base>` only points at the page's own
  folder.
- **Documents and spreadsheets:** LibreOffice runs headless, with a throwaway
  profile, on a copy of the file. Macros don't run in headless conversion.
- **Remote copies:** the file path goes to `sh -c` as an argument, never inside the
  script. Copies are capped at 50 MB and named by a hash.
- **Commands:** every program and argument is passed as an argument list.
  PowerShell values go in as character codes (`platform.js`).
- **Cache:** it stays bounded by the existing prune (a day, at most 200 files).
- **Secrets:** none.

## Phase 5.5: Release safety (minimal)

Rollback:
1. Revert this commit.
2. Run `./install.sh cria-file-preview` on each machine.

LibreOffice can stay installed; nothing else depends on it.

Platforms: all three were tested. Windows was tested by conversion scripts and
`herdr-app check`; its window was not screenshotted for these formats.
