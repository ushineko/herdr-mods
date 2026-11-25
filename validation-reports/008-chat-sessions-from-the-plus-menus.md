# Validation report: spec 008, chat sessions from the + menus

- **Spec**: specs/008-chat-sessions-from-the-plus-menus.md (issue #12)
- **Date**: 2026-11-25
- **Commits**: a8c5dc5 … 07cabe2 on main (spec 008 and the fixes found while testing it:
  #13, #14, #15, #17)

## Phase 3: Tests

| Platform | Command | Result |
|---|---|---|
| macOS (njv-mbp-m1) | `npm test` | 206 tests: 192 pass, 0 fail, 14 skipped (platform-specific) |
| Linux (njv-cachyos) | `./run-tests.sh` | 206 tests: 193 pass, 0 fail |
| Windows 11 (win11-kvm) | `tools/test-windows.sh` | 206 tests: 190 pass, 0 fail, 16 skipped |

`herdr-app check` passes for every mod on both machines; `herdr-app status` shows no
errors in either app home on njv-cachyos or on the Mac. `shellcheck tools/gallery.sh`
is clean.

New unit tests (tests/chat-entries.test.js, tests/git.test.js) encode behaviour:
which chat entries show per platform, python3 and installed agent; which agents end
when their chat closes (only panes seen in this run, after a grace period, ids
compared without their machine part); which hidden terminal tabs come back, are
settled in a window, or are renamed; which agents a closing tab keeps; which tab to
show before the shown tab closes; where an agent is placed (first signal decides).

Real window (E2E): each requirement was exercised in the running app, on the Mac
through the mods' own commands (no click API) and by the operator on njv-cachyos; see
the spec's checked criteria for where each was seen.

## Phase 4: Code quality

- Shared pure logic lives in lib/chat-entries.js (no herdr imports); mods keep only the
  host calls. Small helpers repeated across mods (a python3 probe, a short wait) are
  each a few lines, kept per mod because a mod can import only its own files and lib/.
- The forked chat (mods/ushi-naruse) differs from upstream 05ef3ed only in the changes
  the spec lists (R1a–R1f, R8, R9, R10, R11, R13), each marked "ushi-naruse" in the code.

## Phase 5: Security

- Dependency scan: none to run; the project has no npm dependencies (no package-lock,
  no node_modules). The vendored chat was source-reviewed at 05ef3ed (spec 008,
  Context): no network access of its own, no eval, untrusted text reaches `sh -c` only
  as positional arguments.
- Secrets: no credentials in the 56 files changed under mods/, lib/, tools/, tests/.
- Commands: every exec/hc call passes arguments as arrays; the only `sh -c` scripts are
  fixed strings. The clean-up kills only terminals labelled `hm.chat` by these mods.
- Known behaviour kept from upstream and documented: a model or effort switch backs up
  and restores `~/.claude/settings.json`; Claude's "trust this folder" is answered only
  for chats started from the chat's own New chat form (not used here).

## Phase 5.5: Release safety (minimal)

Rollback: revert the spec 008 commits, remove `mods/ushi-naruse`, `mods/ushi-naruse-file`
and `data/ushi-naruse` from the app homes, and reinstall. Chat agents are ordinary
herdr-core terminals; Back to terminal returns a session to its terminal first.

## Spec reconciliation

Every acceptance criterion in spec 008 is checked, each with where it was seen; R2a
(right-click on the tab bar's +) was confirmed by the operator in a real window, since no
command can open that menu with its props. Status: COMPLETE.

## Addendum (after completion)

R1g (chat text size, #18) and R14 (right-click menu, #19) were added after the first
close-out and verified the same day: R1g on the Mac (15 px by default, 17 after two
steps, reset); R14 by the operator (a reply quoted through the menu). Tests: 196 pass on
the Mac, 197 on njv-cachyos, 0 failures; `herdr-app check` passes.
