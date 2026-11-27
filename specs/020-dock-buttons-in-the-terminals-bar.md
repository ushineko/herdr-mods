# 020 — dock buttons in the terminals bar

**Issue**: none (operator, 2026-11-27: "i think we need a UI way to hide and
show the docks")

## Status: COMPLETE

## Context

The window has two docks, `dock-right` and `dock-bottom` (spec 004), each
hidden and shown by `layout.toggle`. Today that reaches the pointer only
halfway:

- **Hide**: the × at the end of each dock's strip (dock-tabs), "Hide the
  dock" in a dock terminal's right-click menu (term-menu), Ctrl+Shift+Y and
  Alt+Shift+Y, and the palette's "Dock: toggle right / bottom".
- **Show**: the keys and the palette only. Once a dock is hidden nothing on
  screen says it exists, and a person who closed the bottom Jira dock
  (jira-viewer spec 026, dock-tabs spec 019) has to know the key to get it
  back.

The terminals bar (terminals-bar-proc) is the window's always-visible chrome:
tabs on the left, the palette button (⌘) and the window controls on the
right. That right end is where editors keep their layout toggles, and it is
visible whatever the docks do.

## Decisions (operator approved, 2026-11-27)

- D1 **Two buttons at the terminals bar's right end**, between the tabs and
  the palette button: the right dock (`panel-right` icon) and the bottom dock
  (`panel-bottom` icon), in that order. Each clicks to `layout.toggle` its
  dock. Nothing else moves: ⌘ and the window controls stay where they are.
- D2 **A lit button is a shown dock.** Shown: the text colour and a chip
  background, as a pressed toggle; hidden: dim, as the palette button rests.
  Both docks may be shown at once and both buttons are then lit.
- D3 **The tooltip names the action and the key**: "Hide the right dock
  (Ctrl+Shift+Y)" / "Show the right dock (Ctrl+Shift+Y)", the key as the
  platform writes it (term-menu's `keyFor`, moved to a lib so both mods read
  one copy) and left off when the action has no binding.
- D4 **Not in the spaces bar.** The top row is the spaces'; the docks are the
  space's terminals layout, so their toggles sit on the terminals bar with
  the rest of that layout's chrome. Not in the dock strips either: a hidden
  dock has no strip.
- D5 **No right-click menu on the buttons** for now. The dock's own strip and
  term-menu carry the dock's menus; a button that only toggles stays one
  click.

## Requirements

- R1 `lib/key-names.js`, pure: `keyFor(bindings, action, platform)` gives the
  key bound to an action as the platform writes it ("⌘⇧Y" on macOS,
  "Ctrl+Shift+Y" elsewhere), or null; `dockTooltip(dock, shown, key)` gives
  the button's tooltip. term-menu's `keyFor` becomes a call to it.
- R2 terminals-bar-proc draws the two buttons (D1), lit per `layout()`
  (D2, `find(layout(), dock)` not hidden), tooltip per D3, click runs
  `layout.toggle { id }`. The icons are svgs in the mod's folder
  (`panel-right.svg`, `panel-bottom.svg`, copies of nested-tabs' and
  lucide's), as every icon the bar draws is.
- R3 `mod.json` lists the lib; `herdr-app check` passes for both mods.
- R4 Nothing changes in dock-tabs or term-menu's behaviour: the strip's ×
  and the menu's "Hide the dock" stay.

## Acceptance Criteria

- [x] AC1 Unit (`tests/key-names.test.js`): `keyFor` finds a binding given
      whole (`layout.toggle:dock-right`) or as action + id argument, writes
      macOS glyphs and the other platforms' names, and gives null for an
      unbound action; `dockTooltip` says Hide for a shown dock, Show for a
      hidden one, with the key in brackets only when there is one.
- [x] AC2 `herdr-app check` passes for terminals-bar-proc and term-menu;
      `./run-tests.sh` passes.
- [x] AC3 Real window (njv-cachyos, the work home): both buttons sit between
      the tabs and ⌘; with the right dock shown and the bottom hidden, the
      right button is lit and the bottom dim (shot). Clicking the bottom
      button shows the bottom dock with its subtabs as they were and lights
      the button; clicking it again hides it (shots). `layout.toggle` by
      command and by key moves the buttons the same way.
      Done by command 2026-11-27 (the three states read back from shots: right
      lit and bottom dim; both lit with the bottom dock open on its subtabs;
      bottom dim again). The operator, 2026-11-27: "the dock buttons work".
- [x] AC4 Real window: the tooltips read "Hide the right dock (Ctrl+Shift+Y)"
      on the lit button and "Show the bottom dock (Alt+Shift+Y)" on the dim
      one (operator, 2026-11-27: "tooltips are right").

## Risks & Assumptions

- The bar re-renders when the layout tree changes (dock-tabs' strip reads
  `layout()` on each render and follows toggles, so the bar will too). If it
  does not, a toggle by key would leave a button stale until the next
  render; AC3's "by command and by key" is the check.
- Rollback: revert the commit and reinstall the two mods.

## E2E Test Plan

Run 2026-11-27 (by command): `./run-tests.sh` 321 passed; `herdr-app check`
passed for both mods; `layout.toggle --id dock-bottom` twice, the bar shot
after each, the buttons as AC3 says. Pointer, key and tooltips: operator.

On njv-cachyos's work window, after `./install.sh --no-agent
terminals-bar-proc term-menu` from the worktree: shots of the bar in the
three states of AC3, the toggles sent with `herdr-app do layout.toggle --id
<dock>` and read back from the shots; the key form and the tooltips are the
operator's (AC3's key half, AC4), confirmed 2026-11-27.

### Prod visibility

Not applicable: a personal desktop mod.
