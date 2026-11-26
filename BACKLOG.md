# Backlog

Open items to come back to (updated 2026-11-25, after specs 008 and 006). Each new feature gets
a GitHub issue and a spec (`specs/NNN-…md`) when work starts.

## Features, parked by the operator

- **Agent requests acknowledged.** `herdr-open` / `herdr-nav` only drop a request in
  `~/.cache/herdr-mods/inbox/<session>/`; with no herdr-app window running these mods,
  nothing claims it and the agent believes it worked. Idea: wait ~2 s for a claim and
  otherwise say "no Herdr window with herdr-mods picked this up".
- **ushi-naruse without python3** (spec 008; operator kept python3 required, 2026-11-25).
  python3 only brokers stdio for `claude -p` stream-json and `codex app-server` JSON-RPC
  (side chat, info cards, resume list) and reads image sizes. Options: a soft dependency
  (entries always shown, those features say "needs python3", image size in JS); node
  helpers; Go helpers, worth it mainly for Windows (no python3 there; one .exe per
  machine, built or shipped).
- **Fake fullscreen** (UX question raised, deferred).
- **hayami-js**: the herdr client for hayami spec 113 (JSON socket service); start
  from `mods/ui-lab`'s patterns.

## Ideas from spec 006 (not yet asked for)

- **Two herdr-nvim features, borrowed rather than adopted** (spec 006 decided skip):
  code comments in our own nvim sent to the agent with `file:line` (its
  `comments.lua`/`prompt.lua`, MIT), and a "touched by the agent" list in nav or git
  read from the agent's session log.

## Ideas from spec 008 (not yet asked for)

- **The app's own close keys.** The pane-close and tab-close shortcuts go straight to the
  app: they can still end a chat's shown terminal, and closing the shown tab can still
  flash a hidden terminal (the × buttons are covered, spec 008 R12). Idea: bind those
  keys in `keys.json` to `nested-tabs.close-pane` (and a tab-close command in the tab
  bar), so keyboard closes take the same safe path.
- **Chat tabs named after the project.** New … chat names its tab "Claude Code chat";
  the convention elsewhere is the folder's name. Asked once, not answered.
- **Chats on the phone.** The Herdr mobile app talks to herdr-core directly, so none of
  these mods run there. To check: how a chat's hidden terminal tab (settled only in
  desktop windows) and a pane-less chat agent show on the phone.
- **Gallery shots that need a click**: the + right-click menu and a git commit
  drill-down; `tools/gallery.sh` can't open them (no command takes their props).
- **A shallower terminals-dock layout.** It is 16 levels deep since the "work" column
  (#10), past the limit of a mod's `run()` arguments; dock-tabs falls back to the
  herdr-app CLI (#15). Flattening the layout would remove the need.

## Unverified acceptance criteria (test in a real window, then tick in the spec)

- 003: with an agent `working` in the shown worktree, write keys are refused ("hold"
  test of the per-worktree lock).
- 003 R8a-1 (#17): a commit drill-down closes when the panel follows another folder or
  worktree (needs a click to open one).
- #14: a long-running git or nav panel keeps refreshing after the app reclaims its
  folder watch (fixed by renewing the watch plus a timer; seen fresh, not after a
  reclaim).
- 005: `herdr-open --external README.md` from the CLI opens Zettlr; on njv-cachyos a
  request from a work-window terminal goes to the work window, not the default one; a
  request written while no window runs is not replayed when one starts.
- 002: a file created from a terminal appears in nav within 2 s; nav driven by shared
  state (`nav.request`).
- 001: opening the same file twice selects the first viewer tab; the cache never holds
  more than 200 files.
- 007: scratch repository scenario (kept reasons: unpushed, dirty, nvim in it; a shell
  moved out); Really remove on a dirty and on a locked worktree in a real window.
- `tools/gallery.sh` on Linux (run only on the Mac so far).

Confirmed in use but not yet ticked: 002 remote space follows; 003 remote repository
(platform-backend) shows changes; 003 R8b–R8d (Recent expand, authors, Load more:
operator, 2026-11-25); 004 both docks on the Mac and both njv-cachyos windows, `+` →
New shell; 005 yazi-here retired, skills on both machines; 007 right-click plans one
worktree, clean-up of all of platform-backend including Fix ownership and Really remove.

## Housekeeping

- njv-cachyos `/home/nverenin/git/platform-backend.worktrees/` still holds folders git no
  longer knows as worktrees (only the main worktree is registered now):
  - four left half-removed by the first clean-up, before the ownership check existed
    (only root-owned `__pycache__` remain; branches kept): `AP-24889-release-2026.23`,
    `feature-AP-22692-risk-first-edr-sweep`, `feature-AP-22700-discovery-untick-reconciliation`,
    `feature-AP-22700-schedule-beat-cleanup`. To finish: `sudo rm -rf --` them (operator).
  - `feature/`: not created by the clean-up; left alone.
  - Possible feature: the clean-up could list such orphan folders too.
- Mac: Claude Code's trusted-folder list keeps entries for the removed demo folders
  (`~/demo/acme-api`, `/tmp/herdr-demo/acme-api`); harmless, remove from `~/.claude.json`
  if wanted.
- Chats opened before 2026-11-25's labels (`ushi.chat`, `ushi.id`) lack them: reopen
  them (Back to terminal, then the cow) for follow, the agents list and other windows.
