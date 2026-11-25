---
name: herdr-nav
description: >-
  Point the person's Herdr nav (folder) and git panels from this session: show a
  folder, reveal a file, hand control back, and — whenever you start or stop
  working in a git worktree — say so with --worktree, so their git panel shows that
  worktree and locks it while you work. Use after locating something under
  discussion, and every time you move into or out of a worktree. ONLY works in a
  Herdr terminal ($HC_TERMINAL_ID set). Replaces the old yazi-here skill.
---

# herdr-nav

`herdr-nav` (on PATH, from `~/git/herdr-mods/bin`) drives the nav and git panels in
the person's Herdr window. Requests act in the space this session runs in and return
at once.

## Usage

```bash
herdr-nav ~/git/project/src          # nav shows this folder (it stops following the terminal)
herdr-nav --reveal src/app.ts        # nav shows the file's folder with the file selected
herdr-nav --follow                   # nav and git follow the focused terminal again
herdr-nav --worktree ../project-feat # you now work in this worktree (any folder inside it)
herdr-nav --worktree -               # you left the worktree
```

## Worktrees (always do this)

When you start working in a git worktree — you created one, `cd` into one, or edit
files in one by path — run `herdr-nav --worktree <that worktree>` first. It:

1. labels your terminal (`herdr-mods.worktree`), so the person's git panel places
   your status light on that worktree and **locks its git writes (stage, commit,
   pull, push, fetch) while you are working**;
2. points the git and nav panels at it.

When you are done there (or switch back to the main checkout), run
`herdr-nav --worktree -` so the lock and light follow you again. Without the label,
the panel can only place you by the folder your session started in.

## When else

- After finding the file or folder the conversation is about: `--reveal` it.
- When the person asks to "show me where that is" or "go to <folder>".
- `--follow` to hand the panels back when you are done pointing at things.
