# 003 — git, a repository panel with lights

**Issue**: #3

## Status: INCOMPLETE

## Executive Summary

A `git` mod for the dock: the branch and its distance from upstream, the
repository's worktrees each with a light for the agents working in it, the
pending changes grouped as lazygit groups them, and a short set of
lazygit-style keys. Diffs and files open in `viewer` (001). It replaces
lazygit in the dock (004).

## Context

The dock's lazygit runs in a terminal per machine, re-pointed by `dock-follow`
through lazygit's Recent repositories menu. The shipped `changes` mod shows a
change list, a diff and a commit box, but nothing about worktrees, upstream or
agents, and few keys. Claude sessions often work in worktrees
(`~/.herdr/worktrees/<repo>/<branch>`); which worktree is busy is the question
the panel should answer at a glance.

## Requirements

### Where it is

- R1 **Follows the focused terminal's repository** (as nav's R1), with the
  same follow light and `F`. Choosing a worktree (R4) turns following off.
- R1a **Driven by agents**: accepts `worktree {path}` and `follow` from the agent
  inbox (005 R4, R7a) through shared state (`git.request.<dock>`): it shows that
  worktree (following off), or re-locks.
- R2 **Header**: machine pill, repository name, branch chip, upstream
  distance (`↑2 ↓1`, dim when 0/0, "no upstream" when none), and a busy light
  while a git command from R8 runs.

### Worktrees

- R3 **The worktree strip** lists `git worktree list --porcelain` for the
  repository: each worktree's branch (or detached commit), its folder relative
  to the main worktree's parent, and its number of changed files. The worktree
  being shown is highlighted; the one the focused terminal is in carries a
  small "here" mark.
