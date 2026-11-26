import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform as osPlatform, userInfo } from "node:os";
import { join } from "node:path";
import { request, checkPath, parse, get, readings, usageRows, until, pollEvery, windowTail, leadWindow, otherFigures, daysLeft,
  ORDER, shownSections, due, arrange, blockHeight, MAX_HEIGHT, size, rate, quotaStatus, batteryStatus, coolantStatus, rateStatus,
  ago, bandwidthRows, coolerRows, peripheralRows, clockRow,
} from "../lib/hayami.js";

// An invented usage section, in the contract's shape (hayami api/openapi.yaml, Section).
const SECTION = {
  key: "usage",
  polled_at: "2026-01-02T03:04:05Z",
  interval_s: 30,
  reading: {
    clock: null, bandwidth: null, cooler: null, peripherals: null,
    usage: {
      fetched_at: "2026-01-02T03:00:00Z",
      accounts: [
        { name: "Acme pro", plan_badge: "P", windows: [
          { name: "5h", utilisation_pct: 42, resets_at: "2026-01-02T05:00:00Z", span_s: 18000, used: null, limit: null, severity: null, note: null, extra: 1 },
        ] },
        { name: "Acme team", plan_badge: null, windows: [
          { name: "spend", utilisation_pct: 135, resets_at: null, span_s: null, used: "$12.00", limit: "$10.00", severity: "high", note: "$12.00 / $10.00" },
        ] },
      ],
    },
  },
  absences: [{ code: null, label: "Usage", text: "stale", detail: "read 17m ago", status: "info", actionable: false }],
  error: null,
  details: [],
  truncated: false,
  future_field: true,
};
const body = (b, status = 200) => `${JSON.stringify(b)}\n${status}`;

test("request: curl over the Unix socket on Linux, the path as an argument", () => {
  const r = request("linux", "/v1/readings?sections=usage");
  assert.equal(r.command, "/bin/sh");
  assert.equal(r.args[0], "-c");
  assert.match(r.args[1], /XDG_RUNTIME_DIR:-\/run\/user\/\$\(id -u\)/);
  assert.match(r.args[1], /curl .*--unix-socket "\$d\/hayami\/api\.sock" "http:\/\/hayami\$1"/);
  assert.doesNotMatch(r.args[1], /readings/, "the path never enters the script");
  assert.deepEqual(r.args.slice(2), ["hayami-js", "/v1/readings?sections=usage"]);
});

test("request: macOS takes $TMPDIR, else getconf, without its trailing slash", () => {
  const s = request("macos", "/v1/health").args[1];
  assert.match(s, /TMPDIR:-\$\(\/usr\/bin\/getconf DARWIN_USER_TEMP_DIR\)/);
  assert.match(s, /d=\$\{d%\/\}/);
});

test("request: Windows asks hayami-tui", () => {
  assert.deepEqual(request("windows", "/v1/sections/usage"), { command: "hayami-tui", args: ["api", "get", "/v1/sections/usage"] });
});

test("checkPath: only known endpoints and section keys", () => {
  for (const ok of ["/v1", "/v1/health", "/v1/sections", "/v1/sections/usage", "/v1/readings?sections=usage,cooler"]) assert.equal(checkPath(ok), ok);
  for (const bad of ["/v1/sections/usage;rm -rf ~", "/v1/readings?sections=usage&x=1", "/v1/sections/$(id)", "/v2", "v1/health", "/v1/events?sections=usage"]) {
    assert.throws(() => checkPath(bad), /not a path/, bad);
  }
});

test("parse: a 200 is its body", () => {
  const r = parse("linux", { code: 0, stdout: body({ readings: { usage: SECTION } }), stderr: "" });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.body.readings.usage.key, "usage");
});

test("parse: a 404 carries the contract's error code and message", () => {
  const r = parse("linux", { code: 0, stdout: body({ error: { code: "not_found", message: "no section \"x\"", known: ["usage"] } }, 404), stderr: "" });
  assert.deepEqual(r, { ok: false, kind: "http", status: 404, code: "not_found", message: "no section \"x\"" });
});

test("parse: nothing listening or no socket is no-service", () => {
  const r = parse("linux", { code: 7, stdout: "\n000", stderr: "curl: (7) Failed to connect to hayami:80 over unix:///run/user/1000/hayami/api.sock after 0 ms: Could not connect to server\n" });
  assert.equal(r.kind, "no-service");
  assert.match(r.message, /^Failed to connect/);
});

