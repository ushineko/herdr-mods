# 004 — the dock shows nav and git

**Issue**: #4

## Status: INCOMPLETE

## Executive Summary

The right and bottom docks show `nav` (002) and `git` (003) as their two tabs,
on both machines and in both njv-cachyos windows. yazi and lazygit leave the
dock entirely: their terminals, restart loops, per-machine copies and
`dock-follow`'s driving code are removed. `nested-tabs`' per-tab panel and
`term-menu` follow suit.

## Context

Each dock is a `dock-tabs` strip over a layout `stack` of terminal blocks:
`dock-yazi[-mbp]` and `dock-lazygit[-mbp]` here, plus one pair per remote
machine (`njv-cachyos-default/dock-yazi-mbp`, …), because yazi and lazygit must
run where the files are. `dock-follow` moves them (`ya emit-to`, lazygit's
Recent repositories menu, restarts through `data/dock/*.target`). Native panels
read any machine through herdr, so one block each is enough and following is
theirs.

## Requirements

- R1 **Layouts**: in `terminals-dock.json` (Mac; njv-cachyos default and work),
  each dock stack holds exactly two blocks, `{ mod: "nav" }` and
  `{ mod: "git" }`, ids `<dock>-nav` / `<dock>-git`. `nav` is active.
- R2 **dock-tabs**: its default subtabs are nav and git (icons: folder,
  git-branch), not renameable or closable. The `+` menu keeps "New shell" (a
  terminal subtab in the dock, as today) and drops yazi/lazygit. The code that
  creates, names and restarts `dock-yazi`/`dock-lazygit` terminals (local and
  per machine) is removed.
- R3 **dock-follow**: keeps starting the `usage` strip and setting the window
  title, and gains the agent inbox reader (005 R2); everything that drives yazi or lazygit (`ya emit-to`, the lazygit key
  sequences, `data/dock/*.target`, the per-machine terminal bookkeeping) is
  removed. It keeps the name `dock-follow`, so the layouts' block id does not
  change, with a header comment saying what it now does.
- R4 **nested-tabs**: the per-tab yazi/lazygit panel (`panel.js`, palette) opens
  `nav`/`git` as a split pane instead.
- R5 **term-menu**: "Restart yazi/lazygit" items go; the dock items it keeps
  apply to a "New shell" dock tab.
- R6 **Terminals retired**: after the layouts no longer reference them, the
  `dock-yazi*`/`dock-lazygit*` terminals are ended on both machines' cores
  (`hc kill`), in that order — ending a terminal still shown in a block deletes
  the block (known gotcha).
- R7 **Docs and snapshots**: `~/git/sysadmin/docs/herdr-desktop-app.md` (dock,
  mods table, keys, gotchas, macOS section) and the `yazi-here` skill
  replaced by spec 005's skills (005 R14 retires it);
  dotfiles layout snapshots refreshed with each host's `backup.sh`.

## Acceptance Criteria

- [ ] Both docks on the Mac show nav and git, following the focused terminal
      in a local and a remote space.
- [ ] Both njv-cachyos windows (default, work) show the same after install +
      work-window restart.
- [ ] `+` → New shell still adds a terminal tab to a dock.
- [ ] No `dock-yazi*`/`dock-lazygit*` terminals in `hc ls` on either machine.
- [ ] `grep -rn "dock-yazi\|dock-lazygit\|ya emit" mods/` is empty.
- [ ] `herdr-app check` passes for every changed mod; `herdr-app status` shows
      no errors on either machine.
- [ ] Docs, skill and dotfiles snapshots updated and committed.

## Rollback

Revert this spec's herdr-mods commit(s) and run `install.sh`; restore the
layouts from dotfiles (`restore.sh`, Herdr quit). dock-follow's restart loops
recreate the yazi/lazygit terminals on first show.

## Threat model delta

None: removes code that typed into terminals.

## Risks & Assumptions

- `dock-tabs` is the largest custom mod and shared by both machines; the
  change is done on the Mac, then installed on njv-cachyos and checked there
  before the terminals are retired.
- Anything else that types into `dock-yazi` (the `yazi-here` skill, the
  herdr-panel-toggle script) breaks; R7 finds and updates them.
