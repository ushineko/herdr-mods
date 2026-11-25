# 006 — evaluate herdr-nvim

**Issue**: #6

## Status: INCOMPLETE

## Executive Summary

Decide whether `ChmaraX/herdr-nvim` (MIT) earns a place beside nav, git and the
viewer: a persistent per-tab Neovim sidebar with a picker over the files an agent
touched, code annotations sent to agents, and Markdown/image preview. Evaluated
**built from source**, in a test layout, without touching the person's keys,
Files panel or dock. The outcome is a recommendation — adopt, borrow specific
parts, or skip — written into this spec.

## Context

The editor question (2026-11-24) was answered with option 3: the person's own
Neovim in a terminal tab (`herdr-open --edit`, cria's Edit button). No gallery
mod offers a native-looking editor with vim keys. herdr-nvim is real Neovim, so
it is the candidate for a richer integration. Its installer downloads a prebuilt
Rust binary (`curl | sh`) and points Files at its own tree and adds keys; both
conflict with how this repository is built (no unaudited binaries; nav owns the
folder panel).

## Requirements

- R1 Read the source: every `exec`/`hc` call, network access, what it writes
  and where, its keys, what it changes in layouts and Files; cross-platform paths
  (macOS, Linux, Windows; the project's non-negotiable rule).
- R2 Build the binary from a pinned commit with `cargo build --release` (ask
  before installing a Rust toolchain if one is missing); record the commit.
- R3 Install into a **copy** of the app home or a test layout only; never merge
  its `keys.json` or repoint Files in the person's setup during the evaluation.
- R4 Try it with a real agent session: sidebar toggle, picker over agent-touched
  files, annotations sent to Claude, preview.
- R5 Write the decision: adopt (how it coexists with nav/git/viewer and the
  dock), borrow (which parts, licence notices), or skip (why).

## Source review (R1)

Read at `2905408` (2026-11-17, v1.3.1; "install and run herdr-nvim in the Herdr app
on Windows"): the Rust binary (`src/`, about 19k lines, no `build.rs`), the two app
mods (`herdr-app/mods/`, about 3k lines of JS), the Neovim plugin (`lua/`, `plugin/`)
and the installers. Its own account of itself (`herdr-app/RECIPE.md`) matched the
code wherever checked.

**Processes.** Every command in the binary, the mods and the plugin is an argument
list; no `sh -c`, `cmd /c` or string `system()` on any path the app reaches (the
TUI-only `doctor` builds one quoted shell string). Text that reaches nvim is quoted
for Vim (`vim_string_literal`, `fnameescape`). Programs run: `nvim` (one headless
per tab, shown with `--remote-ui`), `hc`, `herdr-app`, `git -C <dir>` (status,
rev-parse; a hostile repo's `core.fsmonitor` is the usual git risk), `ps`/`pgrep`/
`kill` (Unix) or `taskkill` (Windows), `plutil` (macOS app discovery), the system
opener on the tree's `o` key (`open`/`xdg-open`/`explorer.exe`), and for the
Neovim install only `brew`, `curl`, `tar`. The mods `hc kill` only their own picker
terminal; the binary kills only its own daemons (pid checked against the socket,
process group; on Windows a registry marker plus creation time).

**Network.** None at run time except the opt-in Neovim install (`src/nvim_get.rs`:
GitHub's latest-release API, then `curl`; SHA-256 from the same API response, so
it catches corruption, not a compromised release). The mods use none. The
published installer (`curl | sh`) downloads a release bundle checked only against a
`.sha256` from the same release; building from source avoids it.

**Writes.**
- App home (`--home DIR`, else `$HERDR_APP_HOME`, else `~/.config/herdr-app`; it
  must be a running app's home): mods `herdr-nvim` and `herdr-nvim-header` (each
  with a `.herdr-nvim` mark; a same-named folder without it is refused);
  `keys.json` entries only on free keys (`cmd-e`, `cmd-o`, `cmd-shift-e`; `alt-` on
  Windows); the layout on screen patched once at install: the Files slot becomes
  its tree, a floating always-rendered `herdr-nvim-sync` block, every pane header
  replaced by `herdr-nvim-header` (a frozen copy of the shipped `mods/pane`), the
  panel 300px. On one of Herdr's own layouts it runs `layout.clone` (which
  switches the window) or switches to an existing `<name>-copy`. Uninstall reverses
  the patch in every personal layout, removes its keys and mods, stops its nvims.
- Outside the app home, shared by every home: `~/.config/herdr-nvim/config.toml`,
  `~/.local/share/herdr-nvim/app/<stamp>/` (runtimes; also `nvim/` if it installs
  Neovim), `~/.local/state/herdr-nvim`, sockets under `$XDG_RUNTIME_DIR/herdr-nvim`
  (else the temp dir). An install or uninstall in one home prunes runtimes no live
  nvim uses, which would break an install in another home; daemons are keyed by
  tab id and `stop_all` ignores the home. Harmless with one home, but a second app
  home does not isolate these folders.
- Nothing in `~/.claude` or the person's nvim config. The headless nvims load the
  person's config, then add the plugin (`--cmd set rtp+=…`, a VimEnter hook).
- Sandbox widening, by design: `app-preview --stage <path>` copies any readable
  file into `mods/herdr-nvim/.cache` so the mod can show it; `app-mermaid --out`
  writes where it is told. The cache deletes files its record doesn't know.

**Reads.** Agent session logs for the picker, file paths from tool calls only:
`$CLAUDE_CONFIG_DIR` or `~/.claude/projects/<slug>/*.jsonl`, `~/.pi/agent/sessions`,
`~/.gemini/antigravity-cli/brain`; nvim's fff frecency database; the registry PATH
on Windows.

**At run time in a window.** Shared keys `herdr-nvim.*`; with `tree = "nvim"` it
rewrites the global `workspace.panels` (we would keep the default). The sync block
shows or hides the side panel on every tab switch while it shows Files (leaves it
alone on Changes); any of our panels in that same panel would hide with it. Before
showing nvim it focuses the tab's "own" pane, which may be one of our mod panes,
and moves between nvim and the tree with `pane.go left/right` (the panel must stay
right of nvim). It polls its config every second (a process only when the file
changed). Commands: `herdr-nvim.pick`, `.reveal`, `.toggle`, `.swap`, `.files`,
`.welcome`, `.uninstall`; others open a file in a tab's nvim with
`mods/herdr-nvim/bin/herdr-nvim open --tab <tab> <file>[:line[:col]]`.

**Neovim plugin.** `plugin/` only registers `:Herdr`. In nvims it starts:
`<leader>ac/al/as/aS/ai` (comments; skipped where mapped), `<leader>e` (and
`<leader>E/fe/fE`) only when free or opening Snacks, neo-tree or nvim-tree.
Comments go to the agent as one prompt: "Code review comments from my editor
(repo, branch)", each `path:line` with up to three quoted lines and the comment,
pasted with `hc send` (or submitted).

**Cross-platform.** macOS, Linux and Windows paths (`USERPROFILE`, named pipes;
`~/.local/share` on Windows too); macOS-only pieces (`plutil`, Core Text fonts)
have fallbacks. RECIPE says Linux is untested in the app; CI covers Windows with a
stand-in app. 14 small `unsafe` blocks (setsid, tcflush, Win32).

**For the trial.** Build with `cargo build --release` and install with
`target/release/herdr-nvim app-install --home <test home>` (what
`herdr-app/install.sh` does), never the published installer. The test home needs
its own personal layout so no `layout.clone` happens; nvim 0.12.6 is already on
njv-cachyos, so no Neovim download. njv-cachyos had no herdr-nvim folders before the
trial (2026-11-25), so the clean-up removes all four shared folders.

## Acceptance Criteria

- [x] Source review notes (R1) in this spec.
- [ ] Built from source at a recorded commit (R2).
- [ ] Hands-on trial in an isolated home/layout (R3, R4).
- [ ] Recommendation recorded and agreed with the operator (R5).
- [ ] The trial home/layout and build artefacts removed afterwards.

## Threat model delta

Evaluation only. A Rust binary built from reviewed source runs in a throwaway
app home; nothing is installed into the person's setup.