test("parse: no curl is a failure that says so", () => {
  assert.deepEqual(parse("macos", { code: 127, stdout: "", stderr: "sh: curl: command not found" }), { ok: false, kind: "failed", message: "curl is not installed" });
  assert.deepEqual(parse("linux", { code: 127, stdout: "", stderr: "" }), { ok: false, kind: "failed", message: "curl is not installed" });
});

test("parse: an answer that is not JSON is bad-json", () => {
  assert.equal(parse("linux", { code: 0, stdout: "<html>\n200", stderr: "" }).kind, "bad-json");
});

test("parse: Windows, hayami-tui's body, its non-200 and its dial failure", () => {
  assert.equal(parse("windows", { code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }).body.ok, true);
  const nf = parse("windows", { code: 1, stdout: JSON.stringify({ error: { code: "busy", message: "over a limit", known: [] } }), stderr: "hayami-tui: /v1/health answered 503\n" });
  assert.deepEqual(nf, { ok: false, kind: "http", status: 503, code: "busy", message: "over a limit" });
  const ns = parse("windows", { code: 1, stdout: "", stderr: "hayami-tui: asking for /v1/health: open \\\\.\\pipe\\hayami-api-S-1-5-21-1: The system cannot find the file specified.\n" });
  assert.equal(ns.kind, "no-service");
});

test("get: a program that cannot start is no-service, and it never throws", async () => {
  const exec = async () => { throw new Error("hayami-tui: not found"); };
  const r = await get(exec, "windows", "/v1/health");
  assert.equal(r.ok, false);
  assert.equal(r.kind, "no-service");
});

test("readings: the map of sections, asked on the given machine", async () => {
  let seen;
  const exec = async (command, args, opts) => { seen = { command, args, opts }; return { code: 0, stdout: body({ readings: { usage: SECTION } }), stderr: "" }; };
  const r = await readings(exec, "linux", ["usage"], { on: "box-default" });
  assert.equal(r.ok, true);
  assert.equal(r.readings.usage.interval_s, 30);
  assert.equal(seen.opts.on, "box-default");
  assert.equal(seen.args.at(-1), "/v1/readings?sections=usage");
});

test("usageRows: span and spend windows, a null badge, absences; unknown fields ignored", () => {
  const u = usageRows(SECTION);
  assert.equal(u.interval_s, 30);
  assert.equal(u.fetched_at, "2026-01-02T03:00:00Z");
  assert.deepEqual(u.absences, [{ text: "stale", detail: "read 17m ago", status: "info" }]);
  assert.equal(u.accounts.length, 2);
  assert.deepEqual(u.accounts[0], { name: "Acme pro", badge: "P", windows: [
    { name: "5h", pct: 42, resets_at: "2026-01-02T05:00:00Z", span_s: 18000, used: null, limit: null, note: null, severity: null },
  ] });
  const spend = u.accounts[1];
  assert.equal(spend.badge, null);
  assert.equal(spend.windows[0].pct, 100, "a share over 100 is drawn full");
  assert.equal(spend.windows[0].note, "$12.00 / $10.00");
});

test("usageRows: a section before its first reading, or a failed one", () => {
  const u = usageRows({ key: "usage", polled_at: null, interval_s: 30, reading: { usage: null }, absences: [], error: "provider unreachable", details: [] });
  assert.deepEqual(u.accounts, []);
  assert.equal(u.error, "provider unreachable");
  assert.deepEqual(usageRows(null).accounts, []);
});

test("until and pollEvery", () => {
  const now = Date.parse("2026-01-02T03:00:00Z");
  assert.equal(until("2026-01-02T02:00:00Z", now), "now");
  assert.equal(until("2026-01-02T03:42:10Z", now), "42m");
  assert.equal(until("2026-01-02T06:05:00Z", now), "3h 05m");
  assert.equal(until("2026-01-04T07:00:00Z", now), "2d 4h");
  assert.equal(until(null, now), "");
  assert.equal(pollEvery(30), 30000);
  assert.equal(pollEvery(1), 15000);
  assert.equal(pollEvery(null), 30000);
});

test("windowTail: the lead window's note, else the time to its reset", () => {
  const now = Date.parse("2026-01-02T03:00:00Z");
  assert.equal(windowTail({ resets_at: "2026-01-02T06:05:00Z", note: null }, now), "↻ 3h 05m");
  assert.equal(windowTail({ resets_at: "2026-02-01T00:00:00Z", note: "$12.00 / $10.00" }, now), "$12.00 / $10.00");
  assert.equal(windowTail({}, now), "");
});

