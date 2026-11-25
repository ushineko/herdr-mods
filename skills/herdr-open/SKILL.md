---
name: herdr-open
description: >-
  Show the person a file in the Herdr desktop app from this session: in a viewer tab
  (Markdown rendered, code highlighted, images, PDFs, tables), as a git diff, in
  their editor (nvim or $EDITOR) at a line, or in its external app (Zettlr for
  Markdown). Use after writing or finding a file they should read, when they ask to
  "open", "show me", "let me see", "open it in nvim/the editor", "open in Zettlr",
  or to show a diff. ONLY works in a Herdr terminal ($HC_TERMINAL_ID set); otherwise
  it says so and does nothing.
---

# herdr-open

`herdr-open` (on PATH, from `~/git/herdr-mods/bin`) asks the person's Herdr window to
show a file in the space this session runs in. It returns at once (fire and forget);
the window posts a short notification when it acts.

## When to use

- You wrote or changed a document, plan or report they should read: show it.
- They ask to open, show or see a file, or to open it in their editor or in Zettlr.
- You want them to look at a change: show its diff.

Don't use it for every file you touch, only for what you want the person to look at.

## Usage

```bash
herdr-open notes/plan.md              # viewer tab (an already open one is selected)
herdr-open src/app.ts:120             # viewer tab; :LINE is kept for editors
herdr-open --edit src/app.ts:120      # their editor in a new tab, at line 120
herdr-open --diff src/app.ts          # working-tree diff in a viewer tab
herdr-open --staged src/app.ts        # staged diff
herdr-open --external docs/notes.md   # external app (Markdown: Zettlr), on the file's machine
herdr-open some/folder                # a folder goes to the nav panel instead
```

Relative paths are resolved against your current directory. A missing path exits 1
with a message; outside Herdr it exits 2 and sends nothing.

## Notes

- The file is opened from the machine this session runs on. If you run on
  njv-cachyos and the person looks from the Mac, the viewer still reads it from
  njv-cachyos; `--external` opens the app on njv-cachyos's own desktop (the person
  knows to check that machine).
- External apps come from `~/.config/herdr-mods/external.json` on the file's machine
  (default: Markdown → Zettlr, else the system's default app).
