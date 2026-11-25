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
