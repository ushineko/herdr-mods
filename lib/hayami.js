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

// One meter per account (#28), as hayami's own panel draws it (hayami
// internal/view/usage.go, Usage and leading): the bar is the window that can stop
// work soonest, and the account's other windows are figures beside it.

const spanOf = (w) => (typeof w?.span_s === "number" && w.span_s > 0 ? w.span_s : 0);

/**
 * The window an account's meter shows: its shortest window (one with no span sorts
 * last), except that once a window with a span is full and the account has a
 * "limit", the limit is what is being spent, so the limit.
 */
export function leadWindow(windows) {
  const ws = windows ?? [];
  if (!ws.length) return null;
  if (ws.some((w) => spanOf(w) > 0 && w.pct >= 100)) {
    const limit = ws.find((w) => w.name === "limit");
    if (limit) return limit;
  }
  let lead = ws[0];
  for (const w of ws.slice(1)) {
    const a = spanOf(w), b = spanOf(lead);
    if (a && (!b || a < b)) lead = w;
  }
  return lead;
}

/** Days until `iso`, hayami's way: rounded up, "<1d" under a day, "" once passed. */
export function daysLeft(iso, now = Date.now()) {
  const ms = Date.parse(iso ?? "") - now;
  if (!(ms > 0)) return "";
  const day = 86400000;
  return ms < day ? "<1d" : `${Math.ceil(ms / day)}d`;
}

/**
 * The account's other windows as one line of figures, in their order: a window's
 * amounts where it has them ("320.11 / 1200.00 (27%)"), else its name and share
 * ("7d 47%"), and its days left when it resets at another time than the lead.
 */
export function otherFigures(windows, lead, now = Date.now()) {
  return (windows ?? []).filter((w) => w !== lead).map((w) => {
    const pct = `${Math.round(w.pct)}%`;
    let out = w.used && w.limit ? `${w.used} / ${w.limit} (${pct})` : `${w.name} ${pct}`;
    const left = w.resets_at && w.resets_at !== lead?.resets_at ? daysLeft(w.resets_at, now) : "";
    if (left) out += ` (${left})`;
    return out;
  }).join("  ");
}

/** The text after the meter: the lead window's note ("$419.02 / $1200.00") or the time to its reset. */
export function windowTail(w, now = Date.now()) {
  return w?.note ?? (w?.resets_at ? `↻ ${until(w.resets_at, now)}` : "");
}

// ---- Every section (spec 011) ---------------------------------------------------

/** The sections in hayami's order, and their titles. */
export const ORDER = ["usage", "bandwidth", "cooler", "peripherals", "clock"];
export const TITLES = { usage: "Usage", bandwidth: "Bandwidth", cooler: "Cooler", peripherals: "Peripherals", clock: "Clock" };

// How often each section is read, in seconds (operator, spec 011): usage at its own
// interval (pollEvery), the clock once a minute (it ticks locally between).
const CADENCE_S = { bandwidth: 5, cooler: 5, peripherals: 15, clock: 60 };

/** The shown sections, valid and in order; usage alone when nothing valid is given. */
export function shownSections(value) {
  const want = Array.isArray(value) ? value : [];
  const out = ORDER.filter((k) => want.includes(k));
  return out.length ? out : ["usage"];
}

/** The shown sections due a read at `now`, given when each was last read (ms). */
export function due(shown, last, now, usageInterval = null) {
  return shownSections(shown).filter((k) => {
    const every = k === "usage" ? pollEvery(usageInterval) : CADENCE_S[k] * 1000;
    return now - (last?.[k] ?? 0) >= every - 250; // a 1 s timer lands a little early
  });
}

/** "columns" when every shown section gets at least 250 px of `width`, else "stack". */
export function arrange(width, n) {
  return n > 1 && width > 0 && width / n >= 250 ? "columns" : "stack";
}

