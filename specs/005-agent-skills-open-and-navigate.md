# 005 — agent skills: open and navigate

**Issue**: #5

## Status: INCOMPLETE

## Executive Summary

Two commands on PATH, `herdr-open` and `herdr-nav`, and two Claude Code
skills that use them, let an agent show the person a file (in `viewer`, or in
a configured external app such as Zettlr) or point `nav` at a folder or file,
in the space the agent is running in, on whichever machine it runs. They
replace the `yazi-here` skill and script and the ad-hoc "open it in Zettlr"
requests. The same external-app configuration backs an "Open external" action
in `viewer` (001 R14) and `nav` (002 R12).

## Context

`yazi-here` finds "your" yazi panel by matching the shell's cwd against herdr
panes and drives it with `ya emit-to`; it guesses, and it only works while a
yazi terminal exists. Opening a file in Zettlr is asked for in conversation
and done by hand (`open -a Zettlr <file>` on the Mac, `zettlr <file>` on
njv-cachyos, pinned at 4.8.0 there).

Herdr's mod commands (`herdr-app do <mod>.<command>`) take no arguments, so a
CLI cannot pass a path to a mod directly. `tab.new {mod, props}` can open a
viewer tab, but not de-duplicate it (001 R2) or reach a window on another
machine, and nothing can move `nav`. Every terminal herdr starts carries
`HC_TERMINAL_ID` and `HC_TERMINAL_SOCKET` (whose path names the herdr-core
session); together they say exactly which terminal, and so which space, a
request came from.

## Requirements

### The request inbox

- R1 **Requests are files.** A CLI writes one JSON file per request into
  `~/.cache/herdr-mods/inbox/<session>/` on the machine it runs on, `<session>`
  taken from `HC_TERMINAL_SOCKET` (`…/herdr-core/<session>/…`; `default` when
  unset). It writes to a temporary name and renames, so a reader never sees a
  partial file. Fields: `v` (1), `id`, `at` (ISO time), `action`
  (`open` | `edit` | `external` | `diff` | `nav` | `reveal` | `worktree` | `follow`), `path` (absolute, resolved
  by the CLI), `line` (optional), `terminal` (`HC_TERMINAL_ID`, optional).
- R2 **One reader per window**, in `dock-follow` (always in the
  `terminals-dock` layout, on both machines and both njv-cachyos windows).
  It watches its own machine's inbox for its own session (`watchFolder`), and
  polls every 2 s, while the window is visible, the inbox of each connected
  machine for the sessions that window has added as machines
  (`njv-cachyos-default` → `default`, `njv-cachyos-work` → `work`), through
  `exec(..., { on })`.
- R2a **The window in use claims first** (found 2026-11-24: njv-cachyos runs its own
  windows, which watch their inbox and would otherwise always win). An active
  (focused) window claims at once; a window not in use claims only requests at
  least 2 s old (`GRACE`, by file time), and polls its own inbox every 2 s for
  them. So a request from an agent on njv-cachyos opens where the person works,
  and still opens somewhere when no window is in use.
- R3 **Claimed once.** A reader claims a request by renaming it into
  `…/claimed/` (atomic on one filesystem); a reader that loses the rename
  skips it. A claimed request is deleted after it is handled. Requests older
  than 60 s are deleted unhandled (a window that was closed must not replay
  them later).
- R4 **Where it lands.** The request's `terminal` (prefixed with the machine
  for a remote inbox: `njv-cachyos-default/t2k`) is looked up in
  `terminals()`/`panes()` to find its space and tab. `open`/`diff`/`external`
  act in that space; `nav`/`reveal` act on the `nav` copy in the dock of the
  window showing that space. With no `terminal`, or one not found, the shown
  space is used. A request whose terminal belongs to a space this window
  does not show is still handled (the viewer tab opens there; `focus: false`
  unless it is the shown space).
