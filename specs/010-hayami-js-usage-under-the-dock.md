# 010 — hayami-js: usage under the dock's nav and git

**Issue**: #26

## Status: COMPLETE

## Executive Summary

The lower dock's hayami-tui terminal is gone. `lib/hayami.js` (hayami-js) reads
the hayami service (hayami spec 113) on the machine the dock follows, by running
curl over its Unix socket (Linux, macOS) or `hayami-tui api get` (Windows) through
herdr's `exec`, and `mods/hayami-usage` draws its usage under nav and git in both
docks. Reviewers should look first at `dock-tabs`' `panelsNode` and migration
check, which own the dock's fixed subtab and so carry the new block.

## Context

The lower dock is a layout block, `usage-dock` (96 px, at the bottom of the
window), holding a terminal named `usage` in which `dock-follow` keeps
`hayami-tui --sections usage --arrangement row` running. It has three faults:

- it shows the usage of the window's own machine, whichever machine the dock's
  nav and git are following;
- it is a whole terminal, with its own TUI, for a few lines of figures, and it
  is started again by a 10 s timer whenever it is gone;
- it is a separate block outside the dock.

hayami now serves its readings to other programs of the same account (hayami
spec 113, `hayami-tui serve`): HTTP/1.1 `GET`s over a socket only the account
can open, JSON under the contract `api/openapi.yaml` in the hayami repository,
prose in its `docs/api.md`. That spec names herdr as the first consumer and a
JavaScript client, `hayami-js`, written outside hayami. This spec writes that
client here, in herdr-mods, which owns it, and puts its first use in the dock.

**Usage only.** Other sections (bandwidth, cooler, peripherals, clock) come
later, on the same client.

## Decisions (operator, 2026-11-25)

- **Transport**: Herdr mods run in QuickJS and have no sockets; the only way out
  is `exec(command, args, { on })`. So hayami-js runs one command on the target
  machine per request:
  - Linux and macOS: `curl --unix-socket <address> http://hayami/v1/…`, the
    address worked out in `/bin/sh` by the contract's rule;
  - Windows: `hayami-tui api get …`, since curl cannot open a named pipe nor
    check who serves it (`docs/api.md`, "Who is at the address, on Windows").
- **Placement**: the window dock only, under nav and git, in both `dock-bottom`
  and `dock-right`. Not the per-tab panel nested-tabs opens.
- **No service**: the block says so in one dim line and keeps its size.

## Requirements

- R1 **`lib/hayami.js`, the client.** Pure: no `herdr` or `gpui-kit` import, so
  `node --test` can run it. It takes an `exec`-shaped function and a platform,
  and offers:
  - `request(platform, path)` → `{ command, args }` for that platform (R2);
  - `parse(result)` → `{ ok: true, status, body }` or `{ ok: false, kind,
    message }`, from an exec result, where `kind` is one of `no-service`
    (nothing listening, socket missing, `hayami-tui` absent), `http` (a non-200
    with the contract's `{error: {code, message, known}}`), `bad-json`,
    `failed` (anything else);
  - `get(exec, platform, path, { on, timeout })`, the two together;
  - `readings(exec, platform, sections, opts)` → the `Readings` body's
    `readings` map;
  - `usageRows(section)` → the plain rows R5 draws: per account its `name`,
    `plan_badge`, and per window `name`, `utilisation_pct`, `resets_at`,
    `used`/`limit`/`note`; plus the section's `absences` and `error`.
  It ignores fields it does not know and tolerates `null` wherever the contract
  allows one (the contract only grows within `/v1`).
- R2 **The address, by the contract's rule** (`docs/api.md`, "Connecting"):
  - Linux: `$XDG_RUNTIME_DIR/hayami/api.sock`; where the variable is unset
    (herdr-core's `exec` can run with a bare environment over SSH),
    `/run/user/$(id -u)/hayami/api.sock`;
  - macOS: `$TMPDIR/hayami/api.sock`; where unset, `getconf
    DARWIN_USER_TEMP_DIR`;
  - Windows: not computed; `hayami-tui api get` works it out.
  Paths are quoted for the shell; the only parameters are section keys from a
  fixed list (`usage` now), so no caller-supplied text reaches the shell.
  curl runs with `--max-time` below the exec timeout, `-sS`, and `-w` to append
  the status code, so an HTTP error is told from a transport error.
- R3 **`mods/hayami-usage`, the block.** A `place: "none"` mod drawn in a layout
  block under nav and git. It reads usage through R1 from the machine the dock
  follows: the focused terminal's machine (`terminalLocation()`, else
  `fallbackLocation()`, from `lib/location.js`), kept while a block or mod pane
  has focus, as nav does. The machine's platform is learned once per machine
  (as nav's `machineOf`).
- R4 **When it reads.** Every `interval_s` the section reports (30 s today),
  never more often than every 15 s, and only while the window is visible. At
  once when the followed machine changes. The service reads a section only
  while a client asks, so a hidden window costs the machine nothing.
- R5 **What it shows**, in herdr's own style (`theme()` colours, the shipped
  mods' builders), one line per usage window, across the block's width: the
  account and its plan badge, the window's name, a meter of `utilisation_pct`,
  the percentage, and the time to `resets_at` (or `note` where the provider
  gives `used`/`limit` instead of a span). The meter's colour follows the
  window's share (as ui-lab: accent, then `working` from 70 %, `blocked` from
  90 %). A header line names the machine, and the section's absences (such as
  `stale`, `read 17m ago`) in dim text. Values that change never resize the
  block (fixed-width figures).
