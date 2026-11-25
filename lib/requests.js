// Agent requests (spec 005 R1-R5): what bin/herdr-request writes and the inbox reader
// in dock-follow accepts. Pure: no herdr imports.

export const ACTIONS = new Set(["open", "edit", "external", "diff", "nav", "reveal", "worktree", "follow"]);
export const STALE_MS = 60000;
// Actions that need no path.
const PATHLESS = new Set(["follow"]);

const absolute = (p) => typeof p === "string" && (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p));

/**
 * Validates one request file's text.
 * @returns { ok: true, req } | { ok: false, error, stale? }
 */
export function parseRequest(text, now = Date.now()) {
  let r;
  try { r = JSON.parse(text); } catch { return { ok: false, error: "not JSON" }; }
  if (!r || typeof r !== "object" || r.v !== 1) return { ok: false, error: "unknown request version" };
  if (!ACTIONS.has(r.action)) return { ok: false, error: `unknown action: ${String(r.action)}` };
  const at = Date.parse(r.at);
  if (!Number.isFinite(at)) return { ok: false, error: "no time" };
  if (now - at > STALE_MS) return { ok: false, error: "stale", stale: true };
  if (!PATHLESS.has(r.action) && !absolute(r.path)) return { ok: false, error: "path must be absolute" };
  if (r.action === "diff" && !absolute(r.repo)) return { ok: false, error: "diff needs the repository" };
  const req = {
    id: String(r.id ?? ""),
    action: r.action,
    path: r.path ?? null,
    line: Number.isInteger(r.line) && r.line > 0 ? r.line : null,
    repo: r.repo ?? null,
    staged: r.staged === true,
    terminal: typeof r.terminal === "string" && r.terminal ? r.terminal : null,
    at,
  };
  return { ok: true, req };
}

/** The herdr-core session a socket path belongs to (…/herdr-core/<session>/…); "default" otherwise. */
export function sessionFromSocket(path) {
  const m = /[\\/]herdr-core[\\/]([^\\/]+)[\\/]/.exec(String(path ?? ""));
  return m ? m[1] : "default";
}

/** A requesting terminal's address as this window knows it: "<machine>/<id>" for another machine. */
export function terminalAddress(machine, terminal) {
  if (!terminal) return null;
  return machine && !terminal.includes("/") ? `${machine}/${terminal}` : terminal;
}

/** Splits the claim script's output (requests separated by U+001E) into texts. */
export function splitClaimed(stdout) {
  return String(stdout ?? "").split("\x1e").map((s) => s.trim()).filter(Boolean);
}
