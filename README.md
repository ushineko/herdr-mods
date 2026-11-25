# herdr-mods

Personal mods for the [Herdr](https://herdr.dev) desktop app (`herdr-app`):
JavaScript panels drawn natively by Herdr's GPUI shell.

## Mods

| Mod | What it does |
|---|---|
| `nav` | Folder panel (spec 002): follows the focused terminal's folder, breadcrumbs, git marks, opens files in the viewer, right-click menu (open, edit, open in app, copy path) |
| `git` | Repository panel (spec 003): branch and upstream, worktrees with a light per agent (writes locked while an agent works there), changes with diffs, recent commits with drill-down, lazygit keys. **Clean up…** (spec 007) removes worktrees that are clean and pushed, with a checkbox each; root-owned files (Docker writing to a mapped volume) are handed back through default Docker; a kept worktree can be removed anyway with **Really remove…**, which says what is lost |
| `nested-tabs` | Pane header with nested tabs (port of the herdr TUI fork's pane stacks), and the per-tab nav/git panel |
| `dock-tabs` | Tab strip for the window-level dock; its fixed tab holds nav and git as a split |
| `dock-follow` | Keeps the dock's nav and git on the focused pane's folder; handles agent requests (`herdr-open`, `herdr-nav`) |
| `spaces-bar` | Horizontal spaces bar; remote machines fold into one chip with a dropdown |
| `terminals-bar-proc` | Terminals bar showing each terminal's running program |
| `term-menu` | Dock-aware terminal right-click menu |
| `ui-lab` | Capability demo: Claude ↔ panel round trip, hayami usage meters, floating window |
| `cria-file-preview` | File viewer in a tab (vendored from gsydler/herdr-cria, Apache-2.0; see `vendor/cria/VENDOR.md`): Markdown with images and links, PDF, images, CSV/TSV, JSON, code, plus local diff view and "Open in <app>" |

## Where mods run

Mods run only in the herdr-app window, on the machine that window runs on. A Mac
window runs the Mac's copies even for a remote machine's terminals; commands for the
remote go there through herdr-core (`exec(..., { on })`). A Linux window runs Linux's
copies. So install on every machine where a window is opened; `bin/` and `skills/`
go where agents run. A window without these mods works as plain Herdr.

## Agent commands and skills

`bin/herdr-open`, `bin/herdr-nav` (on `bin/herdr-request`) let a Claude session in a
Herdr terminal show a file (viewer, diff, editor, external app) or point the nav and
git panels (spec 005). The skills in `skills/` tell agents when to use them. The source
lives here; `install.sh` symlinks `bin/*` into `~/.local/bin` and `skills/*` into
`~/.claude/skills`. Per-machine external apps: `~/.config/herdr-mods/external.json`
(see `config/external.example.json`).

## Tests

```sh
npm test    # ./run-tests.sh: ours + the vendored cria tests, under a throwaway TMPDIR
```

## Install

```sh
./install.sh                     # all mods into ~/.config/herdr-app
./install.sh ui-lab              # one mod
# njv-cachyos: default home gets copies, work home gets symlinks to them
./install.sh --home ~/.config/herdr-app --link ~/.config/herdr-app-work
```

Herdr does not hot-reload a mod reached through a symlink, so the app home
gets real copies. Edit here, then run `./install.sh`; Herdr reloads the
changed mods within a second. Check a mod with
`herdr-app check ~/.config/herdr-app/mods/<name>`.

The API reference is written by the app on every start:
`~/.config/herdr-app/AGENTS.md`, `herdr.d.ts`, `gpui-kit.d.ts`.

## History

The first six mods were moved here from
`ushineko/dotfiles:setup/njv-cachyos/herdr-app/default/mods` (last commit there:
`fe01cbb`). Their earlier history is in that repo.
