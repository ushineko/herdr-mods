# Validation report: spec 024, a terminal pane's own text size

- **Spec**: specs/024-pane-font-size.md (issue #57)
- **Date**: 2026-11-27
- **Commit**: the commit that closes #57.
- **Needs**: the app fork at 0.1.18-ushineko.2 (ushineko/herdr-app 98f729e,
  its spec `ushineko/specs/002-pane-font-size.md`) for the controls to show.

## Phase 3: Tests

| Platform | Command | Result |
|---|---|---|
| macOS (njv-mbp-m1) | `npm test` | 351 pass, 0 fail |
| Linux (njv-cachyos) | `./run-tests.sh` on an export of main with this change | 352 pass, 0 fail |

No new unit tests: the change is drawing and a command call (`fontTools`), which
needs the host API; it was checked in windows instead (no mocking of the host).

`herdr-app check` passed for nested-tabs on the Mac and njv-cachyos.

Real windows:
- The fork's sandbox on njv-cachyos (the operator's `terminals-dock` layout):
  A+ twice on a stack's shown member (17 px, bright, larger text), the other
  member keeping 15, A− on a lone pane (14), clicking the size to reset (entry
  gone from view.json), tooltips. The same window on the released 0.1.18: no
  controls, no errors.
- After installing 0.1.18-ushineko.2: the Mac's chat header unchanged (the
  chat's own A−/size/A+ once, no second set); the njv-cachyos window drawing
  the same; a remote pane sized from the Mac saved only in the Mac window's
  view.json.

## Phase 4: Code quality

The chat's word buttons (A−, size, A+) were a local helper in `chatTools`; they
are now one method, `textButton`, used by the chat's controls and the new
`fontTools`.

## Phase 5: Security

- **Dependency scan:** no npm dependencies (no lockfile), nothing to scan.
- **Inputs:** `panes()` data and a fixed command (`pane.font` with a number or
  `reset`); nothing reaches a shell.
- **Secrets:** none.

## Phase 5.5: Release safety (minimal)

Rollback: revert this commit and run `./install.sh nested-tabs` on each
machine. Sizes already set stay in each window's view.json and keep applying;
`pane.font {pane, reset: true}` clears one, and an app without the fork patch
ignores them.

Platforms: macOS and Linux in windows; Windows (win11-kvm) installed with the
fork build, not looked at.