- R6 **No service.** When `kind` is `no-service`: "<machine>: hayami service
  not running" in dim text, the block keeping its height. Other failures: the
  message, one line, truncated. The last good reading is kept, marked stale,
  through a transient failure on the same machine; it is dropped when the
  followed machine changes.
- R7 **The lower dock goes.** `dock-follow` no longer starts the `usage`
  terminal (its `ensure`, `start`, `withPath`, `USAGE`/`BLOCK` and timer go, and
  its header comment and `mod.json` title are updated). The `usage-dock` block
  is removed from the layouts, and a `hayami-usage` block is added under nav and
  git: `dock-bottom-panels` becomes a column of the existing nav|git row and the
  usage block; `dock-right-panels` (already a column) gains the block last.
  Layouts are dotfiles' (`~/git/dotfiles/setup/<host>/herdr-app/`), so this
  repository gives the change as a documented edit and the app homes are edited
  on each machine; the dotfiles snapshot follows.
- R8 **Cross-platform.** Linux and macOS are exercised; the Windows entry is
  written and unit-tested but the Herdr app has not run on Windows yet, which the
  commit says.

## Acceptance Criteria

- [x] `lib/hayami.js` exists with no `herdr`/`gpui-kit` import and exports the
      R1 functions.
- [x] Unit: `request` gives a curl command with the R2 address rule on Linux and
      macOS and `hayami-tui api get <path>` on Windows; no argument carries text
      from outside the fixed section list.
- [x] Unit: `parse` turns a 200 into its body; a 404 with the error envelope into
      `http` with the code and message; curl's "couldn't connect" (exit 7) and a
      missing socket into `no-service`; non-JSON into `bad-json`.
- [x] Unit: `usageRows` on an invented reading with a span window, a spend window
      (`used`/`limit`/`note`, `span_s: null`), a `null` `plan_badge` and an
      absence gives the rows R5 needs; an unknown extra field is ignored.
- [x] Integration (real downstream): a `node --test` case runs the real curl
      command against the running service on this machine and gets a `usage`
      section that holds to the shape `usageRows` reads; it skips, saying why,
      when no socket is there.
- [x] `herdr-app check ~/.config/herdr-app/mods/hayami-usage` passes;
      `herdr-app status` shows no errors.
- [x] Real window (njv-cachyos): the block under nav and git shows this
      machine's usage; the lower dock is gone; a shot is read back.
- [x] Real window: focusing a terminal in an njv-mbp-m1 space switches the block
      to the Mac's usage (or its "service not running" line), and back.
- [x] Real window (njv-mbp-m1): the same, seen from the Mac's window.
- [x] Moving the dock to the right (`dock-right`) shows the block under git.
- [x] `dock-follow` no longer starts a `usage` terminal; nothing else it does
      changed (title, resume, inbox).
- [x] `npm test` on the Mac, `./run-tests.sh` here, `tools/test-windows.sh` for
      Windows pass.
- [x] README's Mods table lists `hayami-usage` and the dock-follow row no
      longer mentions the usage strip; BACKLOG's hayami-js item is replaced by
      the follow-up (more sections).

## Notes (2026-11-25)

- **dock-tabs owns the dock's fixed subtab.** It rebuilds both docks' stacks from
  its `panelsNode` template whenever subtabs change, and migrates a stack whose
  first child is not that shape. So the usage block is part of the template
  (`dock-<side>-usage`, 144 px; the bottom dock's nav|git row is
  `dock-bottom-navgit` inside the `dock-bottom-panels` column), and the migration
  check also looks for the usage block. A layout edited by hand and a layout
  dock-tabs writes are the same tree.