// An invented Codex-like account: five hours, a week and a limit.
const win = (name, pct, span_s, resets_at, used = null, limit = null) => ({ name, pct, span_s, resets_at, used, limit, note: used ? `${used} / ${limit}` : null, severity: null });
const H5 = win("5h", 10, 18000, "2026-01-02T05:00:00Z");
const D7 = win("7d", 47, 604800, "2026-01-06T12:00:00Z");
const LIM = win("limit", 27, null, "2026-02-01T00:00:00Z", "320.11", "1200.00");

test("leadWindow: the shortest window, whatever its share", () => {
  assert.equal(leadWindow([D7, H5, LIM]), H5, "not the week, though it is further along");
  assert.equal(leadWindow([LIM, D7]), D7, "a window with no span sorts last");
  assert.equal(leadWindow([LIM]), LIM, "a spend is better than nothing");
  assert.equal(leadWindow([]), null);
});

test("leadWindow: the limit once a window with a span is full", () => {
  const full = { ...H5, pct: 100 };
  assert.equal(leadWindow([full, D7, LIM]), LIM);
  assert.equal(leadWindow([full, D7]), full, "no limit to spend: the full window stays");
});

test("otherFigures: the rest in order, amounts where given, days left when they reset later", () => {
  const now = Date.parse("2026-01-02T03:00:00Z");
  assert.equal(otherFigures([H5, D7, LIM], H5, now), "7d 47% (5d)  320.11 / 1200.00 (27%) (30d)");
  assert.equal(otherFigures([H5], H5, now), "");
});

test("daysLeft: rounded up, <1d on the last day, nothing once passed", () => {
  const now = Date.parse("2026-01-02T03:00:00Z");
  assert.equal(daysLeft("2026-01-03T15:00:00Z", now), "2d");
  assert.equal(daysLeft("2026-01-02T20:00:00Z", now), "<1d");
  assert.equal(daysLeft("2026-01-01T00:00:00Z", now), "");
});

// ---- spec 011 -------------------------------------------------------------------

test("shownSections: valid keys in hayami's order; usage alone by default", () => {
  assert.deepEqual(shownSections(["clock", "usage", "nope", "cooler"]), ["usage", "cooler", "clock"]);
  assert.deepEqual(shownSections(undefined), ["usage"]);
  assert.deepEqual(shownSections([]), ["usage"]);
});

test("due: shown sections whose time has come, by the cadence", () => {
  const now = 1_000_000;
  const all = ORDER;
  assert.deepEqual(due(all, {}, now, 30), all, "never read: all due");
  const last = { usage: now - 10_000, bandwidth: now - 5_000, cooler: now - 4_000, peripherals: now - 15_000, clock: now - 30_000 };
  assert.deepEqual(due(all, last, now, 30), ["bandwidth", "peripherals"]);
  assert.deepEqual(due(["usage"], { usage: now - 30_000 }, now, 30), ["usage"]);
  assert.deepEqual(due(["cooler"], {}, now), ["cooler"], "a hidden section is never due");
});

test("arrange and blockHeight: columns when each gets 250 px; heights capped, stacked higher", () => {
  assert.equal(arrange(1600, 4), "columns");
  assert.equal(arrange(600, 4), "stack");
  assert.equal(arrange(1600, 1), "stack");
  assert.equal(blockHeight([3], "stack"), 12 + 22 + 20 + 3 * 22);
  assert.equal(blockHeight([3, 5, 2], "columns"), 12 + 22 + 20 + 5 * 22);
  assert.equal(blockHeight([3, 1], "stack"), 12 + 22 + (20 + 66) + (20 + 22) + 8);
  assert.equal(blockHeight([3, 5, 7, 4, 1], "stack"), 12 + 22 + (20 + 66) + (20 + 110) + (20 + 154) + (20 + 88) + (20 + 22) + 4 * 8);
  assert.equal(blockHeight([30, 1], "stack"), MAX_HEIGHT.stack);
  assert.equal(blockHeight([30, 1], "columns"), MAX_HEIGHT.columns);
  assert.equal(blockHeight([0], "stack"), 12 + 22 + 20 + 22, "an empty section keeps a line for what it says");
});

