# 009 — background subagents and scripts in the chat

**Issue**: #25

## Status: COMPLETE

## Executive Summary

In the ushi-naruse chat (spec 008), work Claude Code runs in the background looks
finished the moment it starts, and its end never shows. Background subagents and
scripts get a running state that lasts until Claude Code reports them done, a strip
above the message box lists what still runs, and rows show live progress: a
subagent's tool count and current step, a script's latest output.

## Context

What the session log holds (Claude Code, 2026-11-25):

- A background launch is an ordinary tool call whose result comes at once:
  `Agent` → "Async agent launched successfully … agentId: <id> …";
  `Bash` with `run_in_background` → "Command running in background with ID: <id>.
  Output is being written to: <file>. …". The chat shows these as finished, and the
  launch text (internal instructions to Claude) when expanded.
- The end is a message Claude Code adds itself: `type: "user"` with
  `origin.kind: "task-notification"` (or a `queued_command` attachment, when it
  arrives mid-turn), its text a `<task-notification>` holding `task-id`,
  `tool-use-id`, `output-file` (not always), `status` (`completed`, `failed`,
  `killed`, `stopped`), `summary`, an optional `note`, and for agents `result` (HTML
  entities escaped). An agent can notify more than once (interim, then final). The
  chat drops every tag-wrapped message, so none of this shows.
- Each subagent, foreground or background, keeps its own log beside the session's:
  `<session>/subagents/agent-<id>.jsonl` (its lines are `isSidechain`), with
  `agent-<id>.meta.json` naming `toolUseId`, `description` and `finished`.
- A script's output goes to its `output-file`, on the agent's machine.

Codex is out of scope (its background terminals have no such log records); its
chats are unchanged.

## Requirements

- R1 **Background launches stay running.** A tool call whose result is a background
  launch (agent or script) is shown running, with a "background" mark, until a task
  notification with its tool-use id arrives; then it shows the status (completed,
  failed, killed, stopped), the summary, and the agent's result (unescaped) as its
  output. A later notification for the same task replaces the earlier one. The
  launch text is not shown. A background row's spinner does not depend on the
  agent's terminal being busy (the agent is often idle while the work runs).
- R2 **Notifications are not chat messages.** Task notifications never show as user
  messages (as now); they only update their rows. One without a known tool-use id
  is ignored.
- R3 **Background strip.** While any background task runs, a strip above the message
  box lists them: kind icon, description, time since it started (from the log's
  timestamps). Clicking one scrolls to its row and opens it. With more than three,
  it shows three and "+N more". The strip goes away when none runs, and while the
  agent's terminal has ended (nothing will report them).
- R4 **Subagent progress.** A running subagent's row (foreground or background)
  shows its tool count and its latest step (tool and summary, as the chat's own tool
  rows say it), read from its log, found by the meta file's `toolUseId`. Updated at
  least every 2 s while it runs; reading stops when it ends.
- R5 **Script output.** A background script's row, while it runs and after, shows
  the last lines of its output file when opened (at most 30, as tool output is
  clipped now), and its last non-blank line beside the summary while it runs. Read
  on the agent's machine (remote spaces included), at most every 2 s, only for
  running scripts and opened rows.
- R8 **Stop from the chat.** A running background row's right-click menu offers
  Stop (a group with several: "Stop N background tasks"), and each strip entry has a
  ×. Stop sends Claude a message naming the task id and asking it to stop it with
  TaskStop; the row says "stopping…" until it ends ("Stopped by Claude"). Sent once
  per task; works whether Claude is busy (it reads it at its next step) or idle.
- R6 The pure parts (recognising launches, parsing notifications, a subagent log's
  progress) live in `lib/` with unit tests; the chat only reads files and draws.
- R7 Cross-platform as the rest of the chat: file reads through the same `exec`
  paths it already uses for the session log, on macOS and Linux; Windows untested
  (the chat needs python3 and `sh`, as spec 008 records).

## Acceptance Criteria

- [x] R1: a background subagent's row shows running with "background" until its
  notification, then completed with its result; a background script's likewise,
  with its exit code in the summary; no launch text shown. (Real window on the Mac;
  `parse.js` `toolResult`/`notify`; the session log replayed through the parser.)
- [x] R1: a stopped or killed task shows that status. (Killed from `/tasks` after
  42 s, and stopped by TaskStop: "stopped · 7s" seen.)
- [x] R2: no `<task-notification>` text appears as a message, nor in the queued
  list (`parse.js` `claude()`/`queued()`).
- [x] R3: the strip lists running tasks with elapsed time; a click scrolls to and
  opens the row; it goes away when they finish. (Real window; the click confirmed by
  the operator.)
- [x] R4: a running subagent's row shows its tool count and latest step, changing
  as it works. (Screenshot: "4 tool uses · Read …/lib/edit-open.js".)
- [x] R5: an opened background script row shows its latest output while it runs.
  ("step 10 of 12" beside the summary; opened row's ticks updating, confirmed by the
  operator.)
- [x] R8: Stop from a row's menu and from the strip's × ends the task; the row
  shows "stopping…", then stopped. (Confirmed by the operator; the chat's message
  reached Claude and TaskStop ended task b2yjcxzwi.)
- [x] R6: unit tests for the lib helpers pass on macOS, Linux and Windows
  (`tests/chat-tasks.test.js`, `tests/chat-text.test.js`).
- [x] `herdr-app check` passes; `herdr-app status` shows no errors (both machines).

## E2E (real window)

In a chat, ask Claude to start a background subagent and a background script (e.g.
`sleep 20; echo done`), then watch the rows and the strip until both finish; stop
one with the terminal's `/tasks` to see the stopped/killed state.

## Threat model delta

Reads two more kinds of file the session already wrote (subagent logs, task output
files), on the agent's machine, through argument lists (no shell strings with
untrusted text). Output is shown as text, never run.
