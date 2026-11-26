# Validation report: spec 006, evaluate herdr-nvim

- **Spec**: specs/006-evaluate-herdr-nvim.md (issue #6)
- **Date**: 2026-11-25
- **Outcome**: skip (agreed with the operator). Evaluation only: no code in this
  repository changed.

## Phase 3: Tests

No code changed, so no test run is needed for this spec. The trial's own checks:
`herdr-app check` passed for `herdr-nvim` and `herdr-nvim-header` in the test home,
`herdr-app status` showed no errors there, and the default and work homes had no
herdr-nvim keys, mods or layout entries before or after.

## Phase 4: Code quality

Not applicable (no code changed).

## Phase 5: Security

- Source review of ChmaraX/herdr-nvim at `2905408` (spec, "Source review"): argument
  lists everywhere (no shell on the app's paths), no telemetry, network only for an
  opt-in Neovim download; reads agent session logs for file paths only.
- Dependency scan: `cargo audit` 0.23.0 (installed with pacman on njv-cachyos, with
  the operator's approval) on its `Cargo.lock`: 3 vulnerabilities (libz-sys
  RUSTSEC-2026-0418 and -0544, url RUSTSEC-2026-0592), 3 unmaintained crates. Part of
  the reasons for the decision.
- The binary ran only in a throwaway app home on its own core session; built from
  source, never from the published `curl | sh` installer.

## Phase 5.5: Release safety (minimal)

Nothing shipped. The trial was uninstalled with its own uninstaller, and every folder
it created was removed and checked (spec, "Clean-up").

## Spec reconciliation

All five criteria checked; the hands-on trial is marked as stopped by the operator
before the picker and comments were tried, which the decision did not need. Status:
COMPLETE (decision: skip).
