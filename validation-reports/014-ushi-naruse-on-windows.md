# Validation report: spec 014, ushi-naruse on Windows

- **Spec**: specs/014-ushi-naruse-on-windows.md (issue #45)
- **Date**: 2026-11-26
- **Commits**: 0a8a98b (A: chats in a Windows window), f30e4ec (B: agents on
  Windows; Requirements), and the commit that closes #45. Dotfiles: aed369a
  (Windows mermaid-cli module).

## Phase 3: Tests

| Platform | Command | Result |
|---|---|---|
| macOS (njv-mbp-m1) | `npm test` | 274 pass, 0 fail |
| Linux (njv-cachyos) | `./run-tests.sh` | 275 pass, 0 fail |
| Windows (win11-kvm) | `tools/test-windows.sh` | 288 tests: 270 pass, 0 fail, 18 skipped |

New and changed tests:
- `tests/chat-entries.test.js`: `platformFrom` (uname for macOS and Linux,
  PowerShell for Windows, unknown when neither answers), `platformOf` (this
  computer is the window's; another machine is probed once), and `chatEntries` on
  Windows (Claude Code only, no python3 needed; an unknown system gets nothing).
- `tests/chat-sdk.test.js`: the bridge's input lines, its answers by request id
  (errors, missing answers, the newest command list, CRLF), Claude Code's project
  folder name for Windows and POSIX paths, session titles, the sessions list.
- `tests/image-size.test.js`: PNG, GIF, JPEG (after other segments), the three
  WebP kinds, non-images and cut-off headers.
- `tests/mermaid.test.js`: `lib/mermaid.js` `MERMAID_WINDOWS` run through
  `lib/powershell.js` is the viewer's Windows command, character for character.

The tests take and return plain data. Herdr's API is not mocked.

Run directly on win11-kvm, outside the app, against the local Claude Code: the
session lookup's script, the sessions list (the `sysadmin` logs and their title
lines), the bridge's `initialize` (Claude's command list came back), the log's
size and a read from an offset, `Get-Content -Tail`. Two bugs found and fixed this
way: a lost backslash in the sessions path, and `claude` resolving to npm's `.ps1`
shim, which can't be started as a process.

Real window (Windows app, operator, 2026-11-26):
- **A (an agent on another machine):** a chat with the Mac's Claude Code: the
  conversation, images, Send for a suggestion, copying a reply, Ctrl+V of a
  screenshot, the + picker, Show/Hide terminal. Images were empty on the first try
  (a binary `fs.writeFile` leaves an empty file on Windows); fixed with a base64
  write decoded by PowerShell, then cached at full size (398,662 bytes, as on the
  Mac).
- **B (the agent on Windows):** a chat with Claude Code in `sysadmin` on
  win11-kvm: the conversation from its log (591,690 bytes), a Mermaid diagram
  (`mermaid-40186f75….png`, mermaid-cli from npm), live replies, the / menu, the
  model picker, `/btw`.

`herdr-app check` passes for every changed mod on macOS, Linux and Windows (on
Windows run in the desktop session: in an SSH session it can't open its window).

Not covered:
- **Codex on Windows:** its bridge isn't ported, and the chat isn't offered for
  it (Codex isn't installed on win11-kvm).

## Phase 4: Code quality

- **Shared code goes in `lib/`:** the platform probe (`chat-entries.js`), the
  PowerShell runner (`powershell.js`, the viewer's convention), image sizes
  (`image-size.js`), the bridge's JSON side (`chat-sdk.js`). Tests keep the
  Windows Mermaid script identical to the viewer's.
- **One place picks the form:** `source.js` `onAgent()` runs the sh or the
  PowerShell script by the agent's machine; `main.js`, `models.js` and
  `commands.js` use it, so each Windows script sits next to its sh counterpart.
- **Removed:** naruse's `NEW_SPACE` sh script (now `newSpace()` in JS), the
  Python image-size script (now JS on every system), seven shell sleeps (now
  `cx.sleep`), `commands.js`'s unused `exec` import.

## Phase 5: Security

- **Dependency scan:** the repository has no npm dependencies, so there is nothing
  for `npm audit` to scan. mermaid-cli 12.2.0 on Windows was installed by the
  operator with npm.
- **Input handling:** every value reaches PowerShell as character codes, so file
  names, folders, session ids and prompts can't change the script. The scripts use
  no double quotes, so Windows PowerShell 5 has none to mangle. The bridge's
  requests go to `claude` on its stdin, not its command line. Its only
  command-line value is the session id, read from the log's file name and limited
  to hex digits and dashes.
- **Temporary files:** clipboard text and log images pass through files in the
  app's own data folder, which are deleted after use.
- **Network:** nothing is sent off the machine.
- **Secrets:** none in the changed code.

## Phase 5.5: Release safety (minimal)

Rollback: revert f30e4ec and then 0a8a98b, and run `./install.sh` on each machine.
That puts back the gate that hides the chat on Windows. macOS and Linux keep their
sh and python3 paths throughout. The one change to them is image size, now read in
JS instead of Python, and reverting puts Python back.
