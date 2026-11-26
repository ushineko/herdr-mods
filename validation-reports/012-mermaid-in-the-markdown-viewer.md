# Validation report: spec 012, Mermaid diagrams in the Markdown viewer

- **Spec**: specs/012-mermaid-in-the-markdown-viewer.md (issue #30)
- **Date**: 2026-11-25
- **Commits**: 679ae03, and the commit that closes #30

## Phase 3: Tests

| Platform | Command | Result |
|---|---|---|
| macOS (njv-mbp-m1) | `npm test` | 249 pass, 0 fail |
| Linux (njv-cachyos) | `./run-tests.sh` | 250 pass, 0 fail |
| Windows (win11-kvm) | `tools/test-windows.sh` | 263 tests: 245 pass, 0 fail, 18 skipped |

`tests/mermaid.test.js` (7 tests) covers:
- block splitting: tilde and long fences, a mermaid fence nested in another fence,
  an unclosed fence;
- the theme choice;
- failure wording, using `mmdc`'s real parse-error output;
- the command lines on POSIX and Windows: the diagram source travels as an
  argument and never in the script text;
- the real POSIX render script with a stand-in `mmdc`: drawn once, then reused; a
  failure leaves no files behind. Skipped on Windows.

The tests take and return plain data, or run the real script. Herdr's API is not
mocked.

Real window:
- **Diagrams drawn:** the operator's `home-network.md` (two diagrams), dark theme,
  on njv-cachyos (21:21) and on the Mac (21:39, screenshot), the same cache names on
  both.
- **Confirmed by the operator:** a click opens a diagram zoomable; the broken sample
  diagram shows its code and Mermaid's error.
- **Herdr's bare PATH on the Mac:** the mod's command finds Homebrew's `mmdc` and
  draws in 0.8 s.

Not seen in the window:
- **Light theme:** not checked, by the operator's call; the theme choice is
  unit-tested.
- **"Mermaid isn't installed" note:** unit-tested only, since both machines have
  `mmdc`.
- **The Herdr app on Windows:** not tried; the PowerShell render script is untested.

`herdr-app check` passes and `herdr-app status` shows no errors on both machines.

## Phase 4: Code quality

- The pure parts are in `lib/mermaid.js` (theme, failure wording) and in the
  vendored `markdown-blocks.js` and `programs.js`. Every change to the vendored mod
  is marked `herdr-mods` and listed in `vendor/cria/VENDOR.md`.
- No dead code was found. `drawDiagrams` and `diagram()` are short, and follow the
  viewer's existing `loadWeb` and `picture()` patterns.

## Phase 5: Security

- **Dependency scan:** the repository has no npm dependencies, so there is nothing
  to scan. `mermaid-cli` 12.2.0 is a system package: pacman on njv-cachyos,
  Homebrew on the Mac, plus Puppeteer's `chrome-headless-shell` 156.0.8078.47 in
  `~/.cache/puppeteer`, fetched with the operator's approval of the install.
- **Input handling:** the diagram source reaches `mmdc` as a positional argument
  and then a file in the viewer's cache, never as shell text. A unit test passes a
  source containing `$(rm -rf ~)` and checks that it stays out of the script. On
  Windows the values go as character codes, as in the viewer's other PowerShell
  scripts.
- **Mermaid's own security:** Mermaid runs with its default `securityLevel`
  (`strict`). The output is a PNG, so nothing from a diagram runs in the app.
- **Network:** nothing is sent off the machine.
- **Secrets:** none in the changed code.

## Phase 5.5: Release safety (minimal)

The change is additive: without `mmdc`, a mermaid block shows as code with a note,
as before plus the note. To roll back, revert 679ae03 and the closing commit, then
run `./install.sh` on each machine. Cached `mermaid-*.png` files are pruned with
the rest of the cache (a day, or past 200 files).

## Spec reconciliation

All seven criteria are checked, with the light theme and the not-installed note
marked as unit-tested only. Status: COMPLETE.
