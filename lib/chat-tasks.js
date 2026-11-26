// Background work in a Claude Code session, as its log records it (spec 009):
// launches, the task notifications that end them, and a subagent's progress from
// its own log. Pure: no herdr imports.

/**
 * A tool result that only says background work started: { kind: "agent", task }
 * for a background subagent, { kind: "shell", task, output } for a background
 * script (output: the file its output goes to). Null for anything else.
 */
export function launchOf(name, result) {
  const text = String(result ?? "");
  if (name === "Agent" || name === "Task") {
    const m = /^Async agent launched successfully[\s\S]*?\bagentId:\s*([\w-]+)/.exec(text);
    return m ? { kind: "agent", task: m[1] } : null;
  }
  // Started in the background, or moved there while it ran ("… (ID: b8x) so that …").
  const m = /^Command (?:running in background with ID:\s*|was moved to the background \(ID:\s*)([\w-]+)/.exec(text);
  if (!m) return null;
  const out = /Output is being written to:\s*(\S+?)\.?(?:\s|$)/.exec(text);
  return { kind: "shell", task: m[1], output: out?.[1] ?? null };
}

/**
 * The task a successful TaskStop (or the older KillShell) call stopped, or null.
 * No notification follows such a stop.
 */
export function stoppedBy(name, input, result, error) {
  if (error || (name !== "TaskStop" && name !== "KillShell")) return null;
  const id = input?.task_id ?? input?.shell_id ?? null;
  return id && /Successfully (?:stopped|killed)/.test(String(result ?? "")) ? id : null;
}

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', "#39": "'", apos: "'" };
const unescape = (s) => s.replace(/&(lt|gt|amp|quot|#39|apos);/g, (_m, k) => ENTITIES[k]);

/**
 * A `<task-notification>` message: { task, toolUseId, outputFile, status, summary,
 * note, result }, missing parts null; the result unescaped. Null when `text` isn't one.
 */
export function parseNotification(text) {
  const s = String(text ?? "").trim();
  if (!s.startsWith("<task-notification>")) return null;
  const tag = (name) => {
    const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(s);
    return m ? m[1].trim() : null;
  };
  const result = tag("result");
  return {
    task: tag("task-id"), toolUseId: tag("tool-use-id"), outputFile: tag("output-file"),
    status: tag("status"), summary: tag("summary"), note: tag("note"),
    result: result == null ? null : unescape(result),
  };
}

/** Whether a notification's status means the task is over. */
export const ended = (status) => ["completed", "failed", "killed", "stopped", "error"].includes(status);

/**
 * What a subagent has done so far, from its log's lines (JSON text or objects):
 * { tools, last: { name, summary } | null }. `summarize(input)` words a tool call
 * as the chat's own rows do.
 */
export function subagentProgress(lines, summarize = () => "") {
  let tools = 0, last = null;
  for (const l of lines ?? []) {
    let d = l;
    if (typeof l === "string") { try { d = JSON.parse(l); } catch { continue; } }
    if (d?.type !== "assistant") continue;
    for (const b of d.message?.content ?? []) {
      if (b?.type !== "tool_use") continue;
      tools += 1;
      last = { name: b.name, summary: summarize(b.input) };
    }
  }
  return { tools, last };
}

/** The last `n` lines of `text`, trailing blank lines dropped. */
export function lastLines(text, n) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.slice(-n);
}

/** How long something has run: "8s", "3m", "1h 5m". */
export function elapsed(ms) {
  const s = Math.max(0, Math.floor((ms ?? 0) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
