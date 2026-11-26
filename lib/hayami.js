// hayami-js (spec 010): a client for the hayami service (hayami spec 113,
// `hayami-tui serve`), whose contract is api/openapi.yaml in the hayami repository
// and whose prose is its docs/api.md.
//
// Pure: no "herdr" or "gpui-kit" import. A mod passes in herdr's `exec`; tests pass
// a stand-in or node's own. Mods have no sockets, so each request is one command run
// on the machine that serves it (R2): curl over the Unix socket on Linux and macOS,
// `hayami-tui api get` on Windows (curl cannot open a named pipe or check its owner).
//
// The contract only grows within /v1: unknown fields are ignored, and null is
// accepted wherever the contract allows it.

/** The sections the service has, and the only text that reaches a request's path. */
export const SECTIONS = ["clock", "bandwidth", "usage", "cooler", "peripherals"];

const CURL_TIMEOUT_S = 20;
/** exec's timeout: above curl's, so curl reports its own timeout. */
export const EXEC_TIMEOUT_MS = 25000;

// The address by the contract's rule (docs/api.md, "Connecting"), then curl. The path
// arrives as $1, never inside the script, and -w puts the status on a last line of
// its own so an HTTP error is told from a transport one.
const CURL = `exec curl -sS --max-time ${CURL_TIMEOUT_S} -w '\\n%{http_code}' --unix-socket "$d/hayami/api.sock" "http://hayami$1"`;
const SCRIPT = {
  // herdr-core's exec can run with a bare environment over SSH: XDG_RUNTIME_DIR unset.
  linux: `d=\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}; ${CURL}`,
  // $TMPDIR ends in a slash on macOS; where unset, the system's answer for this account.
  macos: `d=\${TMPDIR:-$(/usr/bin/getconf DARWIN_USER_TEMP_DIR)}; d=\${d%/}; ${CURL}`,
};

/** A /v1 path, checked: only the endpoints and section keys this client knows. */
export function checkPath(path) {
  const p = String(path);
  const sec = `(?:${SECTIONS.join("|")})`;
  const ok = new RegExp(`^/v1(?:|/health|/sections|/sections/${sec}|/readings\\?sections=${sec}(?:,${sec})*)$`);
  if (!ok.test(p)) throw new Error(`hayami-js: not a path this client asks for: ${p}`);
  return p;
}

/** { command, args } that GETs `path` from the service on a machine of `platform`. */
export function request(platform, path) {
  const p = checkPath(path);
  if (platform === "windows") return { command: "hayami-tui", args: ["api", "get", p] };
  const script = SCRIPT[platform] ?? SCRIPT.linux;
  return { command: "/bin/sh", args: ["-c", script, "hayami-js", p] };
}

const isNoService = (text) =>
  /could not connect|couldn't connect|failed to connect|no such file|connection refused|cannot find the file|not recognized|not found|command not found/i.test(text);

function parseBody(text) {
  try { return { ok: true, body: JSON.parse(text) }; } catch { return { ok: false }; }
}

function httpFailure(status, body) {
  const e = body?.error;
  return { ok: false, kind: "http", status, code: e?.code ?? null, message: e?.message ?? `the service answered ${status}` };
}

/**
 * An exec result as the service's answer: { ok: true, status, body } or
 * { ok: false, kind, message } with kind no-service | http | bad-json | failed.
 */
