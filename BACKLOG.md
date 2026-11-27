# Backlog

Open items to come back to (updated 2026-11-26, after specs 013 to 016). Each new feature gets
a GitHub issue and a spec (`specs/NNN-…md`) when work starts.

## Features, parked by the operator

- **Agent requests acknowledged.** `herdr-open` / `herdr-nav` only drop a request in
  `~/.cache/herdr-mods/inbox/<session>/`; with no herdr-app window running these mods,
  nothing claims it and the agent believes it worked. Idea: wait ~2 s for a claim and
  otherwise say "no Herdr window with herdr-mods picked this up".
- **ushi-naruse without python3 on macOS and Linux** (spec 008; operator kept python3
  required, 2026-11-25). Since spec 014, Windows uses PowerShell instead, and image
  sizes are read in JS everywhere; on macOS and Linux python3 still brokers stdio for
  `claude -p` stream-json and `codex app-server` JSON-RPC (side chat, info cards,
  resume list). Options: a soft dependency (those features say "needs python3"), or
  the PowerShell bridge's approach (the JSON side in `lib/chat-sdk.js`) with sh.
- **Codex chats on Windows** (spec 014): the Codex bridge (`codex app-server`) has no
  PowerShell form, so Windows offers Claude Code's chat only. Codex isn't installed on
  win11-kvm.
- **`herdr-open` / `herdr-nav` on Windows** (spec 013): bash scripts, so not installed
  there (`install.sh --no-agent`); a PowerShell form if Claude sessions on Windows
  should point the panels.
- **Quick switcher: past conversations** (spec 016 chose open things only): Claude
  Code sessions that aren't open, from each project's session list, opened as a new
  chat.
- **Fake fullscreen** (UX question raised, deferred).
- **Web sites in the viewer** (operator deferred, 2026-11-26; spec 017 shows HTML
  files only, printed once to PDF, scripts out). Options weighed: (1) a URL snapshot:
  the headless browser, scripts on, run on the machine the site is reachable from (a
  remote dev server's localhost), screenshot or PDF copied here (`fetchHere`),
  Refresh; small. (2) A live pane: a helper keeps a headless Chromium on the Chrome
  DevTools Protocol, writes screenshots and takes clicks and keys through files (a
  mod can't hold a socket); a few frames a second. (3) That pane attached to the
  Chromium an agent drives (`chrome-devtools-mcp`), to watch and take over.
- **TODO: hayami-js details and drills** (operator, 2026-11-26: to be done later).
  Specs 010 and 011 draw the sections only. The service lists each section's
  details (`details` in a Section: the cooler's cpu, gpu, memory and io; the
  bandwidth's processes, peers and vpn; the usage's accounts and development
  overview) and their drills below them (`children`, e.g. `cpu/firefox/4411`), at
  `/v1/sections/{key}/details/{id}` (hayami `docs/api.md`, "Details and drills").
  Wanted: open them from the block. `checkPath` will need the details path added to
  its allow-list, with each ID step percent-encoded.
- **TODO: hayami-js sparklines** (operator, 2026-11-26: to be done later). The
  readings carry recent values oldest first: an interface's `trail.rx` and
  `trail.tx`, a probe's `trail` (its load). Draw them beside the figures, as
  hayami's panel does (`internal/view/sparkline.go` there), at a fixed width so
  nothing moves (glance rule).
- **TODO: hayami-js on the event stream** (operator, 2026-11-26: to be done later).
  `/v1/events?sections=a,b` sends each reading as it is made (Server-Sent Events),
  where the block now runs a process every 5 s to poll. A mod's `exec` returns only
  when its program ends, so a stream needs a long-running reader: for example a
  herdr-core background terminal running curl into a file the mod reads, one per
  machine, ended when the block stops following that machine. The stream is a new
  path for `checkPath`'s allow-list.

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
- **The gallery is out of date** (2026-11-26): the shots predate the top bar's zones,
  machine colours and inbox, the compact tab bar, and the chat's header in the pane
  row. Run `tools/gallery.sh` again; new candidates: the inbox's dropdown, the Ctrl+Tab
  and Ctrl+Space dialogs (each opened by a command, so the script can take them).
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

- win11-kvm's checkout (`~\git\herdr-mods`) was set up from a bundle and kept current
  by copying files over it (`git clone` hangs from a non-interactive SSH session
  there, spec 013): bring it in line from a Windows terminal with `git fetch` and
  `git reset --hard origin/main`.
- win11-kvm crashed once (bugcheck 0x50, 2026-11-26 14:59); the minidump in
  `C:\Windows\Minidump` would name the driver (the SR-IOV Intel graphics driver is
  the first suspect).

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
