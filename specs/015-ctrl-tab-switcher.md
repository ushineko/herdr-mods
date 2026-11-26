# 015 — Ctrl+Tab switcher

**Issue**: #50

## Status: COMPLETE

## Executive Summary

Ctrl+Tab steps to the next tab in order, and shows nothing. This spec makes it a
Vivaldi-style switcher: tabs in the order they were last shown, a list that pops up
while Ctrl is held, and the switch made when Ctrl is released. It covers this
window's tabs on every machine and the other windows on this computer, as the inbox
does (spec 015 builds on the inbox's other-window support, #48).

## Requirements

- R1 **Order.** Each window records the tabs it shows, most recent first (tab,
  space, machine, the tab's title, its program, its project folder, when), in its
  own shared state; a tab that's gone drops out. The list starts from the tabs open
  now when nothing is recorded yet.
- R2 **Keys.** Ctrl+Tab opens the switcher with the previous tab selected;
  Tab and Shift+Tab (Ctrl held) move down and up; releasing Ctrl switches; Esc
  closes without switching; a click on a row switches. A quick tap of Ctrl+Tab
  switches to the previous tab. Ctrl+Shift+Tab opens it at the oldest.
- R3 **Rows.** Program icon, the tab's title (the conversation's for an agent),
  the space, the project folder, and a machine tag in its colour for a remote tab;
  the other windows' tabs tagged with their window ("Work window"), all in one
  list by when they were last shown.
- R4 **Other windows.** Their recorded tabs come from their app homes' shared
  state (read only); choosing one shows it in that window and raises it, as the
  inbox does. Only windows that are open count.
- R5 **Every system.** The key is Ctrl+Tab on macOS too (as in Vivaldi). Windows
  and macOS have one window each, so R4 adds nothing there.

## Acceptance Criteria

- [x] R1: unit tests for the order (record, move to front, drop gone tabs, seed):
  \`tests/tab-order.test.js\`, plus each row's details (\`tabEntry\`) and the merged
  list (\`switcherList\`). Added on the way: a window re-stamps its shown tab when it
  gets the focus, so across windows the order follows what was used.
- [x] R2: in the window: hold Ctrl, Tab twice, release: the third most recent tab
  is shown; a tap flips between two tabs; Esc cancels. (Operator, 2026-11-26, on all
  three systems. On macOS a click with Ctrl held is a right-click: rows take that
  too.)
- [x] R3: rows show the title, space, project and machine; a remote tab's tag in
  its machine's colour (operator).
- [x] R4: on njv-cachyos, the default window's switcher lists the work window's
  tabs, and choosing one raises the work window on it (operator). Raising needed
  KWin: under Wayland a second launch of the session didn't take the focus; a KWin
  script (loaded over D-Bus) activates the window by its title. The other windows'
  orders are read every 2 s, so a quick tap has them. A chat landed on gets the
  cursor in its message box (ushi-naruse: when its pane is focused in the active
  window), in both directions between the windows.
- [x] R5: works on macOS, Linux and Windows (operator); keys added to each
  machine's keys.json (njv-cachyos's two homes too) and its dotfiles snapshot
  (dotfiles 553843f).
- [x] `herdr-app check` passes on every machine; tests pass: macOS 298, Linux 299,
  Windows 294 of 312 (18 skipped), no failures.

## Test approach

Unit (node --test, plain data): the order (lib/tab-order.js). The keys, the popup
and the switch in the real window on each machine; the other window on njv-cachyos.