- Layouts edited: `terminals-dock.json` in both njv-cachyos app homes (the
  layout both windows use). `main-bottom.json` (not in use) still has the old
  `usage-dock` block.
- Verified on njv-cachyos: the block under nav|git with this machine's five
  usage windows; an njv-mbp-m1 space switches it to the Mac's usage (one
  account); with `hayami-api.socket` stopped it says "this machine: hayami
  service not running" at the same height, and recovers on the next read once
  the socket is back; the right dock shows it under git; the work window shows
  it after the layout edit. The old `usage` terminal (t6) was ended and has not
  come back.

## Follow-up: one line per account (#28, 2026-11-26)

R5 drew a line per usage window, so Codex (5h, 7d, limit) took three. Now each
account is one line with one meter, by hayami's own rule (hayami
`internal/view/usage.go`, `leading`): the shortest window, or the `limit` once a
window with a span is full (`leadWindow`). The other windows are figures beside
it, amounts where given and days left when they reset later (`otherFigures`), in
a block wide enough for them (620 px); a narrower one, such as the right dock,
keeps the meter and drops the figures. The block is 100 px (header and three
accounts) instead of 144. Checked in the bottom and right docks on njv-cachyos.

## E2E results (2026-11-25)

- Step 1: njv-cachyos default window, local terminal: five usage windows, same
  figures as `hayami-tui api get readings?sections=usage`. Pass.
- Step 2: an njv-mbp-m1 space: header "njv-mbp-m1", the Mac's one account. Pass.
- Step 3: `hayami-api.socket` stopped: "this machine: hayami service not
  running", same height; figures back after the socket was started. Pass.
- Step 4: the Mac's window: its own usage in its right dock, and njv-cachyos's
  five windows with an njv-cachyos-default space shown. Pass.
- Step 5: the right dock on njv-cachyos shows the block under git. Pass.
- Step 6: the old `usage` terminals (t6 here, t16 on the Mac) were ended; none came
  back with the new dock-follow loaded (checked minutes later; an app restart was
  not done). Pass, with that note.
- Tests: `./run-tests.sh` here 224 pass / 0 fail; `npm test` on the Mac 223 / 0
  (the live case ran against the Mac's service); `tools/test-windows.sh` 220 / 0
  after fixing the mod-shadowing test's Windows path (pre-existing, 4d1d68e).

## Risks & Assumptions

- **Assumes** curl on every Linux and macOS machine the dock follows (it is in
  the base system of both) and the service set up there (hayami's installer on
  Linux; `hayami-tui api-service install` on macOS until fynstall#75).
- **Assumes** herdr-core's `exec(…, { on })` runs `/bin/sh` on the remote with
  at least `PATH=/usr/bin:/bin`; checked locally with `env -i`.
- **Windows**: an ssh sign-in starts no `hayami-api` instance, so a Windows
  machine reached only through herdr over ssh shows "service not running" unless
  someone is signed in at its console (hayami `docs/api.md`). Expected, not a
  fault.
- **Cost**: one short process per read per machine (curl), every 30 s while the
  window is visible; the old strip was a TUI process kept running permanently.
- **Rollback**: put the `usage-dock` block back in the layout and revert the
  dock-follow commit; the strip comes back on the next app start. The client
  and the mod are additive.

## E2E Test Plan

Environment: the default app home on njv-cachyos and on njv-mbp-m1, after
`./install.sh` and the layout edit.

1. njv-cachyos window, a local terminal focused: the block under nav and git
   shows the accounts `hayami-tui api get readings?sections=usage` lists, same
   percentages. (AC: real window njv-cachyos)
2. Focus a terminal in an njv-mbp-m1 space: the header names that machine and
   the figures change to its usage or its "not running" line within a read.
   Focus back. (AC: follows remote)
3. `systemctl --user stop hayami-api.socket hayami-api.service` here: the block
   says the service is not running, same height; start the socket again: it
   comes back on the next read. (R6)
4. The same from the Mac's window. (AC: njv-mbp-m1)
5. Move the dock to the right; the block is under git. (AC: dock-right)
6. Reboot-equivalent: quit and start the app; no `usage` terminal appears in
   `hc terminal list`. (AC: dock-follow)

### Prod visibility

Not applicable: a personal desktop mod with no production deployment.

## Threat model delta

hayami's B5 ("what it does outside itself") and B6 ("what it shows") are the
service's side and unchanged: the service already answers only its own account
and serves no secrets. On this side, hayami-js runs a fixed command through
`exec` with no caller-supplied text in the shell string (R2), and draws only
what the service returns (cleaned and bounded by the contract).
