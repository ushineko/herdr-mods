// Parse `git diff --no-color` output for one file into rows the viewer draws.
// Pure: no herdr imports.

/**
 * @returns {{ rows: Array<{ kind: "meta"|"hunk"|"add"|"del"|"ctx"|"note", text: string, old: number|null, new: number|null }>, added: number, removed: number }}
 */
export function parseDiff(text) {
  const rows = [];
  let added = 0, removed = 0, oldNo = 0, newNo = 0, inHunk = false;
  const lines = String(text ?? "").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: line, old: null, new: null });
    } else if (!inHunk) {
      rows.push({ kind: "meta", text: line, old: null, new: null });
    } else if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), old: null, new: newNo++ });
      added++;
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", text: line.slice(1), old: oldNo++, new: null });
      removed++;
    } else if (line.startsWith("\\")) {
      rows.push({ kind: "note", text: line, old: null, new: null });
    } else {
      rows.push({ kind: "ctx", text: line.slice(1), old: oldNo++, new: newNo++ });
    }
  }
  return { rows, added, removed };
}

/** An untracked file shown as a diff against nothing: every line added. */
export function untrackedDiff(text) {
  const body = String(text ?? "");
  const lines = body.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return {
    rows: [
      { kind: "hunk", text: `@@ -0,0 +1,${lines.length} @@ (untracked)`, old: null, new: null },
      ...lines.map((l, i) => ({ kind: "add", text: l, old: null, new: i + 1 })),
    ],
    added: lines.length,
    removed: 0,
  };
}