// Heights (px, unzoomed): the block's padding and header, a section's title, a line.
const PAD = 12, HEADER = 22, TITLE = 20, LINE = 20, GAP = 2, SECTION_GAP = 8;
// Side by side the block shares the bottom dock with nav and git; stacked, it is in
// the right dock, which has height to spare.
export const MAX_HEIGHT = { columns: 320, stack: 640 };

/** The block's height for sections of `lines` lines each, arranged so; capped. */
export function blockHeight(lines, arrangement) {
  const one = (n) => TITLE + Math.max(1, n) * (LINE + GAP);
  const body = arrangement === "columns"
    ? Math.max(0, ...lines.map(one))
    : lines.reduce((s, n) => s + one(n), 0) + Math.max(0, lines.length - 1) * SECTION_GAP;
  return Math.min(MAX_HEIGHT[arrangement] ?? MAX_HEIGHT.stack, Math.ceil(PAD + HEADER + body));
}

// hayami's units (internal/view/format.go): binary, at most five characters a number.
const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];
const fixed = (v, i) => (i === 0 ? v.toFixed(0) : v.toFixed(1));

/** Bytes as "1.2 GiB"; "--" when not known. */
export function size(bytes) {
  if (num(bytes) === null) return "--";
  let v = Math.max(0, bytes), i = 0;
  while (i < UNITS.length - 1 && (v >= 1024 || fixed(v, i).length > 5)) { v /= 1024; i++; }
  return `${fixed(v, i)} ${UNITS[i]}`;
}

/**
 * Bytes a second as "  1.2 MiB/s", the number padded to five characters and the
 * unit to five with its "/s", as hayami pads them, so a changing rate never moves what follows
 * (glance rule); "   -- " until a rate exists (it needs two readings).
 */
export function rate(bps) {
  if (num(bps) === null) return `${"--".padStart(5)}      `;
  const [n, u] = size(bps).split(" ");
  return `${n.padStart(5)} ${`${u}/s`.padEnd(5)}`;
}

// hayami's bands (internal/view/bands.go). A status: good, warn, bad, info, accent, strong.
const MiB = 1 << 20;
/** A share of a quota, in percent: amber from 50, red past 80. */
export const quotaStatus = (pct) => (pct > 80 ? "bad" : pct >= 50 ? "warn" : "good");
/** A draining battery, in percent: red at 20 and below, amber to 50. */
export const batteryStatus = (pct) => (pct <= 20 ? "bad" : pct <= 50 ? "warn" : "good");
/** A coolant temperature, °C: the pump's own alarm, 50 and 55. */
export const coolantStatus = (c) => (c >= 55 ? "bad" : c >= 50 ? "warn" : "good");
/** A rate's emphasis, bytes a second: 1, 10 and 100 MiB/s. */
export const rateStatus = (bps) => (!(bps >= MiB) ? "info" : bps >= 100 * MiB ? "strong" : bps >= 10 * MiB ? "warn" : "accent");

