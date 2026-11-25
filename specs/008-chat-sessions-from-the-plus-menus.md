# 008 — Chat sessions from the + menus

**Issue**: #12

## Status: INCOMPLETE

## Executive Summary

Right-click **+** in a pane's nested tabs or in a dock offers **New Claude chat** /
**New Codex chat** beside the existing New … tab entries. A chat is `ushi-naruse`,
this repo's fork of naruse's `chat` mod (github.com/naruse/herdr-chat), a native
chat view over a running
`claude` or `codex` terminal. From nested tabs the chat opens in a new tab, as
that tab's only pane; in a dock it is a subtab of its own. In both, the agent's
terminal runs without a pane of its own. The entries are hidden where the chat can't run.

This is a trial of capability and usability. Windows is out of scope for now
(operator, 2026-11-25).

## Context

The backlog listed native Claude/Codex chat mods (naruse/herdr-chat,
ChmaraX/herdr-chat). The operator picked naruse's (operator, 2026-11-25). It runs
on python3 and supports remote machines; ChmaraX's needs Node 20 and runs on this
computer only. Its own install swaps in a layout, keys, a tab bar, a spaces sidebar
and a pane header, all of which clash with this repo's mods, so only the chat
itself is taken.

Source review of the pinned commit (2026-11-25, `chat/*.js`, `chat-file/main.js`):
- no network access of its own, no `eval`, no package installs;
- untrusted text reaches `sh -c` only as positional arguments, never in the script;
- it writes only its data folder (`<app home>/data/chat`), except:
  - a model or effort switch backs up `~/.claude/settings.json` and puts it back
    about 2.4 s later (`models.js:54-60`);
  - the chat-file dialog saves CLAUDE.md, AGENTS.md, Claude/Codex settings, but
    only on Save;
- it answers "trust this folder" itself, only for chats its own New chat form
  started (not used here: our chats are not `started`);
- POSIX-only (sh, python3, find).

## Requirements

