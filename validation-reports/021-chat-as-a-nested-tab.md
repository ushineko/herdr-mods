# Validation report: spec 021, chat as a nested tab

- **Spec**: specs/021-chat-as-a-nested-tab.md (issue #54)
- **Date**: 2026-11-27
- **Commit**: the commit that closes #54.

## Phase 3: Tests

| Platform | Command | Result |
|---|---|---|
| macOS (njv-mbp-m1) | `npm test` | 352 tests: 338 pass, 0 fail |
| Linux (njv-cachyos) | `./run-tests.sh` on the working files (before `moveIndex`) | 351 tests: 338 pass, 0 fail |
| Windows (win11-kvm) | `node --test tests/*.test.js` on the working files (before `moveIndex`) | 238 counted (the same 31 files; that Node counts fewer), 0 fail |

New and extended tests:
- **`tests/chat-stack.test.js`:** which hidden tab belongs to which chat
  (`chatPairs`), the strip's entries and stepping across the chat and the
  terminals, and `moveIndex` skipping hidden tabs and wrapping.
- **`tests/quick-find.test.js`:** a chat's partner tab is left out of
  Ctrl+Space while it's shown.

`herdr-app check` passed for nested-tabs, ushi-naruse, terminals-bar-proc
and spaces-bar on all three machines.

Real window, by command with screenshots (Mac; the njv-cachyos window for a
Mac chat): the strip on both sides, the keys stepping round it, Show terminal,
**+** from the chat (with and without nested tabs), `agent.focus` landing on the
chat, Back to terminal and closing the chat's tab keeping the agent and its
shells. Pointer, scroll position and the palette's move entries: the operator,
2026-11-27.

## Phase 4: Code quality

- The pure parts are in `lib/chat-stack.js` (pairs, entries, steps, moves) and
  shared by nested-tabs, terminals-bar-proc and spaces-bar.
- A strip switch is one path: `stack.js` `reveal` (marked, then
  `tab.select`) for terminals, `chat.js` `toChat` for the chat; the chat's
  Show terminal and the bar's tab click use the same mark.
- The strip's drop handling, drawn twice before, is one method (`dropIn`).

## Phase 5: Security

- **Dependency scan:** the repository has no npm dependencies (`npm audit`
  finds no lockfile), so there is nothing to scan.
- **Inputs:** only terminal labels and app state; nothing is run through a
  shell. New shared keys hold ids and times.
- **Secrets:** none.

## Phase 5.5: Release safety (minimal)

Rollback:
1. Revert this commit.
2. Run `./install.sh nested-tabs ushi-naruse terminals-bar-proc spaces-bar`
   on each machine.

Chats then open beside a stack again. Nothing stored needs undoing: the mark
and the pair-side memory are per window.

Platforms: macOS and Linux tested in the window; Windows by unit tests and
`herdr-app check` only.
