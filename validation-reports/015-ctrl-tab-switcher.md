# Validation report: spec 015, the Ctrl+Tab switcher

- **Spec**: specs/015-ctrl-tab-switcher.md (issue #50)
- **Date**: 2026-11-26
- **Commits**: feee897 (the switcher, other windows, KWin raise, chat cursor), and
  the commit that closes #50. Dotfiles: 553843f (the keys, every machine).

## Phase 3: Tests

| Platform | Command | Result |
|---|---|---|
| macOS (njv-mbp-m1) | `npm test` | 298 pass, 0 fail |
| Linux (njv-cachyos) | `./run-tests.sh` | 299 pass, 0 fail |
| Windows (win11-kvm) | `tools/test-windows.sh` | 312 tests: 294 pass, 0 fail, 18 skipped |

`tests/tab-order.test.js` (5 tests) covers:
- **A row's details:** a chat's tab is titled after its agent's conversation, with
  the project. A shell's tab falls back to its program's name when its title is a
  path, and a remote space keeps its machine.
- **Recording:** the shown tab moves to the front, and the list is capped.
- **The live order:** recorded tabs stay in their order with today's details, gone
  ones drop out, and new ones follow.
- **The merged list:** the shown tab first, then everything else, other windows
  included, by when it was last shown.

Real window (operator, 2026-11-26), on all three systems: hold and release, a quick
tap, Esc, a click, and Ctrl+click on macOS. On njv-cachyos, the other window's tabs
are listed and raised.

Found and fixed on the way:
- **The raise:** a second launch of the session didn't take the focus under
  Wayland. Now a KWin script activates the window by title. A probe first
  confirmed KWin lists "Herdr (default)" and "Herdr (work)".
- **Selection skipped the other window:** the other window's tabs arrived after
  the dialog had opened, so the selection stayed in this window. They are now
  read ahead, every 2 s.
- **The order across windows:** a window now re-stamps its shown tab when it gets
  the focus.
- **The chat's cursor:** it goes to the message box when the chat is focused in
  the active window. The first version only reacted to pane focus, so it worked
  once.
- **macOS Ctrl+click:** it arrives as a right-click, so rows take that too.

`herdr-app check` passes for spaces-bar and ushi-naruse on every machine, and
`herdr-app status` shows no errors in any window.

## Phase 4: Code quality

- `main.js` stays the bar. The switcher is in `switcher.js`, and the other-window
  plumbing shared with the inbox is in `others.js`: the sibling script, the
  siblings list, and showing something in another window. The pure order logic
  is in `lib/tab-order.js`.
- No dead code: a selection flag left over from an async rebuild went with the
  rebuild.

## Phase 5: Security

- **Dependency scan:** the repository has no npm dependencies, so there is nothing
  to scan.
- **The raise script:** the session name is checked against `[a-z0-9-]` before it
  goes into the KWin script. The script lives in a fresh temp file, removed after
  use, and is loaded and unloaded under a fixed name. App commands go to the other
  window through its own CLI, with JSON from `JSON.stringify`.
- **Reading other homes:** the other windows' `shared.json` is only read, never
  written.
- **Secrets:** none in the changed code.

## Phase 5.5: Release safety (minimal)

Rollback:
1. Revert feee897 and this commit.
2. In each `keys.json`, bind `ctrl-tab` back to `tab.next` and `ctrl-shift-tab` to
   `tab.prev` (backups: `keys.json.bak-switcher`); revert dotfiles 553843f.
3. Run `./install.sh` on each machine.