- R1 **Forked** (operator, 2026-11-25: first vendored unchanged, then forked for
  layout changes): `mods/ushi-naruse` and `mods/ushi-naruse-file` are naruse/herdr-chat's
  `mods/chat` and `mods/chat-file` at commit
  `05ef3eda503b8267602077888005f7b3dbd4f272` (the reviewed one), with its LICENSE (MIT)
  and a `FORK.md` naming the source and commit. `install.sh` installs them like any
  mod. Their layout, keys and other mods are not taken. Changes from upstream:
  - renamed: mod names, icon paths, the cache folder (`data/ushi-naruse`);
  - R1a the person's messages (sent, queued, side-chat questions) are on the left,
    like the replies and like Claude Code's terminal, not on the right;
  - R1b tool calls in smaller text: the folded line and each call's name 11 (was 12),
    the output 10, as plain monospace lines (was a Markdown code block, which kept its
    own larger size and could be selected; the lines can't be).
  - R1c the conversation, message box and panels fill the pane (an 18 px margin);
    upstream keeps them to a centered 900 px column, as the Claude app does.
- R1e **Parked sessions** (found on njv-cachyos, 2026-11-25): a Claude Code session
  parked as a background job is written by that job. Its terminal's session file says
  `"parkedJobId":"X"`; the job's file says `"jobId":"X"` and holds the live session id
  first (later ones, in `formerNames`, are earlier sessions). Upstream read the
  terminal's own id (no log) and the last id on the line, so Open as chat showed
  nothing while messages still reached the terminal.
- R1f **Claude's suggested next message** (operator, 2026-11-25). Claude Code draws it
  only in its own input line; it is not in the session log (checked on njv-cachyos:
  "go ahead with 3c" appears only inside the reply it came from, and only the main
  conversation's requests are logged). While a Claude agent is idle or done and the
  message box is empty, the chat reads the screen's last `❯` line (not its `Try "…"`
  hints for a new session) and shows it as a dim row at the top of the message box;
  a click or Tab in the empty box takes it. Plain text can't tell it from text typed
  into the terminal itself, so before sending, the chat empties the agent's input line
  (Ctrl+U) whenever it showed such a row: nothing is sent in front of the message.
- R1d **A cow icon** (ushi: cow; operator, 2026-11-25) marks a chat: on its tab in the
  tab bar (`terminals-bar-proc`, which also names it "chat"), in its pane header
  (`nested-tabs`) and on a dock chat subtab (`dock-tabs`). One 16 px line drawing,
  `cow.svg`, tinted like the other icons.
- R2 **Entries**: right-click **+** in nested tabs and in docks lists, after the
  New … tab entries, **New Claude Code chat** and/or **New Codex chat**.
- R3 **Hidden where it can't run**. An entry shows only when all of these hold:
  - the platform is not Windows;
  - the agent (`claude` or `codex`) is installed on the machine the session would
    run on (`knownAgents({ on })`);
  - `python3` is found there (operator, 2026-11-25: required for now. Only the side
    chat, the info cards, the resume list and image sizes use it; see BACKLOG.md).
  Otherwise the menu is as before.
- R4 **Nested tabs → a chat tab** (operator, 2026-11-25: first "pane beside"; changed
  after trying it, since the pane + was clicked in should stay out of view):
  - The agent starts in a shell with no pane and no parent, on the pane's machine,
    in the pane's live folder, labelled `hm.chat=<chat pane>`.
  - A new tab in the pane's space opens with the chat as its only pane
    (`tab.new {mod: "chat", props: {terminal}}`), named after the agent.
  - The chat's Terminal button peeks at the agent's terminal.
- R5 **Docks → a chat subtab**: the agent starts like a dock shell (a named terminal
  with no parent). The new subtab is a block holding the chat, bound to that
  terminal, in both docks. Closing the subtab ends the agent. Renaming, moving and
  per-machine filtering work as for other subtabs.
- R6 **No stray agents**: an agent started by R4 ends when its chat pane (or the
  chat's tab) is closed.
- R6a **A restart keeps chats** (tested on the Mac, 2026-11-25): the agents run in
  herdr-core, so quitting and reopening the app keeps them, and the restored chat tab
  reconnects. The sweep only ends an agent whose chat pane it has seen in this run, so
  a pane restored under a new id never ends its agent.
- R8 **Open as chat** (operator, 2026-11-25): a cow button in a pane header whose shown
  terminal runs Claude Code or Codex (where the chat can run: not Windows, python3 on
  that machine). (The terminal right-click menu in a tab pane is the app's own and
  takes no extra items, so the entry is in the header.)
  - The chat opens right of the agent's pane, in the agent's own tab, and hides the
    terminal at once (operator: the terminal is rarely needed): the chat's own
    "Hide terminal" (the terminal moves to a settled tab; "Show terminal" brings it
    back beside the chat), started by a `hide: true` prop in the fork.
  - A pane holding other nested tabs keeps its terminal shown (hiding takes the pane
    away, and those tabs with it); the chat opens beside it.
  - Closing the chat leaves the agent running. If its terminal was hidden, that
    settled tab becomes a normal tab again (`tab.unsettle`, `chat.tab` label cleared),
    with the same waiting rules as R6.
  - The tab bar (`terminals-bar-proc`) leaves settled tabs out, as the shipped one
    does, unless one is shown.
- R9 **Back to terminal** (operator, 2026-11-25: an escape hatch if the chat misbehaves,
  never losing the session): a button in the chat's header. The agent's terminal takes
  the chat's place in its tab and the chat closes; the session keeps running. The
  `hm.chat` and `chat.tab` labels come off first, so the clean-up (R6, R8) neither ends
  the agent nor shows it twice. A terminal hidden in a settled tab is parked and
  labelled into the chat's tab; a pane-less agent (R4) is labelled straight in. A dock
  chat subtab has **Back to terminal** in its right-click menu instead: the subtab
  shows the agent's terminal again.
- R10 **The chat stands for its agent** (operator, 2026-11-25). Whatever opens a chat
  labels its agent `ushi.chat=<chat pane>` (a mod pane's props don't carry its own pane
  id, checked with a probe mod, so the chat can't). With it:
  - **×** on a terminal a chat shows hides it behind the chat (a `ushi-naruse.hide`
    request the chat carries out with its own Hide terminal) instead of closing the
    pane: a session isn't killed by a stray click after Show terminal.
  - **Follow**: a focused chat pane is its agent's folder (program folder, else the
    terminal's) for nav and git (`lib/location.js`), so they follow when the chat's
    tab is shown.
  - **Agents list** (spaces-bar): such an agent is listed in the chat's tab, marked
    "· chat", and opens the chat; it was listed in its hidden settled tab (a number),
    and opening it showed that tab before the chat took it back. An agent started for
    a chat, with no pane, is listed too.
  - Back to terminal clears the label.
- R7 Pure selection logic (which entries to show for a platform, an agent list and
  a python3 check) lives in `lib/` with unit tests.

## Acceptance Criteria

- [ ] R1: LICENSE and FORK.md present; the diff against the pinned commit holds only
      the listed changes; `herdr-app check` passes for `ushi-naruse` and
      `ushi-naruse-file`.
- [x] R1d, Mac: the cow on the chat's tab and pane header (`herdr-app shot`).
- [x] R1a/R1b/R1c, Mac: a user message sits on the left; tool call lines and output are
      smaller; the conversation fills the pane (`herdr-app shot`, 2026-11-25).
- [ ] R2/R3: unit tests cover Windows (no entries), an agent not installed, no python3,
      and both agents present.
- [ ] R4, Mac: New Claude Code chat from a pane's + opens a new tab holding only the
      chat, in the pane's folder; the agent answers a prompt typed into the chat, and
      Terminal shows its terminal.
- [ ] R4, njv-cachyos: the same, and New Codex chat.
- [ ] R5: New Claude Code chat from a dock's + adds a chat subtab in both docks;
      × on it ends the agent.
- [x] R6: closing the chat's tab ends its agent (`hc get` shows it gone; Mac,
      2026-11-25, also for a chat pane).
- [x] R6a, Mac: after `app.quit` and reopening, the chat tab and its agent are back and
      connected (2026-11-25).
- [ ] R8: the cow button shows on a Claude Code pane (Mac, `herdr-app shot`: yes) and
      opens a chat in that tab with the terminal hidden (Mac, by the same `pane.split`:
      yes; the hidden tab is not in the tab bar); Show terminal brings it back;
      closing the chat shows the terminal's tab again (Mac: yes).
- [x] R1f, Mac: a line in the agent's input shows as the row; the parser reads "go ahead
      with 3c" from the hayami screen on njv-cachyos; Ctrl+U empties the line.
- [ ] R9: Back to terminal from a New chat tab, an Open as chat tab, and a dock chat
      subtab (Mac: the pane-less case's steps by hand work: the agent gets a pane in
      the chat's tab and survives the chat closing).
- [x] R10 follow, Mac: chat tab ↔ tab 1 switches nav and git between the agent's folder
      (sysadmin) and herdr-mods (2026-11-25).
- [ ] R10 × hides, agents list: in a real window.
- [ ] All unit tests pass (`npm test` on the Mac, `./run-tests.sh` on njv-cachyos).
- [ ] `herdr-app status` shows no errors on both machines.

## E2E (real window)

- `herdr-app shot` after each R4/R5 step: chat pane or subtab present, the reply
  rendered.

## Not tested

- Windows: not a target for this trial. The chat is POSIX-only; R3 hides the entries
  there.

## Rollback

Revert the commit. Remove `mods/ushi-naruse`, `mods/ushi-naruse-file` and
`data/ushi-naruse` from the app homes. Dock chat subtabs are dropped the next time the dock's subtabs are rewritten.
