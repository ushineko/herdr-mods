# 021 — chat as a nested tab

**Issue**: #54

## Status: COMPLETE

## Context

A pane's nested tabs (nested-tabs, `stack.js`) are terminals shown one at a
time in the pane: the pane's own terminal plus its children labelled
`nt.stack`, switched with `terminal.show`. A chat (ushi-naruse, spec 008) is a
mod pane. The app can switch which terminal a pane shows but can't show a mod
there in place of a terminal, so a chat can't be one of a pane's nested tabs.

Today, Open as chat on a pane that holds nested tabs opens the chat in a split
beside the pane (spec 008 R8): hiding the agent's terminal would have taken the
pane, and its nested tabs, with it. Since #53 a stack is found by parentage,
not by pane id, so a pane can be hidden and come back with its stack intact.

That allows an emulation (operator, 2026-11-27: "emulate nested tabs from chat,
by adding the tab to the cc terminal side, and having custom logic to switch
back to the cc terminal nested tab, and back to the chat"):

- **The chat's tab** (C): the chat stands where the pane was, as after any
  Open as chat.
- **The partner tab** (P): the chat's existing hidden (settled) tab, holding
  the agent's pane with its whole stack.
- **One strip** on both sides lists the chat, the agent's terminal and the
  other nested terminals. Picking an entry selects C or P (`tab.select`), and
  on P shows that terminal in the pane (`terminal.show`). Both tabs stay open,
  so a switch is one command: no pane moves, and the chat isn't closed and
  reopened.

Moving the pane in and out of C instead was ruled out: the app can neither
hide nor move a mod pane, so the chat would have to close and reopen on every
switch, and moving a terminal pane (park and relabel) takes about a second and
flashes.

## Decisions (operator approved, 2026-11-27)

- D1 **Open as chat hides the whole pane**, nested tabs and all, as it does
  for a single terminal. The "opens beside" rule of spec 008 R8 for panes with
  nested tabs goes.
- D2 **The strip's entries**, the same on both sides: first one split chip for
  the agent, the chat on its left and the agent's own terminal (a terminal
  icon, with its status dot) on its right, the shown half marked; then the
  other nested terminals in the stack's order. The split chip isn't dragged
  and nothing is dropped into it, and the move keys leave the agent's terminal
  where it is, so the chat and its terminal stay together (operator,
  2026-11-27, after trying two separate chips: "it will look confusing").
- D3 **Switching**: picking the chat selects C and focuses the chat. Picking a
  terminal selects P, shows that terminal in the pane, and focuses it. The
  nested-tabs next/previous keys step through the same list, crossing between
  C and P.