export function parse(platform, result) {
  const { code, stdout = "", stderr = "" } = result ?? {};
  if (platform === "windows") {
    // hayami-tui prints the body (also of a non-200), and says "<path> answered <n>" on stderr.
    const answered = stderr.match(/answered (\d{3})/);
    if (code === 0 || answered) {
      const b = parseBody(stdout);
      if (!b.ok) return { ok: false, kind: "bad-json", message: "the service's answer is not JSON" };
      if (code === 0) return { ok: true, status: 200, body: b.body };
      return httpFailure(Number(answered[1]), b.body);
    }
    const msg = firstLine(stderr) || `hayami-tui exited ${code}`;
    return { ok: false, kind: isNoService(stderr) || code === 127 ? "no-service" : "failed", message: msg };
  }
  if (code !== 0) {
    // 7: could not connect (nothing listening, socket missing); 127: no curl.
    const msg = firstLine(stderr.replace(/^curl: \(\d+\)\s*/, "")) || `curl exited ${code}`;
    if (code === 127) return { ok: false, kind: "failed", message: "curl is not installed" };
    if (code === 7 || isNoService(stderr)) return { ok: false, kind: "no-service", message: msg };
    return { ok: false, kind: "failed", message: msg };
  }
  const cut = stdout.lastIndexOf("\n");
  const status = Number(stdout.slice(cut + 1));
  const b = parseBody(stdout.slice(0, Math.max(cut, 0)));
  if (!b.ok) return { ok: false, kind: "bad-json", message: `the service's answer (${status || "no status"}) is not JSON` };
  if (status !== 200) return httpFailure(status, b.body);
  return { ok: true, status, body: b.body };
}

function firstLine(s) {
  return String(s ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

/** GET `path` from the service on `on` (null: this computer). Never throws. */
export async function get(exec, platform, path, { on = null, timeout = EXEC_TIMEOUT_MS } = {}) {
  const { command, args } = request(platform, path);
  let r;
  try {
    r = await exec(command, args, { on, timeout });
  } catch (e) {
    // exec rejects when it cannot start the program (hayami-tui absent on Windows) or reach the machine.
    const msg = String(e?.message ?? e);
    return { ok: false, kind: isNoService(msg) ? "no-service" : "failed", message: firstLine(msg) };
  }
  return parse(platform, r);
}

/** Several sections at once: { ok: true, readings: { key: Section } } or a failure. */
export async function readings(exec, platform, sections, opts) {
  const r = await get(exec, platform, `/v1/readings?sections=${sections.join(",")}`, opts);
  if (!r.ok) return r;
  const map = r.body?.readings;
  if (!map || typeof map !== "object") return { ok: false, kind: "bad-json", message: "no readings in the service's answer" };
  return { ok: true, readings: map };
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" ? v : null);
const list = (v) => (Array.isArray(v) ? v : []);

/**
 * A usage Section as plain rows for drawing:
 * { interval_s, polled_at, fetched_at, error, absences: [{ text, detail, status }],
 *   accounts: [{ name, badge, windows: [{ name, pct, resets_at, span_s, used, limit, note, severity }] }] }
 */
export function usageRows(section) {
  const u = section?.reading?.usage ?? null;
  return {
    interval_s: num(section?.interval_s),
    polled_at: str(section?.polled_at),
    fetched_at: str(u?.fetched_at),
    error: str(section?.error),
    absences: list(section?.absences).map((a) => ({ text: str(a?.text) ?? "", detail: str(a?.detail), status: str(a?.status) })),
    accounts: list(u?.accounts).map((a) => ({
      name: str(a?.name) ?? "",
      badge: str(a?.plan_badge),
      windows: list(a?.windows).map((w) => ({
        name: str(w?.name) ?? "",
        pct: Math.max(0, Math.min(100, num(w?.utilisation_pct) ?? 0)),
        resets_at: str(w?.resets_at),
        span_s: num(w?.span_s),
        used: str(w?.used),
        limit: str(w?.limit),
        note: str(w?.note),
        severity: str(w?.severity),
      })),
    })),
  };
}

/** Time until `iso` from `now` (ms), as "now", "42m", "3h 05m" or "2d 4h". */
export function until(iso, now = Date.now()) {
  const t = Date.parse(iso ?? "");
  if (Number.isNaN(t)) return "";
  const ms = t - now;
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${m}m`;
}

/** How often to read, in ms: the section's interval, never under 15 s; 30 s until known. */
export function pollEvery(interval_s) {
  const s = num(interval_s) ?? 30;
  return Math.max(15, s) * 1000;
}
