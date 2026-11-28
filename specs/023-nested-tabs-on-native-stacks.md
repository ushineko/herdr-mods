# 023 — nested tabs on native stacks

**Issue**: #56

## Status: INCOMPLETE

## Context

The operator's fork of the desktop app (`ushineko/herdr-app`, branch
`ushineko/nested-tabs`, its spec 001) has native nested tabs: a stack is a
`Stack` node in a tab's tree, its members are panes (terminals or mods), each
window keeps its own shown member, and mods see it all in `panes()`:
`stack: { id, index, shown }` on every member, null outside a stack. Commands:
`pane.stack`, `pane.show`, `pane.move_in_stack`, `pane.unstack`,
`terminal.keep { place: "stack" }`. The strip stays a mod: this spec moves
herdr-mods onto it.

Today nested-tabs emulates nested tabs with child terminals labelled
`nt.stack` and `terminal.show`, and spec 021 fakes a chat member with a
hidden partner tab. On a fork window both give way to native stacks. The Mac
runs the released app until it gets the fork, so both kinds have to work for
a while.

## Decisions (operator, 2026-11-27)

- D1 **Both modes.** nested-tabs uses native stacks where the app has them
  (its `panes()` entries carry a `stack` key, null or not) and today's
  label-based nested tabs where it doesn't. The Mac gets the fork soon after.
  Until then, a stack made natively on njv-cachyos shows in the Mac window as
  its active member only, with no strip.
- D2 **Conversion clears the labels.** On a fork window, a label-based stack
  is converted to a native one when its header first draws it: each nested
  terminal joins the pane's stack (`terminal.keep { place: "stack" }`) and
  loses `nt.stack`, so a released window doesn't also draw a label strip whose
  picks would focus a hidden member there.
- D3 **The split chip stays.** In native mode a chat and its agent's
  terminal are two members, kept next to each other, first, and drawn as the
  split chip (chat | >_) of spec 021. Spec 021's hidden partner tab is not used
  in native mode.

## Requirements

### H1: the strip on native stacks

- R1 Native mode when the pane's `panes()` entry has a `stack` key. The
  header of the shown member draws the strip from the members of its stack
  (`panes()` by `stack.id`, in `stack.index` order); a pane in no stack draws
  the plain header, as now.
- R2 Picking a chip runs `pane.show { pane }`; its × runs `pane.close`;
  dragging runs `pane.move_in_stack`; next/previous keys step through the
  members with `pane.show`. The shown chip is marked as now (tint, top bar,
  machine colour).
- R3 **+** runs `pane.stack { pane }` (a shell in the shown member's folder);
  its right-click menu's agent entries start the agent in a new member the
  same way the label-based + does (a shell, then the agent's command typed).
- R4 Status dots, titles, folders and the chips' look are as today.

### H2: conversion (D2)

- R5 A fork window's header that finds `nt.stack` children of its pane's own
  terminal converts them once: the stand-in goes (`terminal.show { pane }`),
  each child joins the stack in order (`terminal.keep { place: "stack",
  pane, focus: false }`) and loses `nt.stack`, then the member that was shown
  is shown again (`pane.show`).

### H3: the chat as a member (D3)

- R6 Open as chat (the cow, `nested-tabs.open-chat`) on a fork window adds
  the chat as a member (`pane.stack { pane, mod: "ushi-naruse", props }`),
  first, with the agent's terminal right after it, and shows the chat. The
  agent's labels name the chat as now (`ushi.chat`, `ushi.id`), with no
  `chat.tab`.
- R7 The split chip draws the chat and its agent's member as one chip; its
  halves run `pane.show` for the chat and the agent's terminal.
- R8 ushi-naruse's Hide terminal and Show terminal show the chat or the
  agent's member (`pane.show`) instead of moving the terminal to a partner
  tab; Back to terminal closes the chat member.
- R9 The tab bar's pair logic and the switchers' partner filter (spec 021)
  stay for released windows; native stacks never make a pair.

## Acceptance Criteria

- [x] AC1 Unit: picking native members from a `panes()` list (by stack id,
      in index order; the shown one; the chat and its agent grouped first).
      Done: `tests/native-stack.test.js` (members in order, shown, stepping, chat and agent grouped).
- [x] AC2 Sandbox (fork build, nested-tabs installed): a stack of three
      shells; picks, keys, + and × work; switching draws only the chosen
      member (the fork spec's AC4, flash check by the debug log). This is
      also the fork spec's AC3 (mods see `stack`).
      Done 2026-11-27 (sandbox, fork 0ddf30a with a temporary draw log): next stepped t2, t3, t1, t2, t3 with nothing drawn in between; + added a member after the shown one and showed it; closing the shown one focused its neighbour; strip drawn with the shown chip marked (shot).
- [x] AC3 Sandbox: a label-based stack made by today's nested-tabs converts
      on sight; labels cleared; the shown member kept.
      Done 2026-11-27 (sandbox): two `nt.stack` children of t1 became members, labels cleared, no errors. Made one at a time while the header was live, they converted in two batches and came out t1, t3, t2; a stack seen whole converts in one batch in order (a move by hand confirmed `pane.move_in_stack`).
- [ ] AC4 Sandbox: Open as chat on a stack's agent makes a chat member; the
      split chip switches between chat and terminal; Hide/Show terminal work;
      Back to terminal leaves the agent's terminal (the fork spec's AC5).
- [ ] AC5 Released app (Mac): label-based nested tabs and spec 021 work as
      before; `npm test` and `herdr-app check` pass on all three machines.
- [ ] AC6 Day to day on njv-cachyos with the fork (the fork spec's AC7).

## Risks & Assumptions

- Mixed windows: a natively stacked njv-cachyos space seen from the Mac
  (released) shows its active member only until the Mac runs the fork (D1).
- Rollback: install the released app; native stacks then show their active
  member (fork spec R12). Converted members can be reached from the agents
  list and made tabs with `terminal.keep`.