test("size and rate: hayami's binary units, five characters a number", () => {
  assert.equal(size(0), "0 B");
  assert.equal(size(1023), "1023 B");
  assert.equal(size(1024), "1.0 KiB");
  assert.equal(size(68279349248), "63.6 GiB");
  assert.equal(size(null), "--");
  assert.equal(rate(1.5 * 1024 * 1024), "  1.5 MiB/s");
  assert.equal(rate(0), "    0 B/s  ");
  assert.equal(rate(0).length, rate(123456789).length, "every rate one width");
  assert.equal(rate(null).trim(), "--", "no rate before two readings");
  assert.equal(rate(null).length, rate(1).length);
});

test("bands: hayami's thresholds", () => {
  assert.deepEqual([49, 50, 80, 81].map(quotaStatus), ["good", "warn", "warn", "bad"]);
  assert.deepEqual([20, 21, 50, 51].map(batteryStatus), ["bad", "warn", "warn", "good"]);
  assert.deepEqual([49.9, 50, 55].map(coolantStatus), ["good", "warn", "bad"]);
  const M = 1 << 20;
  assert.deepEqual([null, M - 1, M, 10 * M, 100 * M].map(rateStatus), ["info", "info", "accent", "warn", "strong"]);
});

test("ago", () => {
  const now = Date.parse("2026-01-02T03:00:00Z");
  assert.equal(ago("2026-01-02T02:55:00Z", now), "5m");
  assert.equal(ago("2026-01-02T00:00:00Z", now), "3h");
  assert.equal(ago("2025-12-30T03:00:00Z", now), "3d");
  assert.equal(ago(null, now), "");
});

const sec = (key, reading) => ({ key, polled_at: null, interval_s: 5, reading: { [key]: reading }, absences: [], error: null, details: [], truncated: false });

test("bandwidthRows: interfaces present with rates, then VPNs", () => {
  const rows = bandwidthRows(sec("bandwidth", {
    interfaces: [
      { name: "eth0", present: true, rx_bps: 2 * 1024 * 1024, tx_bps: null, rx_bytes: 1, tx_bytes: 1, trail: { rx: [], tx: [] }, wireless: null, extra: 1 },
      { name: "wlan9", present: false, rx_bps: null, tx_bps: null },
    ],
    vpns: [
      { name: "office", label: "Office", state: "up", latency_ms: 19.2, failing: false, stale: false },
      { name: "home", label: null, state: "down", latency_ms: null, failing: false, stale: false },
      { name: "lab", label: "Lab", state: "up", latency_ms: null, failing: true, stale: false },
    ],
  }));
  assert.deepEqual(rows.map((r) => r.label), ["eth0", "Office", "home", "Lab"]);
  assert.deepEqual(rows[0].parts, [{ text: "↓   2.0 MiB/s", status: "accent" }, { text: `↑ ${rate(null)}`, status: "info" }]);
  assert.deepEqual(rows[1].parts, [{ text: "up", status: "good" }, { text: "19 ms", status: "info" }]);
  assert.equal(rows[2].dim, true);
  assert.deepEqual(rows[3].parts, [{ text: "up, failing", status: "bad" }]);
  assert.deepEqual(bandwidthRows(null), []);
});

test("coolerRows: each role as hayami says it; a processor never coloured", () => {
  const rows = coolerRows(sec("cooler", { uptime_s: 1, probes: [
    { id: "cpu", role: "cpu", name: "Acme CPU", load_pct: 5.4, temp_c: 91, trail: [], stale: false },
    { id: "gpu", role: "gpu", load_pct: null, temp_c: null, stale: false },
    { id: "gpu1", role: "gpu", load_pct: 3, temp_c: 40, stale: true },
    { id: "memory", role: "memory", load_pct: 50.6, bytes: 68279349248, of_bytes: 134722494464 },
    { id: "io", role: "io", read_bps: 0, write_bps: 367777 },
    { id: "coolant", role: "coolant", temp_c: 52.04 },
    { id: "fan1", role: "fan", rpm: 1200.4 },
  ] }));
  assert.deepEqual(rows.map((r) => r.label), ["CPU", "GPU", "GPU 2", "Memory", "IO", "Coolant", "Fan"]);
  assert.deepEqual(rows[0].parts, [{ text: "91°", status: "info" }, { text: "5%", status: "info" }]);
  assert.deepEqual(rows[1].parts.map((p) => p.text), ["--°", "--%"]);
  assert.equal(rows[2].dim, true);
  assert.deepEqual(rows[3].parts.map((p) => p.text), ["51%", "63.6 GiB / 125.5 GiB"]);
  assert.deepEqual(rows[4].parts.map((p) => p.text), ["R     0 B/s  ", "W 359.2 KiB/s"]);
  assert.deepEqual(rows[5].parts, [{ text: "52.0°", status: "warn" }]);
  assert.deepEqual(rows[6].parts.map((p) => p.text), ["1200 rpm"]);
});

