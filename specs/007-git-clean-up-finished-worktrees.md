# 007 — git: clean up finished worktrees

**Issue**: #7

## Status: INCOMPLETE

## Executive Summary

The git panel (003) gains a worktree clean-up: **Clean up…** on the Worktrees
section (every worktree) and right-click on a worktree row (that one). A
worktree is offered for removal only when it is fully committed **and pushed**,
not locked, and not in use by an agent or a running program. A dialog lists what
will be removed, what is skipped and why, and which shells will be moved; nothing
happens until **Remove**. Shells sitting in a removed worktree are moved to its
parent folder first. Branches are kept.

## Context

Repositories collect worktrees: platform-backend has 80. Removing one by hand
means checking it has nothing unpushed, finding any shell still sitting in it,
and running `git worktree remove`. The panel already knows the worktrees, their
changes and which agents are where (003 R5a).

## Requirements

- R1 **Entry points**: a **Clean up…** button in the Worktrees section header
  (all worktrees but the main one), and **Clean up this worktree…** in the menu a
  right-click on a worktree row opens (operator, 2026-11-24: a right-click never
  acts at once). The menu also has Show this worktree, Open in nav, Copy path.
- R3a **The dialog leads with what will be acted on** (operator): each worktree to
  remove is a card with branch, path, why it is safe (clean, pushed to its
  upstream / commit on a remote branch), its latest commit and the shells moved
  out; kept ones are summarised by reason (expandable) when several were checked,
  and shown as a card when one was.
- R2 **Eligible** only when all hold (operator, 2026-11-24):
  - not the main worktree, not `locked`;
  - **fully committed**: no staged, unstaged, untracked or conflicted files
    (`git status --porcelain=v2 --branch`);
  - **fully pushed**: on a branch with an upstream and not ahead of it (behind is
    fine), or, detached, its commit is on a remote branch
    (`git branch -r --contains HEAD`). Judged against the last fetch; the panel
    does not fetch by itself (`f` does);
  - **not in use**: no agent placed in it (003 R5a, any status), and every
    terminal whose folder (terminal or program) is inside it is a plain shell at
    its prompt (foreground program a shell). Anything else (nvim, a build, an
    agent) blocks, named in the reason.
- R3 **The prompt**: a dialog listing the worktrees to remove (branch, path), the
  shells to move (terminal, from → to), and the skipped ones with their reason.
  **Remove** and **Cancel**; Esc cancels. Nothing is changed before Remove.
- R4 **Removal**, per eligible worktree: type ` cd '<parent folder>'` into each
  shell (leading space: kept out of shell history; quoted for POSIX shells and
  PowerShell alike), wait briefly, then `git worktree remove <path>` **without**
  `--force` (git itself refuses a worktree with changes); finally
  `git worktree prune`. The branch is kept. Results in one toast per run
  (removed, failed with git's message).
- R5 Remote repositories: every check and command runs on the repository's
  machine (`exec` with `on`, `hc send` to the remote terminal).
- R6 If the shown worktree is removed, the panel shows the main worktree.

- R3b **A subset** (operator, 2026-11-25): each removable worktree has a checkbox
  (all ticked at first; "all" / "none"); the title reads "Remove N of M" and only
  ticked ones are acted on.
- R3c **Long branch names**: in the dialog the branch has a line of its own (it
  wraps); in the strip it takes the row's room, the folder giving way first, and
  the full names show on hover.

- R3d **Another user's files** (operator, 2026-11-25): git cannot delete files it
  does not own (root-owned `__pycache__` written by Docker into a mapped volume), and
  a remove that hits one fails half done. A scan before the dialog keeps such
  worktrees, naming the owner and an example path. **Fix ownership** (per card, and
  "Fix ownership of all N") runs `docker run --rm --pull never --network none
  --mount type=bind,source=<worktree>,target=/w alpine chown -R <uid>:<gid> /w` on
  the worktree's machine (no sudo; never pulls an image), checks again, and makes the
  fixed ones removable and ticked. A copyable `sudo chown` is the fallback.

- R3e **Really remove…** (operator, 2026-11-25): a kept worktree can be removed
  anyway (a stale one, whatever its state). A red outlined button opens a red panel
  listing what is LOST (uncommitted changes and untracked files; a detached commit
  on no branch or remote), what is kept (the branch and its commits), an overridden
  lock and shells moved; "Discard and remove" runs `git worktree remove --force`
  (twice for a locked one). Still refused: the main worktree, an agent working in
  it, another program running in it, another user's files (checked again just
  before).
- R3f While removing, the results replace the list in the scrolling area so the
  buttons stay in view; the dialog is at most 640 px tall.

## Acceptance Criteria

- [x] `node --test`: the planner (`lib/git.js` `planCleanup`) — main and locked
      skipped; dirty skipped; no upstream, ahead, detached-not-on-remote skipped;
      behind allowed; agent skipped; program terminal skipped; shells collected
      with their target folder; reasons readable.
- [ ] Real window, scratch repository with a bare origin: a pushed clean
      worktree with a shell in it is removed after the prompt and the shell is now
      in the parent folder; an unpushed one, a dirty one and one with nvim open are
      skipped with those reasons; the branch still exists.
- [ ] Right-click on one worktree plans just that one.
- [x] Nothing is removed on Cancel/Esc.

## Notes (2026-11-25)

- Verified by the operator on platform-backend (njv-cachyos-work): one worktree,
  `AP-22748-release-2026.20`, removed after the prompt; its branch remains
  (log: `clean-up: removed feature/AP-22748-…`).
- Bugs found on the way: (1) the check hung — a task spawned from a finished
  task's context left host calls unsettled; menu actions now start from a timer;
  (2) the dialog's list had no height inside a content-sized dialog; it now gets a
  definite height; (3) one attempt reported "permission denied" without removing
  anything — not traced (files, permissions, mounts, route all fine); every step's
  result is now shown in the dialog and logged, so a repeat will say exactly what.
- Still to check: the scratch scenario with skipped reasons (unpushed, dirty, nvim)
  and the shell move.

## Threat model delta

New destructive action: removing a worktree folder. Guards: explicit
confirmation listing exactly what goes; `git worktree remove` without `--force`
(git re-checks for changes); pushed-only rule, so no commit exists only there;
branches kept. Shell `cd` commands are fixed text with the folder single-quoted
(quotes in the path doubled for PowerShell, escaped for POSIX).
