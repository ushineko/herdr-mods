# 002 — nav, a folder panel that follows

**Issue**: #2

## Status: INCOMPLETE

## Executive Summary

A `nav` mod for the dock: it shows the folder the focused terminal is in (on
whichever machine), with a light saying whether it is following, and can be
browsed by mouse and keyboard on its own. Files open in `viewer` (001). It
does no file operations. It replaces yazi in the dock (004).

## Context

The dock's yazi runs in a terminal per machine and is moved by `dock-follow`
with `ya emit-to <id> cd`. That works, but a terminal can only show what yazi
draws, needs one terminal per machine, and loses its place on a restart. The
shipped `files` mod already follows the focused pane (including remote panes)
and marks git status; it is the starting point for the reading code
(`location()`, `directory()`, the status scan), not for the view.

## Requirements

### Where it is

- R1 **Follows the focused terminal**: its folder (`pane.cwd`, or the shown
  terminal's cwd for a layout terminal block) and machine, as `files` reads
  them. A focus change, a tab switch and a `cd` move it within a second.
  Focus moving to a mod block (nav itself, git, a viewer tab) does not.
- R2 **The follow light**: a dot in the header, accent and lit while
  following, hollow while not. Browsing (opening a folder, a breadcrumb, `h`)
  turns following off. Clicking the light, or `F`, turns it on and jumps to
  the focused terminal's folder.
- R3 **Header**: the machine pill (this computer's name, or the herdr machine
  name), the breadcrumb of the current folder relative to home (`~ › git ›
  herdr-mods`), each segment clickable, and when in a repository the branch as
  a chip with a dirty dot.

### What it shows

- R4 **The folder's entries**, folders first, then files, case-insensitive by
  name, hidden ones (dotfiles) off by default (`.` toggles, remembered per
  copy). `.git` never shown. Each row: icon by type (folder, Markdown, code,
  image, other; from `lib/filetype.js`), name, git mark (M/A/D/U/?) as a
  coloured letter, and for folders a dim count of changed files under them.
- R5 **Limits**: 500 entries per folder; more says so in a footer.
- R6 **Live**: local folders are watched (`watchFolder`); remote folders
  re-listed every 5 s while shown. Git marks come from one `git status
  --porcelain=v1 -z` per repository, shared with `git` (003) through the same
  `globalThis` scan map the shipped mods use, so two panels never run two scans.
- R7 **Empty, missing, unreadable** folders and "not a folder" say so in place
  of the list.

### Acting

- R8 **Mouse**: click a folder to enter it; click a file to open it in
  `viewer`; the row under the pointer is highlighted. Right-click does nothing
  (no file operations).
- R9 **Keyboard** (mod focusable; `pane.go` gives it the keyboard):
  `j`/`k` and arrows move, `l`/Enter open, `h`/Backspace go to the parent,
  `g`/`G` top/bottom, `.` hidden files, `F` follow, `/` filters the list by
  substring (Esc clears), `y` copies the selected path to the clipboard,
  `o` opens the selected item with the system opener (`open`/`xdg-open`; local
  only).
- R10 **Selection survives refreshes**: a re-list keeps the selected name if it
  still exists.

### Look

- R11 Rows 26 px, rounded hover, selection in `theme().selected`; marks in the
  ansi colours the shipped `files` uses; the follow light pulses once
  (`.transition`) when it re-locks.

## Acceptance Criteria

- [ ] `node --test tests/`: breadcrumb from (home, cwd) on Linux and macOS
      paths; entry sorting and hidden filtering; porcelain parsing into marks
      and per-folder change counts; key map → action names.
- [ ] `herdr-app check` passes for `nav`.
- [ ] Real window (Mac): focusing two terminals in different folders moves nav
      between them; `cd` in a terminal moves it; clicking into a folder turns
      the light off and stops following; clicking the light re-locks.
- [ ] Real window: a remote space (njv-cachyos) shows that machine's folder and
      git marks.
- [ ] Real window: keyboard walk — focus nav, `j j l` enters a folder, `h`
      leaves, `/` filters, Enter on a file opens a viewer tab.
- [ ] Real window: a file created from a terminal appears within 2 s with an
      `?` mark.

## Threat model delta

No new boundary. Listing uses an argument vector (`sh -c <fixed script> nav
<path>`), as the shipped `files` does; `o` passes the path as one argument.

## Risks & Assumptions

- "Focus moving to a mod block does not move nav" relies on `focused()`
  keeping the last terminal's pane; checked in the real window first. If it
  does not, nav remembers the last terminal location itself.
- Clipboard: if there is no clipboard API for mods, `y` is dropped (no shell
  workaround through `pbcopy`/`wl-copy` without asking).

## E2E Test Plan

Open nav as a split pane (`pane.split {mod: "nav"}`) before 004 puts it in
the dock. Walk R1–R10 on the Mac with a local and a remote space; screenshot
each state.
