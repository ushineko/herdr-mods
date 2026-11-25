# herdr-mods Project Guidelines

Follows the Ralph Wiggum methodology (see `~/.claude/CLAUDE.md`) with the extensions
below.

---

## Project Overview

- **Type**: JavaScript mods for the Herdr desktop app (`herdr-app`), plus a bash installer
- **Purpose**: The personal panels of the Herdr app on njv-cachyos and njv-mbp-m1:
  the nested tabs, the dock, the spaces bar, the terminal menu, and native
  replacements for the dock's yazi and lazygit (`viewer`, `nav`, `git`), and the
  agent CLIs and skills that drive them (`herdr-open`, `herdr-nav`).
- **Repository**: `github.com/ushineko/herdr-mods`, **private**. It may name the
  user's machines (njv-cachyos, njv-mbp-m1) and herdr machine names; it must not
  hold credentials of any kind.
- **Runtime**: Herdr's gpui-kit shell (QuickJS). No DOM, HTML, CSS, Node APIs or
  `setTimeout`. The API is the app's own files, rewritten on every app start:
  `~/.config/herdr-app/AGENTS.md`, `herdr.d.ts`, `gpui-kit.d.ts`. Read them
  before writing a mod; they win over memory.
- **Sibling projects**: `~/git/sysadmin/docs/herdr-desktop-app.md` documents how
  the app is set up on both machines; `~/git/dotfiles/setup/<host>/herdr-app/`
  snapshots layouts, keys and settings (not mods). `~/git/hayami` (on
  njv-cachyos) is the reference for conventions; spec 113 there plans
  `hayami-js`, a future client in this style.

---

## Cross-platform (non-negotiable)

Every mod, script and vendored piece must work on macOS and Linux (njv-mbp-m1
and njv-cachyos), and must not knowingly break Windows. Per-platform programs
go in a table chosen by `window().platform` (or the file's machine's platform
for remote files), as `cria-file-preview/programs.js` does. A
platform-specific tool (`sips`, `open`, `pbcopy`, `xdg-open`, `osascript`) is
only ever one entry in such a table, never the only path. A change that cannot
be tested on a platform says so in its commit and spec.

---

## Selected Policies

Load the following policy modules from `~/.claude/policies/`:

- `languages/bash.md`
- `git/simple.md`
- `release-safety/minimal.md`
- `testing/philosophy.md`
- `communication/standards.md`

There is no JavaScript policy module; follow the style of the shipped mods
(`~/.config/herdr-app/mods/files`, `changes`): chained builders, `theme()`
colours, no module-level side effects.

---

## Ralph Settings

```yaml
validation: milestones-only
```

A milestone is a spec reaching COMPLETE.

---

## Issue Tracking

GitHub Issues on this repository is the tracker, as in hayami.

- Anything that gets a spec gets an issue; the issue comes first.
- Specs are `specs/NNN-short-description.md` with an `**Issue**: #NN` line under
  the title. Spec numbers are this repository's; issue numbers are GitHub's.
- The issue body links the spec path once it exists.
- Commits go to `main` (git/simple); the commit that completes a spec says
  `Closes #NN`.
- Labels: `bug`, `enhancement`, `chore`, `documentation`.
- `gh` on njv-mbp-m1 may lack a valid token; run it on njv-cachyos
  (`hc exec --on njv-cachyos-default -- gh ...`).

---

## Layout and install

```
mods/<name>/     one folder per mod (main.js, mod.json, assets)
lib/             pure helpers shared by mods (no "herdr"/"gpui-kit" imports)
tests/           node --test unit tests for lib/
bin/             herdr-open, herdr-nav (agent CLIs; spec 005)
skills/          Claude Code skills for those CLIs
config/          example per-machine config (external.json)
specs/           specs
install.sh       copies mods (and lib/) into an app home
```

- **Never symlink a mod into an app home**: Herdr does not hot-reload a mod
  reached through a symlink. `install.sh` copies, comparing by content, so only
  changed mods reload. The work home on njv-cachyos gets symlinks to the
  default home's copies (`--link`), and so needs an app restart for changes.
- **Replacing a mod's folder closes its open copies** (tabs, dock blocks).
- A mod imports only its own files (`./x.js`). Shared code lives in `lib/` and
  `install.sh` copies it into each mod that lists it in `mod.json`'s `"lib"`
  array (see spec 001).
- After every install: `herdr-app check ~/.config/herdr-app/mods/<name>` must
  pass, and `herdr-app status` must show no errors.

---

## Testing

- **Unit**: pure helpers in `lib/` (parsing `git status`/`git worktree list`,
  path and breadcrumb logic, language detection, key maps) are tested with
  `node --test tests/*.test.js`. They take plain data and return plain data.
- **Load**: `herdr-app check` on every mod.
- **Real window**: anything visual is checked in the running app with
  `herdr-app shot` and read back; a spec's E2E section lists what to look at.
  Both machines when the change touches remote machines.
- No mocking of the herdr host API; code that needs it is checked in the real
  window instead.

---

## Environment

- njv-mbp-m1 (macOS): app home `~/.config/herdr-app`, one window.
- njv-cachyos (CachyOS): app homes `~/.config/herdr-app` (default) and
  `~/.config/herdr-app-work` (work, mods symlinked to default's).
- Install on njv-cachyos: `./install.sh --home ~/.config/herdr-app --link ~/.config/herdr-app-work`.
- Lint: `shellcheck install.sh`.

---

## Git

- No `Co-Authored-By` trailers and no AI attribution in commits, issues or PRs.
- Never commit settings, layouts or state from an app home; those are
  dotfiles' job.