/** How long ago `iso` was, from `now`: "5m", "3h", "2d"; "" when unknown. */
export function ago(iso, now = Date.now()) {
  const ms = now - Date.parse(iso ?? "");
  if (Number.isNaN(ms)) return "";
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// A line of a section: { label, parts: [{ text, status }], dim }.
const part = (text, status = "info") => ({ text, status });

/** A bandwidth Section as lines: each interface present, then each VPN. */
export function bandwidthRows(section) {
  const b = section?.reading?.bandwidth ?? null;
  const ifs = list(b?.interfaces).filter((i) => i?.present !== false).map((i) => ({
    label: str(i?.name) ?? "",
    parts: [part(`↓ ${rate(i?.rx_bps)}`, rateStatus(i?.rx_bps)), part(`↑ ${rate(i?.tx_bps)}`, rateStatus(i?.tx_bps))],
    dim: false,
  }));
  const vpns = list(b?.vpns).map((v) => {
    const state = str(v?.state) ?? "unknown";
    const lat = num(v?.latency_ms);
    const status = v?.failing ? "bad" : state === "up" ? "good" : state === "connecting" ? "warn" : "info";
    return {
      label: str(v?.label) ?? str(v?.name) ?? "VPN",
      parts: [part(v?.failing ? `${state}, failing` : state, status), ...(state === "up" && lat !== null ? [part(`${Math.round(lat)} ms`)] : [])],
      dim: state === "down" || Boolean(v?.stale),
    };
  });
  return [...ifs, ...vpns];
}

const COOLER_LABEL = { cpu: "CPU", gpu: "GPU", memory: "Memory", io: "IO", coolant: "Coolant", fan: "Fan", pump: "Pump" };

/** A cooler Section as lines, a probe each, as hayami's cooler rows say it. */
export function coolerRows(section) {
  const seen = {};
  return list(section?.reading?.cooler?.probes).map((p) => {
    const role = str(p?.role) ?? "other";
    seen[role] = (seen[role] ?? 0) + 1;
    const base = COOLER_LABEL[role] ?? (str(p?.name) ?? role);
    const label = seen[role] > 1 ? `${base} ${seen[role]}` : base;
    const t = num(p?.temp_c), load = num(p?.load_pct), rpm = num(p?.rpm);
    const parts = [];
    if (role === "cpu" || role === "gpu") {
      // Not coloured: a hot processor is normal (hayami's rule).
      parts.push(part(t === null ? "--°" : `${Math.round(t)}°`), part(load === null ? "--%" : `${Math.round(load)}%`));
    } else if (role === "memory") {
      parts.push(part(load === null ? "--%" : `${Math.round(load)}%`), part(`${size(p?.bytes)} / ${size(p?.of_bytes)}`));
    } else if (role === "io") {
      parts.push(part(`R ${rate(p?.read_bps)}`, rateStatus(p?.read_bps)), part(`W ${rate(p?.write_bps)}`, rateStatus(p?.write_bps)));
    } else if (role === "coolant") {
      parts.push(t === null ? part("--°") : part(`${t.toFixed(1)}°`, coolantStatus(t)));
    } else if (role === "fan" || role === "pump") {
      parts.push(part(rpm === null ? "-- rpm" : `${Math.round(rpm)} rpm`));
    } else {
      if (t !== null) parts.push(part(`${Math.round(t)}°`));
      if (load !== null) parts.push(part(`${Math.round(load)}%`));
      if (rpm !== null) parts.push(part(`${Math.round(rpm)} rpm`));
    }
    return { label, parts, dim: Boolean(p?.stale) };
  });
}

/** A peripherals Section as lines, a device each. */
export function peripheralRows(section, now = Date.now()) {
  return list(section?.reading?.peripherals?.devices).map((d) => {
    const pct = num(d?.battery_pct), band = num(d?.band), segs = num(d?.segments);
    const parts = [];
    if (pct !== null) parts.push(part(`${Math.round(pct)}%`, d?.charge === "draining" ? batteryStatus(pct) : "good"));
    else if (band !== null && segs !== null) parts.push(part(`${band}/${segs}`, band >= 3 ? "good" : band >= 2 ? "warn" : "bad"));
    else parts.push(part("--%"));
    if (d?.charge === "charging") parts.push(part("charging", "accent"));
    else if (d?.charge === "charged") parts.push(part("charged", "good"));
    const stale = Boolean(d?.stale);
    if (stale && d?.last_seen) parts.push(part(`seen ${ago(d.last_seen, now)} ago`));
    return { label: str(d?.name) ?? "", parts, dim: stale };
  });
}

/** A clock Section as one line: the machine's time now (HH:MM) from its UTC offset, and its zone. */
export function clockRow(section, now = Date.now()) {
  const c = section?.reading?.clock ?? null;
  const off = num(c?.utc_offset_s);
  if (off === null) return { label: str(c?.zone) ?? "", parts: [part("--:--")], dim: true };
  const t = new Date(now + off * 1000);
  const hm = `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
  const day = t.toISOString().slice(0, 10);
  return { label: str(c?.zone) ?? "", parts: [part(hm, "strong"), part(day)], dim: false };
}
