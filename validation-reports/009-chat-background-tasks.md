# Validation report: spec 009, background subagents and scripts in the chat

- **Spec**: specs/009-chat-background-tasks.md (issue #25)
- **Date**: 2026-11-25
- **Commits**: 5150cf7, c653606, 12ba454, and the commit that closes #25

## Phase 3: Tests

| Platform | Command | Result |
|---|---|---|
| macOS (njv-mbp-m1) | `npm test` | 239 tests: 225 pass, 0 fail, 14 skipped |
| Linux (njv-cachyos, at 12ba454) | `./run-tests.sh` | 226 pass, 0 fail, 13 skipped |
| Windows (win11-kvm) | `tools/test-windows.sh` | 239 tests: 222 pass, 0 fail, 17 skipped |

New tests: `tests/chat-tasks.test.js` covers launch recognition (started in the
background and moved there), TaskStop/KillShell results, notification parsing with
unescaping, final statuses, subagent progress, the stop message, `lastLines` and
`elapsed`. `tests/chat-text.test.js` covers the Stop menu items. Each test takes and
returns plain data, and checks what the helper reports, not how it does it.

The parser was also replayed over this session's real log
(`scratchpad/ptest/run.mjs`). Every background task came out with the right final
state: completed, killed from `/tasks` after 42 s, and stopped by TaskStop.

`herdr-app check ~/.config/herdr-app/mods/ushi-naruse` passes on both machines, and
`herdr-app status` shows no errors on either.

Real window (njv-mbp-m1), each criterion's evidence is in the spec:
- the strip with elapsed times, a strip click opening its row;
- a script's live last line and output;
- a subagent's tool count and step;
- "stopped · 7s";
- Stop from the chat ending the task;
- the strip going away once nothing runs.

## Phase 4: Code quality

- The pure parts (launches, notifications, progress, stop message) live in
  `lib/chat-tasks.js`. The mod only reads files and draws.
- No dead code was found in the changed files.
- `main.js` gained several methods: `readTasks`, `followSubagent`, `readOutput`,
  `stopTask`, `progressOf`, `backgroundStrip`. Each is under 50 lines.

## Phase 5: Security

- **Dependency scan**: none applicable. The repository has no npm dependencies; the
  mods run in Herdr's QuickJS with no packages.
- **New reads**: the change reads subagent logs and task output files. The session
  already wrote both, and they are read on the agent's machine through the existing
  `exec` argument lists. The only variables passed are paths and a tool-use id, as
  positional arguments (`"$1"`, `"$2"`); no untrusted text is spliced into a shell
  string. Output is shown as text, never run.
- **Stop**: sends Claude a fixed sentence holding the task id and the row's
  description, through the existing `deliverCommand` path. No new command execution.
- No credentials, tokens or secrets in the changed code or logs.

## Phase 5.5: Release safety (minimal)

The change is additive: the background mark, strip, progress and Stop are new, and
Codex chats are unchanged. To roll back, revert the spec 009 commits (5150cf7,
c653606, 12ba454), then run `./install.sh` on each machine (njv-cachyos:
`--home ~/.config/herdr-app --link ~/.config/herdr-app-work`, then restart the work
window).

## Untested

The Herdr app has not been tried on Windows. The chat itself needs python3 and `sh`
there (spec 008). On Windows only the unit tests were run.

## Spec reconciliation

All nine criteria are checked, each with where it was seen. Status: COMPLETE.
