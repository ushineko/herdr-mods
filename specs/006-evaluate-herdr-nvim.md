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

## Acceptance Criteria

- [ ] Source review notes (R1) in this spec.
- [ ] Built from source at a recorded commit (R2).
- [ ] Hands-on trial in an isolated home/layout (R3, R4).
- [ ] Recommendation recorded and agreed with the operator (R5).
- [ ] The trial home/layout and build artefacts removed afterwards.

## Threat model delta

Evaluation only. A Rust binary built from reviewed source runs in a throwaway
app home; nothing is installed into the person's setup.
