# 015 — Ctrl+Tab switcher

**Issue**: #50

## Status: INCOMPLETE

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

- [ ] R1: unit tests for the order (record, move to front, drop gone tabs, seed).
- [ ] R2: in the window: hold Ctrl, Tab twice, release: the third most recent tab
  is shown; a tap flips between two tabs; Esc cancels.
- [ ] R3: rows show the title, space, project and machine; a remote tab's tag in
  its machine's colour.
- [ ] R4: on njv-cachyos, the default window's switcher lists the work window's
  tabs, and choosing one raises the work window on it.
- [ ] R5: works on macOS, Linux and Windows; keys added to each machine's
  keys.json and its dotfiles snapshot.
- [ ] `herdr-app check` passes; tests pass on macOS, Linux and Windows.

## Test approach

Unit (node --test, plain data): the order (lib/tab-order.js). The keys, the popup
and the switch in the real window on each machine; the other window on njv-cachyos.