- D4 **The chat lets the person reach P.** Its `keepAway()` sends the person
  back to the chat whenever P is shown, which keeps notifications and the
  agents list on the chat. A switch the strip makes is marked (shared
  `nested-tabs.chat-side`: the chat's tab and when), and `keepAway()` leaves P
  shown while the mark stands. Leaving P clears the mark, so arriving at P any
  other way still lands on the chat.
- D5 **The tab bar shows the pair as one tab**, in C's place and with C's
  name, lit when either side is shown. Clicking it shows the side shown last.
  P stays out of the bar, Ctrl+Tab and Ctrl+Space as now.
- D6 **The chat's Show terminal** switches to P with the agent's terminal
  shown (D3), instead of moving the pane beside the chat, for every chat,
  with or without nested tabs (operator, Q1: yes).
- D7 **Closing**: the × on a nested terminal closes it as now. The chat entry
  has no ×: closing the chat is the chat's own Back to terminal or closing
  its tab, which work as in spec 008 (R8, R9, R12): P becomes a normal tab
  again with its stack.
- D8 **Other panes in C** (for example a viewer split beside the chat) aren't
  seen while P is shown; P holds only the stack. This is accepted for now.

- D9 **New nested tab from the chat side** (operator, 2026-11-27: otherwise
  there's no way to it but switching to the terminal first): the strip's **+**
  on C adds a nested terminal to the agent's pane in P and switches to it, as
  the + does on P; right-click it to start an agent, as on P. A chat whose
  pane had no nested tabs gets its first this way.
- D10 **Chats opened before this change** beside a stack (spec 008's old rule)
  are left as they are (operator, Q2); D1 applies to chats opened from now on.

- D11 **Moving tabs** (operator, 2026-11-27): the palette's Tab: move left /
  right move the tab the bar draws, so a chat's tab when its partner is shown,
  and pass exactly one visible tab, never just a hidden one (a chat's partner
  or any settled tab). Dragging in the bar already moves the drawn tab.

### Limits (operator, 2026-11-27)

- L1 **One level of nesting**, as before: a stack is a pane's own terminal and
  its nested terminals; a nested terminal has no pane and holds no tabs.
- L2 **One chat per stack**: only the pane's own agent becomes the strip's
  chat entry. A Claude Code or Codex terminal in a nested tab can be started
  from the + menu as now ("New … tab"); its cow opens its chat beside the
  pane, as today, not as a second entry. Several chat entries per strip would
  be a later spec.
- L3 **"New … chat" in the + menu** opens the chat in a tab of its own (spec
  008 R4), not as an entry in this strip.

## Requirements

- R1 nested-tabs, Open as chat (`paneButtons`, `command("open-chat")`,
  `chat.js openExisting`): `hide: true` whenever the shown terminal is the
  pane's own (D1); a nested agent's chat opens beside the pane (L2).
- R2 A pure helper in `lib/` gives a strip's entries from the stack, the
  chat and which side is shown: `[{ kind: "chat" | "terminal", address,
  shown }]` (D2), and the step for next/previous (D3). nested-tabs draws the
  strip from it in the stack pane's header (on P) and in the chat's folded
  header (on C, the row #41 draws).
- R3 Picking an entry (click, keys) runs D3's commands and sets or clears
  `nested-tabs.chat-side` (D4). `stack.js`'s shown tab is the stack's, so P
  shows the last-picked terminal when reached again.
- R4 ushi-naruse `keepAway()` honours `nested-tabs.chat-side` (D4); the fork
  note says so, as for its other herdr-mods changes.
- R5 terminals-bar-proc draws C and P as one tab (D5): P is left out even
  while shown, and C is lit when P is shown. Closing that tab closes C as now
  (`keep.js`), which ends the pair (D7).
- R5a terminals-bar-proc's palette entries run its own move-left / move-right
  (D11): `lib/chat-stack.js moveIndex` gives the position past the next
  visible tab, and the bar sends `tab.move {id, index}`.
- R6 ushi-naruse Show terminal (D6) selects P through the same path as R3,
  for every chat.
- R6a The strip on C carries the + of D9 (click: `S.add` on the pane in P,
  then D3's switch; right-click: the "new" menu, its agents started the same
  way).
- R7 Both windows: C, P and the strip work the same in the njv-cachyos window
  for a Mac pane and in the Mac window for a njv-cachyos pane (the chat's
  `ushi.id`, the stack by parentage).

## Acceptance Criteria

- [x] AC1 Unit: the strip's entries for a chat with no nested terminals, with
      two, and with the agent's terminal shown; next/previous stepping across
      C and P and wrapping; reordering leaves the chat first.
      Done: `tests/chat-stack.test.js` (pairs, entries, stepping); `tests/quick-find.test.js` (the partner tab left out of Ctrl+Space).
- [x] AC2 `herdr-app check` passes for nested-tabs, ushi-naruse and
      terminals-bar-proc; `npm test` and `./run-tests.sh` pass.
      Done 2026-11-27: `npm test` 351 tests, 0 failed (Mac); `./run-tests.sh` 351, 0 failed (njv-cachyos); `herdr-app check` passed for the three mods and spaces-bar on both.
- [x] AC3 Real window (Mac): Claude Code with one zsh nested tab, Open as
      chat: the chat stands in the pane's place with a strip of chat, Claude
      Code, zsh; the tab bar shows one tab (shot).
      Done by command 2026-11-27 (Mac, shot): the strip read Claude Code chat, 1 Claude Code (no ×), 2 zsh, +; one tab in the bar.
- [x] AC4b Real window: with the terminal side shown, Tab: move left / right
      move the chat's tab one visible place, past hidden tabs (D11). Unit:
      `moveIndex` skips settled and partner tabs and wraps.
      Done: unit test; the operator, 2026-11-27: "works".
- [x] AC4 Real window: picking zsh shows P with zsh in the pane and the same
      strip, with the bar's tab still lit; picking the chat comes back to it
      with its scroll position kept; Claude Code shows the agent's terminal
      (shots). The next/previous keys go round the same list.
      By command 2026-11-27 (Mac, shots): keys went chat → Claude Code → zsh →
      chat; on P the bar showed one lit tab. Picking with the pointer and a
      chat's scroll position: the operator, 2026-11-27: "works".
- [x] AC4a Real window: on a chat with no nested tabs, the + on C adds a
      shell and shows it on P with a strip of chat, Claude Code, zsh (shot);
      Show terminal on a chat shows P with the agent's terminal (D6).
      Done by command 2026-11-27 (Mac, shots): Show terminal showed P with Claude Code; + on C added a zsh and showed it on P, strip chat, Claude Code, zsh.
- [x] AC5 Real window: with the chat shown, a notification or the agents list
      for that agent shows the chat, not P (D4).
      Done by command 2026-11-27: `agent.focus` on the agent from another tab landed on the chat's tab.
- [x] AC6 Real window: closing the chat (Back to terminal) leaves the pane
      with its stack in a normal tab; closing the pair from the tab bar
      keeps the agent running as spec 008 R12 says.
      Done by command 2026-11-27: Back to terminal put the pane, with Claude Code and two zsh tabs, in the chat's place; closing the chat's tab left the agent and both shells running in P, a normal tab again.
- [x] AC7 Real window (njv-cachyos): AC3 and AC4 for a Mac pane seen from the
      njv-cachyos window (R7).
      Done by command 2026-11-27 (njv-cachyos window, shots): the Mac chat showed the same strip; next showed P with Claude Code.
- [x] AC8 Windows: unit tests through `tools/test-windows.sh`;
      `herdr-app check` on win11-kvm for the three mods. Real-window checks
      there are optional and, if skipped, stated.
      Done 2026-11-27: on win11-kvm `node --test tests/*.test.js` 238 counted, 0 failed (31 files, the same as the Mac; this Node counts fewer), `herdr-app check` passed for the four mods. No real-window check on Windows.

## Risks & Assumptions

- Found in testing: the app unsettles a settled tab while it's shown (the chat
  settles it again once left), and shows the pane's own terminal when the tab
  comes back. So the bar, Ctrl+Tab and Ctrl+Space leave P out by the pair, not
  the flag (`chatPairs`), and nested-tabs reapplies the shown terminal when the
  focused pane shows another (`focused().shown`).
- Two quick switches could race `keepAway()`'s redirect; the mark (D4) is set
  before the `tab.select`.
- The chat's folded header is drawn by nested-tabs from what ushi-naruse
  publishes (`ushi-naruse.heads`, #41); adding the strip there may need more
  room than the row has, and then the strip scrolls as other strips do.
- Rollback: revert the commit and reinstall nested-tabs, ushi-naruse and
  terminals-bar-proc. Chats then open beside a stack again; nothing stored
  needs undoing (the mark is per window and short-lived).

## E2E Test Plan

On the Mac window, a scratch tab in a local space: `tab.new` with Claude
Code, `nested-tabs.add`, `nested-tabs.prev`, `nested-tabs.open-chat`, then
the strip's picks by command and by click, each read back from `herdr-app
shot` and the tab list (`herdr-app ls`, settled flags). The same from the
njv-cachyos window for a Mac pane. The scratch tab is closed afterwards and
its terminals checked ended.

### Prod visibility

Not applicable: a personal desktop mod.