- R5 **Feedback.** Each handled request posts a short toast ("Opened
  README.md", "nav → ~/git/herdr-mods", "Opened in Zettlr"); a failed one says
  why. The CLI does not wait for it (fire and forget), but exits non-zero if it
  cannot write the request (no herdr session, unwritable inbox).

### The commands (`bin/`, installed to `~/.local/bin`)

- R6 `herdr-open [--external | --diff | --staged] <path>[:<line>]`
  - default: `open` — the file in a `viewer` tab (001), de-duplicated;
  - `--external`: the configured external app (R9) for that file;
  - `--diff` / `--staged`: the file's working-tree / staged diff in `viewer`.
  A folder given to `herdr-open` is a `nav` request instead.
- R6a `herdr-open --edit PATH[:LINE]` (operator, 2026-11-24, option 3 of the
  editor question): the person's editor — `$VISUAL`/`$EDITOR` from the login shell
  on the file's machine, else `nvim`, else `vi` — in a new terminal tab of the
  requester's space, in the file's folder, at `LINE` for editors that take `+N`
  (`lib/editor.js`, `lib/edit-open.js`). Wait flags (`--wait`, `-w`) are dropped.
- R7 `herdr-nav <dir>` points `nav` at the folder (following turns off, 002
  R2); `herdr-nav --reveal <file>` points it at the file's folder and selects
  the file; `herdr-nav --follow` turns following back on.
- R7a `herdr-nav --worktree <path>` (operator, 2026-11-24): the agent says which
  worktree it is working in. It (1) labels the caller's terminal
  `herdr-mods.worktree=<worktree root>` (`hc label "$HC_TERMINAL_ID" …`), which
  the git panel uses to place the agent and lock that worktree (003 R5a, R11a),
  and (2) sends a `worktree` request so `git` (and `nav`) show that worktree,
  following off. `herdr-nav --worktree -` removes the label (`key=`). The path
  may be any folder inside the worktree; the CLI resolves the root with
  `git rev-parse --show-toplevel` and refuses a folder that is not in one.
- R8 Both resolve relative paths against the caller's cwd, refuse a path that
  does not exist (exit 1, message on stderr), and print nothing on success
  unless `-v`. Bash, `set -euo pipefail`, shellcheck-clean, no dependencies
  beyond coreutils (`jq` not required: the JSON is built with `printf` and a
  string escaper tested in `tests/`).

### External apps

- R9 **Configuration**: `~/.config/herdr-mods/external.json` on each machine
  (not in this repo; dotfiles snapshots it). Rules are tried in order; the
  first whose `match` fits the file wins:
  ```json
  { "rules": [
      { "match": { "type": "markdown" }, "app": "Zettlr",
        "macos": ["open", "-a", "Zettlr", "{path}"],
        "linux": ["zettlr", "{path}"] },
      { "match": { "ext": ["pdf"] }, "app": "Preview",
        "macos": ["open", "{path}"], "linux": ["xdg-open", "{path}"] },
      { "match": { "any": true }, "app": "system default",
        "macos": ["open", "{path}"], "linux": ["xdg-open", "{path}"] } ] }
  ```
  `type` uses `lib/filetype.js` (001 R4); `ext` lists extensions; `{path}` is
  substituted as one argument (never a shell string). A missing file means the
  built-in default: Markdown → Zettlr, everything else → the system opener.
  The repo ships `config/external.example.json`.
- R10 **Runs where the file is**: an external open of a file on
  `njv-cachyos-default` runs there (`exec(argv, { on })`), so the app opens on
  that machine's display; the toast names the machine. The platform is the
  file's machine's (`window().platform` locally; `uname` once per remote
  machine, cached).
- R11 The `app` name is what the viewer's button and nav's menu say ("Open in
  Zettlr").

### Skills (`skills/`, installed to `~/.claude/skills/`)

- R12 **`herdr-open`** skill: when to show the person a file (after writing or
  finding one they should read; when they ask to "open", "show me", "open in
  Zettlr"), which flag to use, and that it is fire-and-forget. Off herdr
  (`HC_TERMINAL_ID` unset) it says so and does nothing.
- R13 **`herdr-nav`** skill: when to point nav at a folder or reveal a file
  (after locating something under discussion), `--follow` to hand control
  back, and **`--worktree` whenever the agent starts working in a worktree**
  (and `--worktree -` when it leaves), so the person's git panel shows it and
  locks it while the agent works.
- R14 **Retire yazi-here**: the `yazi-here` skill and script are removed from
  `~/.claude/skills`, `~/.local/bin` and dotfiles (`hosts/*/.claude/skills/yazi-here`,
  `hosts/*/.local/bin/yazi-here`) on njv-mbp-m1 and njv-cachyos once 004 has
  removed yazi from the dock; other hosts' copies are left (no herdr-app there).

### Install

- R15 `install.sh` gains `--bin DIR` (default `~/.local/bin`) and
  `--skills DIR` (default `~/.claude/skills`): **symlinks** `bin/*` and
  `skills/*` there (the machines' convention for repo scripts; only mods need
  copies for hot reload), and never replaces something that is not a symlink.
  `--no-agent` skips both. The skills' source is this repository.
- R16 **Late panels**: nav and git carry out a request up to 10 s older than their
  own start, so a panel first shown (or reloaded) just after a request still acts
  on it (found in testing: a panel in a background tab starts when first shown).

## Acceptance Criteria

- [x] `node --test tests/*.test.js`: request JSON building/escaping (quotes,
      backslashes, newlines, non-ASCII in paths); session from a socket path;
      rule matching (type, ext, any, order, missing file → defaults);
      `{path}` substitution as one argument; stale-request age check.
- [x] `shellcheck bin/* install.sh` clean.
- [x] Mac, local agent: `herdr-open README.md` opens a viewer tab in this
      space; again selects it; `--diff` shows the diff; `--edit FILE:5` opens
      nvim at line 5; `herdr-nav --worktree .` and `--reveal README.md` move nav
      (follow light out, README selected).
- [ ] `herdr-open --external README.md` opens Zettlr (the viewer's and nav's
      buttons were checked by the operator; the CLI path not yet).
- [x] Remote agent: a Claude session on njv-cachyos (viewed from the Mac app)
      runs `herdr-open <file>`; the viewer tab opens in that session's space
      in the Mac window, reading the file from njv-cachyos (simulated as t7,
      2026-11-24; the tab opened in that space without switching the view).
- [ ] Two windows on njv-cachyos (default, work): a request from a work
      terminal is handled by the work window only.
- [ ] A request written while no window is running is not replayed when one
      starts more than 60 s later.
- [x] viewer's "Open in Zettlr" button and nav's `e` key work for a local and a
      remote Markdown file.
- [ ] yazi-here retired (R14); skills installed on both machines.

## Threat model delta

New boundary: **the inbox**. Any process of the same user can write a
request; the same user can already open files and run apps, so this grants
nothing new. The inbox directory is created `0700`. Requests are parsed as
JSON with a fixed schema; unknown actions and non-absolute paths are
rejected; `path` reaches commands only as a single argument (`{path}`), never
through a shell. External-app argv comes from the person's own config file.
Remote inboxes are read through herdr's own machine connection.

## Risks & Assumptions

- `HC_TERMINAL_ID` is present in Claude's Bash tool environment (checked: it is,
  `t13` on 2026-11-24). If a future Claude Code scrubs it, R4's shown-space
  fallback applies.
- 2 s polling of remote inboxes costs one `exec` per machine per 2 s while the
  window is visible; acceptable, and stopped when hidden.
- A Zettlr window opened on njv-cachyos for a remote file appears on that
  machine's display, not the Mac's. That is R10's choice; copying the file to
  the Mac would edit a copy. Confirmed by the operator on 2026-11-24: an external app
  opens on the desktop of the file's machine, and is checked at that desk.
