# Backlog

Open items to come back to (saved 2026-11-25). Each new feature gets a GitHub issue
and a spec (`specs/NNN-…md`) when work starts.

## Features, parked by the operator

- **Agent requests acknowledged.** `herdr-open` / `herdr-nav` only drop a request in
  `~/.cache/herdr-mods/inbox/<session>/`; with no herdr-app window running these mods,
  nothing claims it and the agent believes it worked. Idea: wait ~2 s for a claim and
  otherwise say "no Herdr window with herdr-mods picked this up".
- **Spec 006: evaluate ChmaraX/herdr-nvim** (source review, build at a recorded commit,
  isolated trial, recommendation). All criteria open.
- **ushi-naruse without python3** (spec 008; operator kept python3 required, 2026-11-25).
  python3 only brokers stdio for `claude -p` stream-json and `codex app-server` JSON-RPC
  (side chat, info cards, resume list) and reads image sizes. Options: a soft dependency
  (entries always shown, those features say "needs python3", image size in JS); node
  helpers; Go helpers, worth it mainly for Windows (no python3 there; one .exe per
  machine, built or shipped).
- **Fake fullscreen** (UX question raised, deferred).
- **hayami-js**: the herdr client for hayami spec 113 (JSON socket service); start
  from `mods/ui-lab`'s patterns.

## Unverified acceptance criteria (test in a real window, then tick in the spec)

- 003: with an agent `working` in the shown worktree, write keys are refused ("hold"
  test of the per-worktree lock).
- 005: `herdr-open --external README.md` from the CLI opens Zettlr; on njv-cachyos a
  request from a work-window terminal goes to the work window, not the default one; a
  request written while no window runs is not replayed when one starts.
- 002: a file created from a terminal appears in nav within 2 s; nav driven by shared
  state (`nav.request`).
- 001: opening the same file twice selects the first viewer tab; the cache never holds
  more than 200 files.
- 007: scratch repository scenario (kept reasons: unpushed, dirty, nvim in it; a shell
  moved out); Really remove on a dirty and on a locked worktree in a real window.

Confirmed in use this session but not yet ticked: 002 remote space follows;
003 remote repository (platform-backend) shows changes; 004 both docks on the Mac and
both njv-cachyos windows, `+` → New shell; 005 yazi-here retired, skills on both
machines; 007 right-click plans one worktree, clean-up of all of platform-backend
including Fix ownership and Really remove.

## Housekeeping

- njv-cachyos `~/git/dotfiles`: uncommitted `hosts/njv-cachyos/.config/kglobalshortcutsrc`
  (KDE reordered its inverse-action pairs; no shortcut changed). Commit or discard at the
  next dotfiles sync.
- njv-cachyos `/home/nverenin/git/platform-backend.worktrees/` still holds folders git no
  longer knows as worktrees (only the main worktree is registered now):
  - four left half-removed by the first clean-up, before the ownership check existed
    (only root-owned `__pycache__` remain; branches kept): `AP-24889-release-2026.23`,
    `feature-AP-22692-risk-first-edr-sweep`, `feature-AP-22700-discovery-untick-reconciliation`,
    `feature-AP-22700-schedule-beat-cleanup`. To finish: `sudo rm -rf --` them (operator).
  - `feature/`: not created by the clean-up; left alone.
  - Possible feature: the clean-up could list such orphan folders too.
