// The JSON side of the chat's Claude Code bridge (ushi-naruse sdk.js), for the
// Windows form of it (spec 014): PowerShell only starts `claude -p`, writes what
// controlInput() made, and prints the raw lines it saw; the answers and the session
// titles are worked out here, as the POSIX form's Python does. Pure.

/** What goes to `claude -p --input-format stream-json`: one control request a line. */
export function controlInput(requests) {
  return requests.map((request, i) => JSON.stringify({ type: "control_request", request_id: `r${i}`, request })).join("\n") + "\n";
}

/**
 * { out, commands } from the lines Claude printed: `out[i]` the answer to request i
 * (an { error } when it failed or never came), `commands` the newest command list it
 * announced (null when none), as the Python form returns them.
 */
export function controlAnswers(text, n, fallback = "no answer") {
  const out = Array(n).fill(null);
  let commands = null;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d?.type === "system" && d.subtype === "commands_changed") commands = d.commands ?? commands;
    if (d?.type !== "control_response") continue;
    const r = d.response ?? {};
    const i = Number(String(r.request_id ?? "r-1").slice(1));
    if (Number.isInteger(i) && i >= 0 && i < n) out[i] = r.subtype === "success" ? r.response : { error: r.error ?? "failed" };
  }
  return { out: out.map((x) => x ?? { error: fallback }), commands };
}

/** Claude Code's project folder name for a working folder: anything not a letter, digit or - becomes -. */
export const projectFolder = (cwd) => String(cwd ?? "").replace(/[^A-Za-z0-9-]/g, "-");

/**
 * A session's title from its log's candidate lines (those naming aiTitle or
 * customTitle, and its first user lines): the custom or AI title, else the first
 * user message that isn't meta or a tag. Its first line, at most 120 characters, or null.
 */
export function sessionTitle(lines) {
  let title = null, first = null;
  for (const line of lines) {
    let x;
    try { x = JSON.parse(line); } catch { continue; }
    title = x.customTitle || x.aiTitle || title;
    const c = x.message?.content;
    if (first === null && x.type === "user" && !x.isMeta && typeof c === "string" && !c.startsWith("<")) first = c;
  }
  const t = title || first;
  return t ? t.trim().split("\n")[0].slice(0, 120) : null;
}

/**
 * The sessions list from the Windows script's output: a record per log, "\x1e<id>\t<ms>"
 * then its candidate lines; newest first, those with a title: [{ id, title, at }].
 */
export function parseSessions(text) {
  const out = [];
  for (const rec of String(text ?? "").split("\x1e").slice(1)) {
    const [head, ...lines] = rec.split(/\r?\n/);
    const [id, at] = head.split("\t");
    const title = sessionTitle(lines);
    if (id && title) out.push({ id, title, at: Number(at) || 0 });
  }
  return out.sort((a, b) => b.at - a.at);
}
