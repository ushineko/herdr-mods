# 018 — a mod subtab in the dock

**Issue**: none (jira-viewer spec 026 D8 asked for it)

## Status: COMPLETE

## Context

The dock's subtabs are terminals (shells, agents) and chats over terminals
(spec 008). dock-tabs rebuilds both docks' stacks from a list of terminal names
whenever subtabs change, so a block that is neither a terminal nor a chat is
dropped on the next rebuild, and `needsMigration` reads one as a dock from
before spec 004.

jira-viewer (its spec 026, `herdr/jira-viewer` in that repository) is a mod
that shows the ticket table and wants a dock tab of its own, beside the fixed
nav + git + hayami one, so the whole dock area is the table's in either
direction. The mod is owned by jira-viewer; what herdr-mods needs to know is
how to hold a mod in a subtab and how to offer one.

## Decisions (operator, 2026-11-26, in jira-viewer spec 026)

- A dock subtab may hold a **mod's block**. Its name in the stack is
  `mod:<mod>`, kept like a terminal name; its block is
  `{ mod, props: { dock, stack, id, dockName } }`, so the mod can tell when it
  is the shown subtab.
- It is offered under **+** for every installed mod whose `mod.json` has a
  `"dock": { "title", "icon" }` entry; the icon is an svg in the mod's folder.
- It shows as its **icon alone**, the title its tooltip, as the fixed subtab
  does (026 D13). It belongs to no machine, so every machine's strip shows it.

## Requirements

- R1 `lib/dock-mods.js`, pure: the name's form (`modTabName`, `isModTab`,
  `modOfTab`), the dock entries from installed mods' manifests (`dockMods`,
  `modNamesFrom`, `LIST_MODS`), the icon's path (`dockModIcon`).
- R2 dock-tabs keeps a mod subtab through `setTabs`, does not migrate it
  away, draws it as its icon, lists it for every machine, closes and moves it
  as any subtab, and offers "`<title>` tab" under **+** for each installed
  dock mod. `herdr-app do dock-tabs.mod-<mod>` adds or shows one without the
  pointer.
- R3 A mod subtab has no terminal to keep alive: nothing restarts it, nothing
  renames it.

## Acceptance Criteria

- [x] Unit: the name round-trips; `dockMods` keeps only manifests with a
      titled dock entry, in name order, with a safe icon name; `modNamesFrom`
      takes only names under the mods folder.
- [x] `herdr-app check` passes for dock-tabs.
- [x] Real window (njv-cachyos, the work home): `dock-tabs.mod-jira-viewer`
      adds the subtab as an icon in both docks; it survives a reinstall of
      the mod; nav + git stays first; the bottom dock and the right dock
      each show the mod's block (shots in jira-viewer `assets/`).

## Notes (2026-11-27)

- The + menu's entries come from the mod folders listed with `sh` through
  `exec`, since a mod has no folder listing of its own; Windows has no sh
  and no Herdr app yet.
- Both docks shown at once (the terminals-dock layout does this) each run
  `dock-tabs.mod-<mod>` and race on `setTabs`; the subtab lands in both, and
  `layout.select` picks it in the one that lost.

## Risks & Assumptions

- A mod that is uninstalled leaves a subtab whose block has no mod; dock-tabs
  shows it until it is closed. Rollback: revert; a stack holding a mod subtab
  is migrated away by the 017 dock-tabs on its next showing.

## E2E Test Plan

Done 2026-11-27 on njv-cachyos's work window: the jira-viewer subtab added
by command, shown in both docks, shots read back (jira-viewer spec 026 E2E).

### Prod visibility

Not applicable: a personal desktop mod.
