# 016 — Quick switcher (Ctrl+Space)

**Issue**: #51

## Status: COMPLETE

## Executive Summary

Ctrl+Space opens a search box over the window: type part of a name, and the
matching open things are listed, best first. Enter (or a click) switches to one:
a tab, a nested tab, a space or a machine, in this window or another window on
this computer (as the inbox and the Ctrl+Tab switcher reach them, #48, spec 015).

## Requirements

- R1 **What it finds.** Everything open in every window on this computer:
  - tabs, by their title (an agent's conversation, a file's name), project
    folder, space and machine;
  - nested tabs (the terminals nested-tabs keeps in a pane: `nt.stack`), by their
    name;
  - spaces, by name;
  - machines, by name (choosing one shows its most recently used space).
  Settled tabs (a chat's hidden agent terminal) are left out.
- R2 **Matching.** Case is ignored; every word typed has to match some field; a
  name that starts with it ranks above one with a word that starts with it, above
  one that only contains it, above letters in order (a fuzzy match). Ties go to the
  most recently used. An empty box lists the recent tabs first.
- R3 **Keys.** Ctrl+Space opens it with the cursor in the box; Up/Down move,
  Enter switches, Esc closes; a click switches. On every system (on the Mac, its own
  input-source shortcut takes Ctrl+Space first when it has several input sources).
- R4 **Other windows.** Each window publishes what it has open in its app home's
  shared state; the others read it (open windows only). Choosing one of theirs
  shows it there and brings that window forward (KWin on KDE).
- R5 **Rows.** Kind (tab, nested tab, space, machine) as an icon, the name with
  the matched letters marked, the project and space, a machine's tag in its
  colour, another window's tag.

## Acceptance Criteria

- [x] R1/R2: unit tests: the items built from the app's lists (tabs, nested tabs,
  spaces, machines; settled tabs out), and the matching and ranking
  (`tests/quick-find.test.js`; a title that's only a terminal's address is named
  after its program, `tests/tab-order.test.js`).
- [x] R3: in the window: Ctrl+Space, type, Enter switches; Up/Down; Esc (operator,
  2026-11-26). A chat landed on takes the keyboard (both switchers post
  `ushi-naruse.focus-request` once their dialog has closed).
- [x] R4: on njv-cachyos, a work-window tab found from the default window, and
  switched to there (operator). Each window publishes its items (24 and 17 when
  first checked); one cached read of the other windows (others.js) now serves both
  switchers.
- [x] R5: rows as described (operator).
- [x] Keys in each machine's keys.json and its dotfiles snapshot (dotfiles
  1835d64); `herdr-app check` passes on every machine; tests pass: macOS 302,
  Linux 303, Windows 298 of 316 (18 skipped), no failures.

## Test approach

Unit (node --test, plain data): lib/quick-find.js. The dialog, the keys and the
switch in the real window on each machine; the other window on njv-cachyos.