- R4 Clicking a worktree shows it (R1's follow turns off).
- R5 **Agent lights**: for each worktree, the agents working in it: one light
  per agent, coloured by status — `working` accent with a slow
  `.loop("opacity")` pulse, `blocked` amber, `done` green, `idle` dim. Hover
  shows the agent's name and tab. Clicking a light focuses that agent's pane.
  Agents on other machines count for that machine's repositories only.
- R5a **Which worktree an agent is in** (operator, 2026-11-24: the lock in
  R11a depends on it). An agent's terminal stays in the folder its session
  started in while the agent works elsewhere (in a worktree, by path or by
  `cd` inside its own commands), so the terminal's folder alone is not enough.
  Signals, first match wins:
  1. **Its label** `herdr-mods.worktree=<path>` (set by `herdr-nav --worktree`,
     spec 005 R7a; `hc label`), read with `hc get` — `terminals()`, like
     `hc ls`, does not carry labels (found 2026-11-24).
  2. **Its program's folder**: the agent process's current folder
     (`foreground.cwd` from the same `hc get`, as `dock-follow` reads it),
     refreshed with the status scan (R13), at most every 3 s per machine.
  3. **Its terminal's folder** (`terminals()` cwd).
  The worktree is the deepest one containing that folder (`/w/a` is not inside
  `/w/ab`). The light's tooltip says which signal placed it.

### Changes

- R6 **Groups**, as lazygit: Staged, Unstaged, Untracked; each a header with a
  count, collapsible. Each row: status letter coloured (M amber, A green,
  D red, R blue, U red bold, ? dim), path relative to the root with the folder
  part dim, and for text changes `+n −m` from `git diff --numstat`.
- R7 Clicking a row, or Enter, opens its diff in `viewer` (staged rows the
  staged diff); `o` opens the file itself.
- R8 **Recent commits**: the last 5 on the branch (short hash, subject,
  relative age), dim, under the changes.

### Keys (mod focusable)

- R9 | Key | Action |
  |---|---|
  | `j`/`k`, arrows | move |
  | `space` | stage / unstage the selected file |
  | `a` | stage all / unstage all (toggles on whether anything is unstaged) |
  | `c` | commit: a one-line message field in the panel; Enter commits, Esc cancels |
  | `p` | pull |
  | `P` | push |
  | `f` | fetch |
  | `r` | refresh now |
  | `w` | jump focus to the worktree strip (then `j`/`k`, Enter) |
  | `?` | an overlay listing these keys |
- R10 **Pull** is `git pull --ff-only`; a pull that cannot fast-forward fails
  with git's message and changes nothing. **Push** is `git push`; with no
  upstream it is `git push -u origin <branch>`. Neither forces.
- R11 Each command from R9 runs with an argument vector on the repository's
  machine; the busy light shows while it runs; the result is a toast (first
  line of git's output, or its error), and the panel refreshes after.
- R11a **Locked while an agent works** (operator, 2026-11-24). While any agent
  whose terminal is inside the shown worktree has status `working` (R5's
  matching), the writing keys (`space`, `a`, `c`, `p`, `P`, `f`) do nothing but
  post a toast naming the agent ("Locked: claude is working in this worktree").
  The header shows a lock glyph in the working colour with the same tooltip.
  `blocked`, `done` and `idle` agents do not lock. Agents in *other* worktrees
  of the repository do not lock this one: separate worktrees are how agents
  work side by side. Reading (refresh, diffs, opening files) is never locked.
  A command already running when an agent starts finishes.
- R12 No other writing commands: no discard, stash, rebase, reset, checkout,
  branch create/delete. Those are asked of the agent.

### Live

- R13 Refresh on folder watch (local) or every 5 s (remote) while shown, using
  the shared status scan (002 R6); worktree list and upstream distance refresh
  with it; agent lights are live (herdr data, no polling).

### Layout

- R14 **Horizontal and vertical** (operator, 2026-11-24: the docks are on the
  right and at the bottom). The mod measures its block (`on_size_change`,
  divided by `settings().zoom`): wider than 1.8 × its height is horizontal,
  else vertical, re-decided on every resize. Vertical is the layout above.
  Horizontal: the header is one line (branch, upstream, follow light, machine, repository, lock) and the body is three columns side by side, each scrolling: worktrees (300 px), changes with the commit field, recent commits (320 px); keys are unchanged.

## Acceptance Criteria

- [x] Real window: in a wide, short block the horizontal layout shows; in a
      narrow, tall one the vertical; resizing switches between them.

- [x] `node --test tests/*.test.js`: `git worktree list --porcelain` parsing (main,
      linked, detached, locked, prunable); porcelain v1 `-z` into the three
      groups (including renames and a file both staged and unstaged);
      `--numstat` merging; agent-to-worktree matching by folder prefix (not a
      sibling with a shared prefix: `/w/a` vs `/w/ab`); signal order (label,
      then program folder, then terminal folder); upstream distance
      parsing; key map.
- [x] `herdr-app check` passes for `git`.
- [x] Real window: a repository with two worktrees and a Claude session working
      in one shows a pulsing light on that worktree and none on the other —
      including when the session was started in the main worktree and moved to
      the other with `herdr-nav --worktree`.
- [ ] Real window: with an agent `working` in the shown worktree, `space`, `a`,
      `c`, `p`, `P`, `f` are refused with the lock toast; once it is idle they work;
      an agent working in another worktree does not lock this one.
- [x] Real window: `space` on an unstaged file moves it to Staged; `a` stages
      all; `c` commits with a message (in a scratch repository); `f` fetches
      (toast); `p` on a diverged scratch branch fails cleanly with git's
      message.
- [x] Real window: Enter on a change opens a diff tab in `viewer`.
- [ ] Real window: a remote repository on njv-cachyos shows its changes and
      worktrees.

## Threat model delta

New: the panel **writes** to repositories (stage, commit, pull, push, fetch).
Boundary: what the person's keys can do. All commands are fixed argument
vectors with paths passed after `--`; commit messages are one argument, never
interpolated into a shell. No force, no history rewriting (R10, R12). Push and
pull use the person's existing git credentials through git itself; the panel
never reads or shows them.

## Risks & Assumptions

- A pull or push that prompts for credentials would hang `exec`; herdr's
  default timeout (30 s) ends it, and the toast says so. SSH remotes with an
  agent (the setup on both machines) do not prompt.
- Worktrees on another machine than the repository's terminal are not joined.

## E2E Test Plan

A scratch repository under `/private/tmp` with a bare "remote", two worktrees,
and a Claude session started in one (`hc run --cwd <worktree> -- claude`);
walk R3–R11 there, then the real `herdr-mods` repository read-only, then a
repository on njv-cachyos.
