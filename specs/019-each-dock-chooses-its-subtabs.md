# 019 — each dock chooses its subtabs

**Issue**: none (operator, 2026-11-27)

## Status: INCOMPLETE (implemented 2026-11-27; AC4's second half and AC5 wait on the operator)

## Context

The two docks, `dock-bottom` and `dock-right`, show the same subtabs: one
list of names, rebuilt into both stacks by `setTabs`, the fixed nav + git
(+ hayami) subtab first in each. That was the right shape when one dock
was open at a time (opening one hid the other). The terminals-dock layout
shows both at once, and with jira-viewer's table as a subtab (spec 018) the
operator wants the two to differ: the table across the bottom, nav + git
down the right, and no copy of either where it is not wanted.

## Decisions (proposed)

- **One set of subtabs, and per dock a choice of which to show.** The set
  stays what it is (the terminals, chats and mod subtabs in the stacks),
  so nothing about creating, closing, renaming or moving a subtab changes.
  Each dock keeps a list of names it **hides**, including the fixed
  `panels` subtab; a name not hidden is shown, so every existing dock shows
  what it shows today.
- **A subtab is shown in at least one dock.** "Hide here" is offered only
  while the other dock shows it; a subtab in one dock alone offers "Move to
  the other dock" instead. A dock with everything hidden shows the fixed
  subtab anyway, so a dock is never empty.
- **Chosen from the subtab's own menu**, where its other actions are:
  right-click a chip for "Hide in this dock" / "Move to the other dock";
  right-click the strip (or **+**) for "Show here: `<name>`" per hidden
  subtab. No separate settings page.
- **Kept per app home**, in `shared("dock-tabs.hidden")`, as
  `{ "dock-bottom": [names], "dock-right": [names] }`, so a layout rebuilt
  from the stacks comes back with the same choice. Nothing else is written.
- **The shown subtab is remembered per dock.** `dock.active` keyed by dock
  and machine, since the two docks no longer hold the same list.

## Requirements

- R1 `lib/dock-tabs-hidden.js`, pure: `hiddenIn(state, dock)`,
  `isHidden(state, dock, name)`, `hide(state, dock, name, shownElsewhere)`
  (refused when the name would be shown nowhere), `show(state, dock,
  name)`, `moveTo(state, from, to, name)`, `visibleNames(names, state,
  dock)` with the fixed subtab's rule.
- R2 `setTabs` builds each dock's stack from the names minus that dock's
  hidden set; the fixed `panels` node is left out of a dock that hides it
  and put first otherwise. `ownNames` reads the union of both stacks and
  the hidden sets, so a name hidden in one dock is still a name.
- R3 `needsMigration` accepts a dock whose first child is not the fixed
  subtab when that dock hides it.
- R4 The chip menu: "Hide in this dock" when the other dock shows the
  subtab, "Move to the other dock" otherwise; both for the fixed subtab
  too. The strip's and **+**'s menu: one "Show here: `<label>`" per subtab
  hidden in this dock, with the chip's icon.
- R5 `cycle`, `moveTab`, `closeTab`, `addTab` and the keys work on the
  dock's own visible list; closing a subtab clears it from both hidden
  sets; a new subtab is shown in both docks (today's behaviour) unless the
  person hides it.
- R6 `dock.active` is kept per dock and machine; `ensureDock` reads it so.
- R7 `herdr-app do dock-tabs.<hide|show|move>-<dock>-<name>` for driving
  (`dock-tabs.hide-dock-bottom-panels`, `dock-tabs.move-dock-right-mod:jira-viewer`):
  the named dock's strip acts, since both strips receive every command. No
  palette entries: a palette command cannot say which dock, and both
  docks' strips would act.
- R8 Opening a dock hides the other only while the two show the same
  subtabs; once a dock hides some, the two are different panels and both
  stay open.

## Acceptance Criteria

- [x] AC1 Unit: hide refused when the name would be shown nowhere; show,
      move and visibleNames; the fixed subtab's rule (shown when everything
      is hidden).
- [x] AC2 `herdr-app check` passes; `./run-tests.sh` passes (321 pass, 0 fail).
- [x] AC3 Real window (njv-cachyos, the work home): nav + git hidden in the
      bottom dock and the Jira tab in the right dock, by command; each dock
      shows its own, both open at once (R8); the choice survived three
      reinstalls of dock-tabs (the stacks are rebuilt from the shared
      state); a shot read back. App restart seen 2026-11-27: the window
      closed and relaunched with the choice kept (right dock: nav + git and
      Jira; bottom dock: Jira alone, hidden), a shot read back.
- [ ] AC4 Real window: `move-dock-right-panels` moved nav + git to the
      bottom dock and `show-dock-right-panels` brought it back (done by
      command); hiding Jira in the bottom dock while the right dock hid it
      was refused (done). Closing a hidden subtab's terminal and a new
      shell from **+** appearing in both: the operator drives these.
- [ ] AC5 Real window: the chip menu's "Hide in this dock" / "Move to the
      other dock" and the strip's "Show here: …" entries (the operator
      drives these; the commands behind them are AC3 and AC4's).

## Risks & Assumptions

- **Both docks shown at once** is a layout the dock-tabs header comment
  says does not happen ("opening one hides the other"), and it does in the
  terminals-dock layout. This spec takes that as the normal case; the
  hide-the-other rule in `onShown` is left as is unless it fights the
  choice, which AC3 will show.
- **Rollback**: revert; `dock-tabs.hidden` left behind is ignored by the
  018 dock-tabs, which rebuilds both docks with everything.

## E2E Test Plan

On njv-cachyos's work window, after `./install.sh dock-tabs`: the AC3 to
AC5 steps, driven by the operator and by `herdr-app do` where a command
exists, shots read back.

### Prod visibility

Not applicable: a personal desktop mod.

## Answers (operator, 2026-11-27: "approved, good to proceed")

1. A new subtab appears in both docks, as today.
2. nav + git can be hidden and moved like any subtab.
