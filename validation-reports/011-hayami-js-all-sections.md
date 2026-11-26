# Validation report: spec 011, hayami-js: every section, chosen in the dock

- **Spec**: specs/011-hayami-js-all-sections.md (issue #29)
- **Date**: 2026-11-26
- **Outcome**: complete. Commits 91aa70a, 220af3c, c7e54d9 and the spec's closing
  commit (#29); dotfiles 0a8042f (layout snapshots).

## Phase 3: Tests

- `./run-tests.sh` (njv-cachyos): 243 pass, 0 fail.
- `npm test` (njv-mbp-m1): 242 pass, 0 fail; the live case ran against the Mac's
  service.
- `tools/test-windows.sh` (win11-kvm): 239 pass, 0 fail, 17 skipped (the live case
  skips there by design: no Unix socket on Windows).
- New cases in `tests/hayami.test.js`: shown sections and their order, the cadence
  (`due`), arrangement and heights with both caps, hayami's units (fixed-width
  rates) and bands at their thresholds, `ago`, and a rows function per section on
  invented readings (nulls, unknown fields, stale items, second probes of a role).
  The live case now reads all five sections and holds each to its rows function.
- Contracts are behavioural: which sections are asked for and when, what a line
  says and how it is coloured, how tall the block asks to be. The herdr host API is
  not mocked; the block was checked in the real windows (spec, "E2E results").
- `herdr-app check` passed for `hayami` and `dock-tabs` on both machines;
  `herdr-app status` shows no errors on either.

## Phase 4: Code quality

- 010's `fitWindows` and the side-by-side usage windows went with #28; no dead
  exports remain in `lib/hayami.js` (each is used by the mod or its tests).
- The mod's `platformOf` still repeats nav's `machineOf` shape (noted in 010's
  report); unchanged.
- `location.js` is now used by the mod only for `shownSpace`; it stays in the
  mod's `lib` list for that.

## Phase 5: Security

- No dependencies added.
- The request path is still built only from the fixed section list and checked by
  `checkPath`; more keys from the same list. No caller text reaches a shell.
- `shared` holds the section keys and two heights; nothing secret. The service
  serves no credentials.

## Phase 5.5: Release safety (minimal)

Rollback: revert the commits for #29 and dotfiles 0a8042f, reinstall
`hayami-usage` and `dock-tabs`; the layouts' `dock-<side>-hayami` nodes are rebuilt
by the reverted dock-tabs on the dock's next showing. `hayami.sections` and
`hayami.px` left in `shared.json` are ignored by the 010 block.

## Spec reconciliation

All 11 criteria checked; the right-click route and survival across an app restart
were confirmed by the operator. Status: COMPLETE.
