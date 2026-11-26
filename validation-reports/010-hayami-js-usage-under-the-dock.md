# Validation report: spec 010, hayami-js: usage under the dock's nav and git

- **Spec**: specs/010-hayami-js-usage-under-the-dock.md (issue #26)
- **Date**: 2026-11-25
- **Outcome**: complete. Commits f5ccbbd, 2d4c8ff, 3d49dd7 and the spec's closing commit
  (#26); dotfiles 5282127 (layout snapshots).

## Phase 3: Tests

- `./run-tests.sh` (njv-cachyos): 237 tests, 224 pass, 0 fail, 13 skipped.
- `npm test` (njv-mbp-m1): 237 tests, 223 pass, 0 fail, 14 skipped.
- `tools/test-windows.sh` (win11-kvm): 237 tests, 220 pass, 0 fail, 17 skipped.
  The live hayami case skips there by design (no Unix socket on Windows).
- New: `tests/hayami.test.js`, 16 cases. 15 unit cases on invented data (request
  per platform, path allow-list, parse of 200 / error envelope / no service / no
  curl / not JSON / Windows output, readings, usageRows, until, pollEvery) and one
  integration case that runs the real curl command against the running service on
  the machine running the tests (ran on njv-cachyos and on the Mac).
- Contracts encoded are behavioural: what command reaches the machine, how an
  answer is classified, what rows the block draws. No herdr host API is mocked;
  the mod was checked in the real windows (spec, "E2E results").
- `herdr-app check` passed for `hayami-usage`, `dock-tabs` and `dock-follow` on both
  machines; `herdr-app status` shows no errors on either.

## Phase 4: Code quality

- `dock-follow`: the strip's code (`withPath`, `start`, `ensure`, its timer and
  constants) removed with its now-unused imports (`exec`, `home`, `run`).
- `hayami-usage`'s `platformOf` repeats the shape of nav's `machineOf` (uname, else
  Windows). Kept local: nav's also returns the home folder and its cache differs;
  a shared `lib/machine.js` is a candidate when a third mod needs it.
- No dead code found in the new files; `lib/hayami.js` has no herdr import.

## Phase 5: Security

- No dependencies added (no npm packages; curl and hayami-tui are the machine's).
- Shell input: the curl script is fixed text; the request path is passed as `$1`,
  never interpolated, and must match an allow-list of endpoints and section keys
  (`checkPath`, tested with injection attempts). Windows runs `hayami-tui` with an
  argument list, no shell.
- No credentials: the service serves none (hayami contract); nothing is logged.
  Diff scanned for tokens, keys and home paths: none.

## Phase 5.5: Release safety (minimal)

Rollback: revert the herdr-mods commits for #26 and the dotfiles commit, put the
`usage-dock` block back in `terminals-dock.json` (pre-edit copies were kept during
the session), reinstall; dock-follow starts the strip again on the next start.

## Spec reconciliation

All 13 criteria checked against the code and the real windows; status COMPLETE.
`main-bottom.json` (a layout not in use) still has the old `usage-dock` block,
noted in the spec.
