# 024 — a terminal pane's own text size, from its header

**Issue**: #57

## Status: COMPLETE

## Context

Terminal text has one size for the whole app. The app fork adds a size per
pane, per window (`ushineko/herdr-app` spec `ushineko/specs/002-pane-font-size.md`):
a `pane.font {pane, step | reset}` command and `panes()`' `font: {size,
offset}`. Chats already have A− / size / A+ in their header row (nested-tabs'
`chatTools`, sizes from ushi-naruse). This spec gives terminal panes the same.

Decisions (operator, 2026-11-27): per pane and per window; an offset from the
app-wide size; header buttons only (no keys).

## Requirements

- **R1.** A terminal pane's header (nested-tabs: the single pane's row and a
  stack's row, label-based or native) has A−, the size, A+, drawn as the
  chat's are, placed with the pane's other buttons.
- **R2.** A− / A+ run `pane.font {pane, step: ∓1}` on that pane (in a stack,
  the shown member's pane). Clicking the size resets it (`reset: true`).
- **R3.** The size is drawn dim while the pane follows the app-wide size
  (offset 0) and bright when it has its own, with a tooltip saying which
  ("Text 17 px (app 15): click to match it" / "Text matches the app (15 px)").
- **R4.** On the released app (`panes()` entries without `font`) and for a
  pane without a terminal the controls aren't drawn; nothing else changes
  (CLAUDE.md: mods keep working on the released app).
- **R5.** Chat panes keep their own chat-size controls unchanged.
- **R6.** Cross-platform: nothing platform-specific; checked on macOS and
  Linux, Windows untested unless tried on win11-kvm.

## Acceptance criteria

- [x] AC1: A+ twice on a terminal pane makes it 2 px larger; the number shows
  the new size, bright; the pane beside it is unchanged (R1, R2, R3).
- [x] AC2: clicking the number returns it to the app's size, dim (R2, R3).
- [x] AC3: in a nested-tab stack the buttons act on the shown member, and each
  member keeps its own size when switching (R2).
- [x] AC4: a released-app window (the fork's sandbox with
  `HERDR_APP_BIN=<released binary>`) draws no size controls and no errors (R4).
- [x] AC5: a chat pane's header is unchanged (R5).
- [x] AC6: `herdr-app check` passes; `npm test` / `./run-tests.sh` pass; both
  machines' windows looked at with `herdr-app shot`.

## Progress

- 2026-11-27, the fork's sandbox on njv-cachyos (fork 98f729e, the operator's
  `terminals-dock` layout, these mods installed into it), a lone pane beside a
  native stack of two, app size 15:
  - AC1: A+ twice on the stack: its shown member 17, bright, larger text; the
    lone pane unchanged at 15.
  - AC3: member 1 shown: 15 (its own); back to member 2: 17.
  - AC2: A− on the lone pane: 14, smaller text; clicking 14: back to 15, its
    entry gone from view.json. Tooltips as R3.
  - AC4: the same home and window on the released 0.1.18 (`HERDR_APP_BIN`):
    no size controls, `errors: []`.
  - The sandbox's input helper looks for a window titled exactly "Herdr"; with
    this layout the window is "Herdr (default)", so clicks went through a copy
    matching the prefix.
- 2026-11-27, 0.1.18-ushineko.2 installed on the Mac, njv-cachyos (both
  windows) and win11-kvm:
  - AC5: the Mac's chat header has the chat's own A−/size/A+ once and no
    second set; the njv-cachyos window draws it the same.
  - AC6: `herdr-app check` passed on both machines; `npm test` 351 and
    `./run-tests.sh` 352 pass; both windows looked at with `herdr-app shot`.
  - Fork spec 002 AC6 on the way: a remote pane sized from the Mac window was
    saved only in that window's view.json, not the njv-cachyos window's.

## E2E

Look at: a single terminal pane's header, a stack's header, a chat's header,
before and after A+/A−/reset, on the Mac and the njv-cachyos default window.
