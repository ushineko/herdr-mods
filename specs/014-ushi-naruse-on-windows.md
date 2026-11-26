# 014 — ushi-naruse on Windows

**Issue**: #45

## Status: INCOMPLETE

## Executive Summary

The chat (ushi-naruse, spec 008) ran only on macOS and Linux: upstream
(naruse/herdr-chat) drove everything through `sh -c` and `python3`, and our fork
hid the chat on Windows. With the Herdr app on win11-kvm (spec 013), the chat
works there in two steps: A, in a Windows window for agents on any other machine;
B, for agents running on Windows itself, with PowerShell for what ran in sh and
Python (operator's choice, 2026-11-26).

## Context

- naruse's commands split two ways. Those for the window itself (the clipboard,
  pasted images, the file picker, its image cache, Mermaid, the app's CLI, waits)
  run on the computer that shows the chat. Those for the agent (its session log,
  reading the log as it grows, settings and plugins files, the file list for
  @-mentions, the SDK bridge that runs `claude -p` in stream-json mode) run on the
  agent's machine (`exec(…, { on })`).
- The SDK bridge (`sdk.js`) is Python built on `select()`, which doesn't work on
  Windows pipes; Windows has no `sh` outside Git Bash, which a core doesn't use, and
  `python3` there is the Microsoft Store stub.
- Found on Windows: `fs.writeFile` with binary data leaves an empty file, text is
  written correctly.

## Requirements

- R1 **Where the chat runs.** The chat is offered for an agent when the agent's
  machine can run it, whatever the window's system: a machine's system is probed
  once (`uname`, else PowerShell) by `lib/chat-entries.js` `platformOf`, used by
  nested-tabs (the cow, the + menus) and dock-tabs.
- R2 **The window's own commands on Windows.** No `sh` or `python3` on the window's
  computer: waits are `cx.sleep`; the app's CLI is called directly; a new chat's
  space is made in JS; the clipboard, pasted images, opening a file, the file
  picker, copies and cache cleanup are PowerShell (`lib/powershell.js`, the viewer's
  convention); image sizes are read from the file header in JS (`lib/image-size.js`,
  every system); Mermaid uses the viewer's Windows script (`lib/mermaid.js`
  `MERMAID_WINDOWS`); images from the log are written as base64 text and decoded by
  PowerShell.
- R3 **Agents on Windows.** For a Claude Code on a Windows machine: its session log
  is found, read as it grows, and the chat's other reads of the agent's machine
  work, with PowerShell; the SDK bridge (commands, models, side questions, sessions)
  has a PowerShell form. Codex on Windows: as far as the same pieces reach.
- R4 **Nothing changes on macOS and Linux** but the image size (read in JS there
  too) and the shared helpers; their tests pass on all three systems.

## Acceptance Criteria

- [x] R1: unit tests for `platformFrom` and `platformOf` (probed once; this
  computer is the window's); the cow shows in the Windows window for a Claude Code
  on the Mac (operator, 2026-11-26).
- [x] R2: in the Windows window, a chat with the Mac's Claude Code shows the
  conversation, its images (cache files written in full: 398,662 bytes, as on the
  Mac) and Send for a suggestion (operator). Unit tests: `imageSizeOf` (PNG, GIF,
  JPEG, three WebP kinds), `MERMAID_WINDOWS` the same as the viewer's command.
  Not yet seen on Windows: copying a reply, Ctrl+V of a screenshot, the + picker,
  Show/Hide terminal.
- [ ] R3: a chat with Claude Code running on win11-kvm: the conversation, live
  replies, the command menu and models, a side question.
- [ ] R4: `npm test` on macOS, `./run-tests.sh` on Linux, `tools/test-windows.sh`;
  a chat on the Mac and on njv-cachyos still works.

## Test approach

Unit: the pure pieces (`platformFrom`, `imageSizeOf`, the PowerShell command lines,
the Windows forms of the agent-side scripts where they are pure). The rest in the
real Windows window, through the operator and `herdr-app shot`.

## Threat model delta

PowerShell gets every value as character codes (no quoting, no injection through
a file name or a message); clipboard text and images go through files in the app's
own data folder, removed after use. Nothing new leaves the machine.
