# 011 — hayami-js: every section, chosen in the dock

**Issue**: #29

## Status: INCOMPLETE

## Executive Summary

(Filled in before the work is closed.)

## Context

Spec 010 put a usage block under the dock's nav and git, reading hayami's service
(hayami spec 113) on the machine the dock follows through `lib/hayami.js`
(hayami-js). The service has four more sections: bandwidth, cooler, peripherals and
clock (hayami `docs/api.md`, "The sections"). The block shows usage only, and
nothing lets the person choose.

## Decisions (operator, 2026-11-26)

- **Arrangement**: sections side by side as columns when the block is wide (the
  bottom dock), one under another when it is narrow (the right dock). The block
  resizes itself to fit what it shows.
- **Choosing**: a sections button at the right of the block's header opens a
  checklist; a right-click on the block opens the same.
- **Scope**: one choice per app home, for both docks and every machine followed.
- **Cadence**: bandwidth and cooler every 5 s, peripherals every 15 s, usage at its
  interval (30 s), all in one request; the clock is read once a minute and ticks
  locally from the machine's UTC offset. Only while the window is visible.

## Requirements

- R1 **Sections**, in hayami's order: usage, bandwidth, cooler, peripherals, clock.
  Each is a titled group with its own absences (dim) and its own "not read" state.
  Drawing follows hayami's panel (`internal/view` there) in what a row says and
  how it is coloured; layout is herdr's own.
  - **Usage**: unchanged from 010 (one line and one meter per account). Its colour
    takes hayami's quota bands: amber from 50 %, red past 80 %.
  - **Bandwidth**: a line per interface present: name, ↓ and ↑ rates in binary
    units a second ("1.2 MiB/s"), coloured by hayami's rate bands (1, 10, 100
    MiB/s); "--" until a rate exists. A line per VPN: its label (else name), its
    state, latency when up; a down VPN dim, a failing one red.
  - **Cooler**: a line per probe, by role: CPU and GPU temperature and load (not
    coloured: a hot processor is normal, hayami's rule); memory share and amount
    used of total; IO read and write rates; coolant temperature by hayami's
    coolant bands (50, 55 °C); fan and pump speeds in rpm. A stale probe dim.
  - **Peripherals**: a line per device: name, battery % by hayami's battery bands
    (low 50, critical 20) or its band of segments, and its charge state (charging
    or charged marked). A stale device dim, with when it was last seen.
  - **Clock**: the machine's time (HH:MM) and zone, ticking locally from its UTC
    offset.
- R2 **Choosing** (Decisions): the header's button and a right-click open a
  checklist popup of the five sections. A change applies at once in every copy of
  the block (both docks) and is kept across restarts: `shared("hayami.sections")`.
  The default, before any choice, is usage only (spec 010's block). At least one
  section stays shown.
- R3 **Reading**: one request a read, `/v1/readings?sections=…` with only the shown
  sections that are due by R1's cadence; a hidden section is never asked for, so
  the service stops reading it. A failed read keeps each section's last good
  reading, marked stale; a change of machine drops them (as 010 R6).
- R4 **Arrangement**: columns when the block is at least 250 px a shown section
  wide, else stacked. Each column takes an equal share of the width.
- R5 **Height**: the block asks for the height its sections need: the header plus,
  in columns, the tallest section, stacked, every section; capped at 320 px
  side by side (the bottom dock, shared with nav and git) and 640 px stacked (the
  right dock, which has height to spare). It
  resizes its own layout node (`layout.resize`), and records the height in
  `shared("hayami.px")` so dock-tabs builds the node at that height when it
  rebuilds the dock (010's `panelsNode`). A height only changes when what is shown
  changes (a section, an account, a device, a VPN), never with a value (glance
  rule).
- R6 **The client** (`lib/hayami.js`) gains the pure pieces, tested with
  `node --test`: the cadence (which sections are due), the arrangement and height,
  hayami's bands and units, and a plain-rows function per section.
- R7 **Cross-platform**: as 010 (R8): Linux and macOS exercised, Windows unit-tested.

## Acceptance Criteria

- [ ] Unit: `due` gives only shown sections whose time has come, by R1's cadence.
- [ ] Unit: `arrange` and `blockHeight` give columns or stacked and the heights of
      R4/R5, capped.
- [ ] Unit: rate and size units, and the quota, battery, coolant and rate bands,
      give hayami's values at their thresholds.
- [ ] Unit: `bandwidthRows`, `coolerRows`, `peripheralRows` and `clockRow` on
      invented readings give the R1 lines, with nulls and unknown fields handled.
- [ ] Integration: the live test reads all five sections from the running service
      and each holds to what its rows function reads; skips without a service.
- [ ] `herdr-app check` passes for hayami-usage and dock-tabs; no errors in status.
- [ ] Real window (njv-cachyos): the bottom dock shows the chosen sections as
      columns; the right dock stacked; the block's height fits each; a shot of each
      is read back.
- [ ] Real window: the header button and a right-click open the checklist; a
      section shown or hidden changes both docks at once and survives an app
      restart (or a mod reload).
- [ ] Real window: an njv-mbp-m1 space shows the Mac's sections (peripherals and
      cooler as the Mac has them, or their absences).
- [ ] Bandwidth rates appear (not "--") after the second read.
- [ ] Tests pass on njv-cachyos, the Mac and Windows.

## Risks & Assumptions

- **Cost**: with bandwidth or cooler shown, one curl every 5 s per window while it
  is visible (010: every 30 s). Hidden sections cost nothing on the service.
- **Assumes** `layout.resize` on a block inside the dock's stack resizes it in
  place; checked in the real window (R5).
- **Assumes** `shared()` is per app home and persisted (herdr's `herdr.d.ts`: "every
  mod can see (persisted)").
- **Rollback**: revert the commits; `shared("hayami.sections")` left behind is
  ignored by the 010 block.

## E2E Test Plan

On njv-cachyos (both windows) and njv-mbp-m1, after install:

1. Bottom dock: choose all five; columns, heights fit, rates appear within 10 s.
   (AC real window, rates)
2. Right dock: stacked, the block taller. (AC real window)
3. Hide cooler from the right-click checklist: gone in both docks; quit and start
   the work window: still hidden. (AC choosing)
4. Focus an njv-mbp-m1 space: the Mac's sections. (AC remote)
5. `hc exec --on njv-mbp-m1 -- npm test`, `./run-tests.sh`, `tools/test-windows.sh`.

### Prod visibility

Not applicable: a personal desktop mod.

## Threat model delta

None beyond 010: the same fixed command with an allow-listed path; more section
keys from the same fixed list.
