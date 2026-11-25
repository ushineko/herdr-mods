# herdr-mods

Personal mods for the [Herdr](https://herdr.dev) desktop app (`herdr-app`):
JavaScript panels drawn natively by Herdr's GPUI shell.

## Mods

| Mod | What it does |
|---|---|
| `nested-tabs` | Pane header with nested tabs (port of the herdr TUI fork's pane stacks), and the per-tab yazi/lazygit panel |
| `dock-tabs` | Tab strip for the window-level dock |
| `dock-follow` | Keeps the dock's yazi/lazygit in the focused pane's folder |
| `spaces-bar` | Horizontal spaces bar; remote machines fold into one chip with a dropdown |
| `terminals-bar-proc` | Terminals bar showing each terminal's running program |
| `term-menu` | Dock-aware terminal right-click menu |
| `ui-lab` | Capability demo: Claude ↔ panel round trip, hayami usage meters, floating window |
| `cria-file-preview` | File viewer in a tab (vendored from gsydler/herdr-cria, Apache-2.0; see `vendor/cria/VENDOR.md`): Markdown with images and links, PDF, images, CSV/TSV, JSON, code, plus local diff view and "Open in <app>" |

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
