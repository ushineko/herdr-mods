# Validation report: spec 016, the quick switcher (Ctrl+Space)

- **Spec**: specs/016-quick-switcher.md (issue #51)
- **Date**: 2026-11-26
- **Commits**: b7e8c9f, and the commit that closes #51. Dotfiles: 1835d64 (the key,
  every machine).

## Phase 3: Tests

| Platform | Command | Result |
|---|---|---|
| macOS (njv-mbp-m1) | `npm test` | 302 pass, 0 fail |
| Linux (njv-cachyos) | `./run-tests.sh` | 303 pass, 0 fail |
| Windows (win11-kvm) | `tools/test-windows.sh` | 316 tests: 298 pass, 0 fail, 18 skipped |

`tests/quick-find.test.js` covers:
- **The items:** tabs (settled ones out), spaces, a machine going to its most
  recent space, and nested tabs with the steps that show them.
- **The word score:** starts with, word start, contains, letters in order, no
  match.
- **The search:** every word must match, the title counts most, ties go by use,
  and an empty box lists recent tabs first.

`tests/tab-order.test.js` gained one test: a title that's only a terminal's address
is named after its program.

Real window (operator, 2026-11-26): search, Enter, Up/Down and Esc in each window;
the other window's tabs found and switched to on njv-cachyos; the cursor landing
in a chat found by search. Both windows were seen publishing their items (24 and
17). `herdr-app check` passes for spaces-bar and ushi-naruse on every machine.

Found and fixed on the way:
- **Unreadable titles:** some tabs were titled only with their terminal's address,
  so they're now named after their program.
- **No cursor in the chat:** the closing dialog took the keyboard back from a chat
  in the same window. Both switchers now post a focus request.

## Phase 4: Code quality

- The dialog is in `finder.js`, and the pure items and search in
  `lib/quick-find.js`, reusing `tabEntry`.
- The other windows' shared state is read once in `others.js` (`refreshOthers`,
  `OTHERS`) for both switchers. This replaced the Ctrl+Tab switcher's own reader,
  which is gone.

## Phase 5: Security

- **Dependency scan:** the repository has no npm dependencies, so there is nothing
  to scan.
- **Other windows' files:** their `shared.json` is only read. What a window
  publishes about itself is its open things' names, folders and app commands
  (ids), in its own app home.
- **Commands to another window:** as with spec 015, they go through its own CLI,
  with JSON from `JSON.stringify`.
- **Secrets:** none.

## Phase 5.5: Release safety (minimal)

Rollback:
1. Revert b7e8c9f and this commit.
2. Remove `ctrl-space` from each `keys.json`, and revert dotfiles 1835d64.
3. Run `./install.sh` on each machine.
