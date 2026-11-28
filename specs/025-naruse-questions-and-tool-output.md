# 025 — naruse: questions and prompts as written, edits as diffs, output in colour

**Issue**: #58

## Status: INCOMPLETE

## Context

ushi-naruse reads a question Claude Code asks (its question tool, a permission
prompt) off the agent's terminal screen (`prompt.js` `parsePrompt`), and
`reflow` trims each line and joins them into paragraphs. Anything laid out in
lines comes out as one run of text:

- an ASCII diagram in a question or an option's preview;
- a permission prompt's command block (a `rm` Claude Code can't verify shows
  the command, its description and a warning in separate indented lines);
- a box's right-hand edge (`│`) left in the text.

Tool results are kept as plain text (`parse.js` `toolResult`, ANSI stripped)
and drawn monospace (`main.js` `tool`); an edit shows nothing of its change.

What the session log has (checked 2026-11-27 in a Claude Code log):

- the pending tool call, as an assistant `tool_use`, before the question is
  answered: `AskUserQuestion`'s `questions[]` (`question`, `header`,
  `multiSelect`, `options[]` with `label`, `description`, `preview`), and for
  a permission prompt the tool's input (`Bash` `command`, `description`;
  `Edit` `file_path`, `old_string`, `new_string`; `Write` `file_path`,
  `content`);
- an edit's result as `toolUseResult` on the user line: `filePath`,
  `structuredPatch` (hunks: `oldStart`, `oldLines`, `newStart`, `newLines`,
  `lines` prefixed " ", "-", "+"), `originalFile`;
- a command's result as `toolUseResult` `stdout`, `stderr`, `interrupted`.
  No log holds a colour code: commands run without a terminal.

## Decisions (operator, 2026-11-27)

- **D1. From the log.** A question or permission prompt is drawn from the
  pending tool call in the log; the screen gives only the choices (their
  labels as the terminal numbers them) and which is selected, as now. With no
  matching tool call (folder trust, Codex, a prompt the log doesn't explain)
  the screen is read as before.
- **D2. Edits as diffs.** Edit (and MultiEdit) results draw their logged patch;
  Write draws its file's first lines.
- **D3. Output recoloured.** Without colours in the log, output is coloured by
  what it is: diff-shaped output as a diff, stderr and an error result marked.
- **D4. Mermaid rule.** Diagrams as Mermaid, never ASCII: added to the global
  CLAUDE.md on both machines (done 2026-11-27).

## Requirements

- **R1. Pending call.** `parse.js` keeps the last tool call that has no
  result yet (`pending`: name, input, id). A question or permission prompt
  on screen is matched to it: an `AskUserQuestion` call to a question form, a
  `Bash`/`Edit`/`Write`/other call to a permission prompt.
- **R2. Questions.** Each question's text is drawn as Markdown with its line
  breaks kept (a Mermaid block renders as in replies); the options are the
  call's labels with their descriptions; an option's `preview` is drawn
  monospace as written, for the option the screen has selected. The screen's
  selection, tabs and ticks drive the choice, as now.
- **R3. Permission prompts.** The tool's name, then its input as written: a
  command in a code block with its description under it; an edit as its diff
  (R4, from `old_string`/`new_string`); a write as its file and first lines;
  any other tool as its input's fields. The screen's own warning line (the
  text between the command and the question, e.g. why it can't be verified) is
  kept as a note, its lines as they are. Choices from the screen.
- **R4. Diffs.** An Edit/MultiEdit result draws its `structuredPatch`: the
  file name, then each hunk's lines with old/new line numbers, removed lines
  on a red tint, added on a green tint, context dim; long hunks clipped like
  other output (30 lines, "… N more"). Without a patch (an older log), a diff
  of `old_string` and `new_string`.
- **R5. Colour.** Bash output that is a diff (lines starting `diff --git`,
  `@@`, `+++`, `---`) is drawn as R4 draws one; stderr (when the result keeps
  it apart) and an error result on the error colour; otherwise as now.
- **R6. Fallback reading.** The screen reading keeps laid-out lines (box
  drawing, runs of spaces inside a line, lines deeper than the paragraph) as a
  monospace block instead of joining them, and drops a box's right edge.
- **R7. Codex** keeps its current behaviour (its log is read separately); R4
  applies where its log has a patch, otherwise unchanged.
- **R8.** Cross-platform: nothing platform-specific; pure parts in `lib/` with
  unit tests.

## Acceptance criteria

- [ ] AC1: a question whose text holds an ASCII diagram and a Mermaid block
  draws both as written (the Mermaid one rendered); its options show their
  descriptions; a preview shows monospace for the selected option (R2).
- [ ] AC2: a permission prompt for `rm -rf <dir>` (a command Claude Code
  can't verify) shows the command in a code block, its description and the
  warning, each on its own lines; choosing an option answers it (R3).
- [ ] AC3: an Edit's row expands to a red/green diff with line numbers; a
  Write's to its first lines (R4).
- [ ] AC4: `git diff` run through Bash draws as a diff; a failing command's
  output is on the error colour (R5).
- [ ] AC5: a folder-trust prompt and a Codex question still work from the
  screen, and a question read from the screen keeps laid-out lines (R6, R7).
- [ ] AC6: unit tests for the pending-call matching, the patch and diff
  drawing data, the diff detection and the fallback reflow; `npm test`,
  `./run-tests.sh`, `tools/test-windows.sh` pass; `herdr-app check` passes.

## E2E

On the Mac and njv-cachyos: ask Claude (in a chat) a question with a diagram
and previews; run a command it must ask about (`rm -rf` on a scratch folder);
make an edit; run `git diff` and a failing command. Look at each with
`herdr-app shot`.
