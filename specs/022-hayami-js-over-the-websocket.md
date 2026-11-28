# 022 — hayami-js over the service's WebSocket

**Issue**: #55

## Status: COMPLETE

## Executive Summary

On this computer the hayami block follows its sections over hayami's
WebSocket on its loopback port: one connection, readings pushed, no process
per read, behind the mutual challenge-response, with the token never sent and
an impostor refused. Without the port, or for another machine, it reads with
commands as before, and retries the WebSocket with a doubling wait. Review
`openWS` in `lib/hayami.js` and `ensureWS` in `mods/hayami/main.js`.

## Context

The hayami block (`mods/hayami`, specs 010 and 011) reads the service through
`lib/hayami.js` by running one command per read on the machine that serves it:
curl over the Unix socket on Linux and macOS, `hayami-tui api get` on
Windows. With bandwidth or cooler shown that is a process every 5 s per
window.

hayami 0.24.0 (hayami specs 115 and 116) also serves the readings on a loopback
TCP port, `127.0.0.1:47930` unless moved, as a WebSocket, `/v1/ws`, that pushes
each reading as it is made. A mod can open it: spec 010's Transport note found
that loopback TCP works from a mod and the Unix socket does not. Every account
on a machine can reach a loopback port, so the connection begins with a mutual
challenge-response over a token in hayami's `api-tcp.json`, readable by the
account alone; the token never crosses the connection, and a client that
checks the service's proof refuses a program that took the port first. hayami's
`docs/api.md`, "The WebSocket", is the protocol.

## Probe findings (the app, 2026-11-27)

| Question | Found |
|---|---|
| `TextEncoder`, `process` | Neither exists; the strings involved are ASCII |
| SHA-256 | `crypto.createHash("sha256").update(bytes).digest()` gives the bytes; "abc" matches the standard vector |
| HMAC-SHA256 | Not provided; built from SHA-256 per RFC 2104, it matches RFC 4231's case 2 |
| Random bytes | `crypto.randomBytes(32)` |
| base64 | `Buffer.from(bytes).toString("base64")` and back |
| The key file | `fs.readFile(home() + "/.config/hayami/api-tcp.json", "utf8")`; `home()` is herdr's |
| The port | `WebSocket.connect("ws://127.0.0.1:47930/v1/ws")`; challenge, auth, hello with its proof verified, subscribe, a section, all in the app against hayami 0.24.0 |

## Requirements

- R1 On this computer, the block follows its shown sections over the
  WebSocket: one connection per window, the shown sections subscribed, and
  each reading drawn as it arrives. No command runs per read while it holds.
- R2 The key is read from hayami's settings directory for the platform:
  `~/.config/hayami` (Linux), `~/Library/Application Support/hayami`
  (macOS), `~/AppData/Roaming/hayami` (Windows), `api-tcp.json`. A key whose
  address is not `127.0.0.1` and a port, or whose token is not 32 bytes in
  base64url, is not used.
- R3 The client answers the challenge as hayami's contract has it: its own
  32-byte nonce, its proof (HMAC-SHA256 keyed with the token over
  `hayami-client`, the service's nonce, its own), and checks hello's proof
  (`hayami-server`, its nonce, the service's) before it draws anything. A
  proof that does not match is not the service: the connection is closed,
  nothing it sent is drawn, and the block falls back (R5). The token is
  never sent.
- R4 Choosing other sections resubscribes on the same connection.
- R5 Without a key, without a port, with a refused or failed handshake, or
  when the connection ends, the block reads as it does today (spec 011's
  commands) and tries the WebSocket again after 30 s, then 60, 120, up to
  10 minutes; a successful connection resets the wait.
- R6 Another machine is read as today: the port is that machine's loopback,
  which this computer cannot reach. Following another machine closes the
  connection.
- R7 `lib/hayami.js` stays pure: no `herdr` or `gpui-kit` import. SHA-256,
  random bytes, reading a file and opening a WebSocket are passed in, so
  node's tests use node's own.

## Acceptance Criteria

Test strategy: the pure pieces against node's own crypto; the handshake's
logic against a scripted peer for the cases a real service cannot be made to
give (an impostor's proof); and the real downstream system, hayami's service,
through its real port in an integration test.

- [x] Unit: HMAC-SHA256 built on a SHA-256 function equals node's
      `createHmac` over random keys and messages, and RFC 4231's vectors
      (R3).
- [x] Unit: base64url both ways; the key path for each platform; a key with
      another address, a bad port or a short token is refused (R2).
- [x] Unit: the handshake sends a proof that is node's HMAC over the
      challenge and never the token; a hello whose proof is wrong, missing or
      a client's is refused as an impostor; a 4401 close is reported as
      refused (R3). Falsified: skipping hello's proof check fails it.
- [x] Integration (real downstream): against the running hayami service's
      TCP port with the desk's key, node opens the WebSocket through the
      library, the hello proof checks, a subscribed section arrives, and a
      wrong token is refused; skipped when there is no key (R1, R3).
- [x] The app (the desk, the default window on a local space): the block
      holds a WebSocket and, by its own record, makes no read by command for
      20 s; with the port removed it reads by command, successfully; with the
      port back its WebSocket returns within 20 s and reads by command stop
      (R1, R5). (Changed in reconciliation from "over a minute, by `ps`": a
      read by command lives a few milliseconds and process sampling missed
      them, so the block's own record of each read was the measure.)
- [x] The app: showing another section keeps the same connection (R4); the
      copies following the Mac's space hold no WebSocket (R6).
- [x] `herdr-app check mods/hayami`; `./run-tests.sh` (346 pass).

## Results (2026-11-27)

- A dead service is noticed: when hayami's service restarted, Herdr's read
  failed with "Connection reset without closing handshake", and the block
  fell back at once. A session that goes silent for three of its slowest
  section's intervals (at least 90 s) is also dropped.
- A mod reload (any save, or `install.sh`) stops the old build's tasks but
  leaves its WebSocket open, and a new build cannot reach the old build's
  objects: tried with a registry on `globalThis`, which each build gets
  afresh. The leftover connection stays until the app restarts or hayami's
  token is replaced (`hayami-tui api-service tcp --new-token` ended it).
  hayami #424 proposes the service closing a client that sends nothing.
- The work window, whose home links the default home's mods, does not
  hot-reload them (as `install.sh` says): it runs what it loaded at its last
  start until it is restarted.

## Risks & Assumptions

- **Assumes** hayami 0.24.0 or later with the port set up; an older hayami
  is read with commands, as before.
- A key file the account can read is what any program of the account can
  read; the mod holds the token in memory only while it connects.
- **A reload leaves a connection open** (Results): harmless but wasteful
  until the app restarts; hayami #424.
- **Rollback**: revert; the block reads with commands, as before.

## E2E Test Plan

- The desk: the block in the bottom dock shows bandwidth and cooler; `ps`
  over a minute shows no curl or hayami-tui started for it; the readings
  move at the service's cadence (R1).
- The desk: `hayami-tui api-service tcp --remove`, then the block keeps
  showing readings (curl); `hayami-tui api-service tcp` again, and within the
  retry wait it is back on the WebSocket (R5).

### Prod visibility

Not applicable: a desktop mod with no telemetry.
