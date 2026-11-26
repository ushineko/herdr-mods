# Validation report: spec 013, the Herdr app on Windows (win11-kvm)

- **Spec**: specs/013-herdr-app-on-windows.md (issue #44)
- **Date**: 2026-11-26
- **Commits**: 2d59c9b (install.sh without rsync/python3, the spec), 3131ce4
  (`.gitattributes`, R4/R5), 0d931d3 (R6), c2a20a3 (R7), and the commit that
  closes #44. Dotfiles: 5a9b937 (win11-kvm config snapshot), aed369a (mermaid-cli
  module). Sysadmin: 71c8883 is spec 012's mobile-app note; no sysadmin change here.
- **Related**: spec 014 (the chat on Windows, #45), #47 (Claude sessions resumed
  after a reboot on Windows, follow-up).

## Phase 3: Tests

| Platform | Command | Result |
|---|---|---|
| macOS (njv-mbp-m1) | `npm test` | 279 pass, 0 fail |
| Linux (njv-cachyos) | `./run-tests.sh` | 279 pass, 0 fail |
| Windows (win11-kvm) | `tools/test-windows.sh` | 288 tests: 270 pass, 0 fail, 18 skipped (at spec 014's close) |

**Installer (R4):** `install.sh` was run twice on each system. The real homes
were unchanged; a fresh home got all 13 mods; a second run installed nothing; the
installed result matched the repository. The first install on Windows, under Git
Bash, took 25 s.

**Real window (Windows):**
- **R1:** the window opens; `status` and `shot` answer.
- **R5:** `herdr-app check` passes for all 13 mods in the desktop session.
- **R6:** the `terminals-dock` layout with the Linux keys.
- **R7:** each mod in daily use (operator).
- **R3:** the machines `njv-cachyos-default`, `njv-cachyos-work` (session work) and
  `njv-mbp-m1` are connected.
- **R2 (a reboot at 14:37):** the logon task started the core in the desktop
  session; njv-cachyos's SSH connection attached to it 7 s later; the app opened
  with no errors.

What Windows needed that macOS and Linux didn't, all recorded in the spec:
- **The core's session:** a core started over SSH ran elevated, and the desktop
  app couldn't open its pipe (os error 5). The fix is a logon task that starts
  the core in the desktop session.
- **The installer:** no rsync, and `python3` is only the Microsoft Store stub.
  The fix is node with cmp and cp.
- **Line endings:** CRLF checkouts broke `install.sh` under bash. The fix is
  `.gitattributes`.
- **Mod checks:** `herdr-app check` needs a desktop, so over SSH it runs through
  a one-off scheduled task.
- **Cloning:** `git clone` over Windows' OpenSSH hangs from a non-interactive SSH
  session. The first clone came from a bundle.

Not covered:
- **Claude Code sessions after a reboot on Windows:** not resumed (#47).
- **`herdr-open` and `herdr-nav`:** these bash agent commands aren't installed on
  Windows (`--no-agent`). A Windows form is only needed if wanted.

## Phase 4: Code quality

- `install.sh` lost its two outside tools without growing: `sync_dir` (about 25
  lines) replaces the rsync call and keeps the same output. shellcheck is clean.
- No dead code was left; the help text describes the new requirements.

## Phase 5: Security

- **Dependency scan:** the repository has no npm dependencies, so there is nothing
  to scan.
- **The logon task:** runs the user's own `herdr-core server start`, interactive
  and not elevated (`RunLevel Limited`), so the core's pipe stays at the user's
  normal integrity.
- **SSH:** Windows' config entries use the existing `njv_ssh_key` from its agent
  and reach the other machines over Tailscale only. No key or credential is in
  either repository.
- **Secrets:** none in the changed code.

## Phase 5.5: Release safety (minimal)

Rollback, item by item:
- **The installer:** revert 2d59c9b, which brings rsync and python3 back on macOS
  and Linux.
- **`.gitattributes`:** revert 3131ce4.
- **Windows:** delete the task ("herdr-core at logon"), restore
  `.ssh\config.bak-herdr` and `keys.json.bak-default`, and uninstall the app from
  `%LOCALAPPDATA%\Programs\herdr-app`.
