# 013 — The Herdr app on Windows (win11-kvm)

**Issue**: #44

## Status: INCOMPLETE

## Executive Summary

Windows is a compatibility target for these mods, but until now the Herdr app had
never run there. This spec brings the app on win11-kvm to parity with njv-cachyos and
njv-mbp-m1 one step at a time: the app itself, our mods, the configuration, the
other machines, and the tools the mods call. Each step records what Windows needed
that macOS and Linux did not.

## Context

- **win11-kvm:** a Windows 11 guest on njv-cachyos (build 26200; Intel UHD 770
  vGPU by SR-IOV; 32 GB). The operator watches it with Looking Glass or RDP. Commands
  reach it over SSH from njv-cachyos (`ssh win11-kvm`, user `nvere`, an
  administrator).
- **Herdr app 0.1.18**, Windows build, installed per user with its own
  `install.ps1` (2026-11-26) into `%LOCALAPPDATA%\Programs\herdr-app`. The app home
  is `C:\Users\nvere\.config\herdr-app`, as on the other systems. herdr-core 0.1.22
  was already there (`hc machine add win11-kvm --install` from njv-cachyos).
- **Found on day one: an elevated core locks the app out.** OpenSSH on Windows
  gives an administrator's session the elevated (high integrity) token. A core
  started by an SSH connection (njv-cachyos's `herdr-core connect`) made its pipe
  at high integrity, and the desktop app (medium) got "permission denied (os error
  5)" opening it. A core started in the desktop session is reachable from both
  sides. The fix: the task "herdr-core at logon" runs `herdr-core server start`
  hidden (`conhost --headless`) at sign-in, interactive and not elevated.
- **Machines:** `C:\Users\nvere\.ssh\config` has `njv-cachyos` and
  `njv-mbp-m1`/`mbp` over Tailscale with `njv_ssh_key` (backup `config.bak-herdr`).
  The Windows core has `njv-cachyos-default`, `njv-cachyos-work` (`--session
  work`) and `njv-mbp-m1`, named as on the Mac.
- **Git Bash** (Git for Windows) has bash, coreutils and node, but no `rsync`, and
  `python3` is the Microsoft Store stub. `install.sh` used both.
- **The checkout:** `~\git\herdr-mods` on Windows. Git for Windows defaults to
  `core.autocrlf=true`, which checked files out with CRLF and broke `install.sh`
  under bash; `.gitattributes` now fixes LF for the repository (CSV samples
  excepted). Windows' OpenSSH reaches GitHub with the agent's key, but run from a
  non-interactive SSH session it hangs once git talks over its stdin; the first
  clone came from a bundle made on njv-cachyos, with `origin` set to GitHub.
- **Mod checks need the desktop:** `herdr-app check` opens a window, so over SSH it
  runs through a one-off scheduled task in the desktop session (interactive).

## Requirements

- R1 **App.** The app installed with its own installer opens a window on
  win11-kvm; `herdr-app status` answers with no errors; `herdr-app shot` works.
- R2 **Core in the desktop session.** At sign-in a core starts in the desktop
  session, not elevated, so the app can use it whatever connects first.
- R3 **Machines.** The Windows app reaches njv-cachyos (default and work cores) and
  the Mac, named as on the Mac.
- R4 **Installer.** `install.sh` runs under Git Bash on Windows as on macOS and
  Linux: it needs bash, coreutils and node (no rsync, no python3), copies only
  changed files, removes files a mod no longer has, and reports what changed. Its
  agent commands and skills part is skipped on Windows (`--no-agent`) until those
  have a Windows form.
- R5 **Mods load.** Every mod in this repository installed on Windows passes
  `herdr-app check`; `herdr-app status` shows no errors.
- R6 **Config.** keys.json, settings.json and the terminals-dock layout as on the
  other machines (Windows keys where the shortcuts differ), snapshotted in dotfiles
  for win11-kvm.
- R7 **Mods work.** The window shows the spaces bar, tab bar, nested tabs, the dock
  (nav, git, viewer) and a chat; the Windows rows of the per-platform tables
  (`cria-file-preview/programs.js`, `lib/edit-open.js`, `lib/external*.js`,
  `ushi-naruse/platform.js`) do what they say. Each tool a mod calls that is
  missing on Windows is listed with its install decision.

## Acceptance Criteria

- [x] R1: the app's window opens; `status` answers with no errors; a screenshot read
  back. (2026-11-26, after the core fix below.)
- [x] R2: the task "herdr-core at logon" exists (interactive, limited); a run leaves
  a running core alone. A real sign-in is still to be seen.
- [ ] R2 at sign-in: after a sign-out and sign-in, the core runs in the desktop
  session and the app opens.
- [x] R3: `hc machine ls` on Windows: `njv-cachyos-default`, `njv-cachyos-work`
  (session work), `njv-mbp-m1`, all connected.
- [x] R4: `install.sh` without rsync and python3 (2d59c9b): the real homes
  unchanged and a second run installing nothing on macOS, Linux and Windows; a fresh
  home gets all 13 mods; a changed file reinstalls only that mod (macOS). Windows:
  first install 25 s under Git Bash.
- [x] R5: `herdr-app check` passes for every mod on Windows, run in the desktop
  session (in an SSH session it fails: "cannot open windows while headless");
  `herdr-app status` shows no errors.
- [x] R6: on Windows: njv-cachyos's keys.json (Ctrl-based; the Mac's are Cmd-based)
  and terminals-dock layout (own title bar and window buttons); settings.json was
  already the same. Dotfiles: `setup/win11-kvm/herdr-app/` with backup.sh and
  restore.sh for Git Bash. The layout shows the spaces bar with the three remote
  machines, the tab bar, nested tabs and the bottom dock (nav, git, hayami).
  programs.json is not carried over (it names the Linux `claude-max` wrapper).
- [ ] R7: each mod looked at in the Windows window; the tools list written here.

## Test approach

Unit tests stay as they are (`tools/test-windows.sh` already runs them on
win11-kvm). The installer is checked by running it twice on each system and
comparing what it reports. Everything else is checked in the real window: a
screenshot read back over SSH (`herdr-app shot`, downscaled with
System.Drawing) and the operator's look through Looking Glass or RDP.

## Threat model delta

The logon task runs the user's own herdr-core, not elevated. The SSH config entries
use the existing key from the agent; no key or credential is added to this
repository. The Windows core reaches the other machines only over Tailscale.
