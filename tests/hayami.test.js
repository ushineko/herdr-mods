import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { platform as osPlatform, userInfo } from "node:os";
import { join } from "node:path";
import { request, checkPath, parse, get, readings, usageRows, until, pollEvery } from "../lib/hayami.js";

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

// Integration (spec 010 AC): the real command against this machine's running service.
function liveSocket() {
  const os = osPlatform();
  if (os === "linux") {
    const dir = process.env.XDG_RUNTIME_DIR || `/run/user/${userInfo().uid}`;
    return { platform: "linux", path: join(dir, "hayami", "api.sock") };
  }
  if (os === "darwin" && process.env.TMPDIR) return { platform: "macos", path: join(process.env.TMPDIR, "hayami", "api.sock") };
  return null;
}
const live = liveSocket();
const nodeExec = (command, args, { timeout }) => new Promise((resolve) => {
  execFile(command, args, { timeout }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr }));
});

test("live: the running service's usage section holds to what usageRows reads", { skip: !live || !existsSync(live.path) ? `no hayami service socket on this machine (${live?.path ?? osPlatform()})` : false }, async () => {
  const r = await readings(nodeExec, live.platform, ["usage"], {});
  assert.equal(r.ok, true, JSON.stringify(r));
  const s = r.readings.usage;
  assert.equal(s.key, "usage");
  for (const k of ["polled_at", "interval_s", "reading", "absences", "error", "details", "truncated"]) assert.ok(k in s, `Section has ${k}`);
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
