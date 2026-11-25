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
  (all worktrees but the main one) and right-click on a worktree row (that one).
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

## Acceptance Criteria

- [ ] `node --test`: the planner (`lib/git.js` `planCleanup`) — main and locked
      skipped; dirty skipped; no upstream, ahead, detached-not-on-remote skipped;
      behind allowed; agent skipped; program terminal skipped; shells collected
      with their target folder; reasons readable.
- [ ] Real window, scratch repository with a bare origin: a pushed clean
      worktree with a shell in it is removed after the prompt and the shell is now
      in the parent folder; an unpushed one, a dirty one and one with nvim open are
      skipped with those reasons; the branch still exists.
- [ ] Right-click on one worktree plans just that one.
- [ ] Nothing is removed on Cancel/Esc.

## Threat model delta

New destructive action: removing a worktree folder. Guards: explicit
confirmation listing exactly what goes; `git worktree remove` without `--force`
(git re-checks for changes); pushed-only rule, so no commit exists only there;
branches kept. Shell `cd` commands are fixed text with the folder single-quoted
(quotes in the path doubled for PowerShell, escaped for POSIX).