test("peripheralRows: battery by band, segments, charging, stale with last seen", () => {
  const now = Date.parse("2026-01-02T03:00:00Z");
  const rows = peripheralRows(sec("peripherals", { devices: [
    { name: "Mouse", kind: "mouse", battery_pct: 15, band: null, segments: null, charge: "draining", stale: false, last_seen: null },
    { name: "Pad", kind: "gamepad", battery_pct: null, band: 2, segments: 4, charge: "draining", stale: false },
    { name: "Buds", kind: "headset", battery_pct: 40, charge: "charging", stale: true, last_seen: "2026-01-01T03:00:00Z" },
  ] }), now);
  assert.deepEqual(rows[0].parts, [{ text: "15%", status: "bad" }]);
  assert.deepEqual(rows[1].parts, [{ text: "2/4", status: "warn" }]);
  assert.deepEqual(rows[2].parts.map((p) => p.text), ["40%", "charging", "seen 1d ago"]);
  assert.equal(rows[2].parts[0].status, "good", "a charging battery is not a warning");
  assert.equal(rows[2].dim, true);
});

test("clockRow: the machine's time from its offset, not this one's", () => {
  const now = Date.parse("2026-01-02T03:04:59Z");
  const r = clockRow(sec("clock", { time: "2026-01-02T03:04:00Z", zone: "PST", utc_offset_s: -28800 }), now);
  assert.equal(r.label, "PST");
  assert.deepEqual(r.parts.map((p) => p.text), ["19:04", "2026-01-01"]);
  assert.equal(clockRow(null, now).parts[0].text, "--:--");
});

// Integration (spec 010 AC): the real command against this machine's running service.
// run-tests.sh gives the run a throwaway TMPDIR, so on macOS the account's real
// temporary folder is asked of the system and handed to the command, as herdr's
// exec (the user's real environment) would have it.
function liveSocket() {
  const os = osPlatform();
  if (os === "linux") {
    const dir = process.env.XDG_RUNTIME_DIR || `/run/user/${userInfo().uid}`;
    return { platform: "linux", path: join(dir, "hayami", "api.sock"), env: process.env };
  }
  if (os === "darwin") {
    const dir = execFileSync("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], { encoding: "utf8" }).trim();
    return { platform: "macos", path: join(dir, "hayami", "api.sock"), env: { ...process.env, TMPDIR: dir } };
  }
  return null;
}
const live = liveSocket();
const nodeExec = (command, args, { timeout }) => new Promise((resolve) => {
  execFile(command, args, { timeout, env: live?.env }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr }));
});

test("live: the running service's sections hold to what the rows functions read", { skip: !live || !existsSync(live.path) ? `no hayami service socket on this machine (${live?.path ?? osPlatform()})` : false }, async () => {
  const r = await readings(nodeExec, live.platform, ORDER, {});
  assert.equal(r.ok, true, JSON.stringify(r));
  const s = r.readings.usage;
  assert.equal(s.key, "usage");
  for (const k of ["polled_at", "interval_s", "reading", "absences", "error", "details", "truncated"]) assert.ok(k in s, `Section has ${k}`);
  for (const k of ORDER) assert.equal(r.readings[k]?.key, k, `the service answered ${k}`);
  assert.ok(Array.isArray(bandwidthRows(r.readings.bandwidth)));
  for (const row of [...coolerRows(r.readings.cooler), ...peripheralRows(r.readings.peripherals), clockRow(r.readings.clock)]) {
    assert.equal(typeof row.label, "string");
    assert.ok(row.parts.length > 0 && row.parts.every((p) => typeof p.text === "string"));
  }
  const u = usageRows(s);
  assert.ok(u.interval_s > 0);
  if (s.reading.usage) {
    assert.ok(Array.isArray(s.reading.usage.accounts));
    for (const a of s.reading.usage.accounts) {
      for (const k of ["name", "plan_badge", "windows"]) assert.ok(k in a, `Account has ${k}`);
      for (const w of a.windows) for (const k of ["name", "utilisation_pct", "resets_at", "span_s", "used", "limit", "severity", "note"]) assert.ok(k in w, `UsageWindow has ${k}`);
    }
  }
});
