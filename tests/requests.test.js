import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRequest, sessionFromSocket, terminalAddress, splitClaimed } from "../lib/requests.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin");
const now = Date.parse("2026-11-24T12:00:00Z");
const req = (o) => JSON.stringify({ v: 1, id: "x", at: "2026-11-24T12:00:00Z", terminal: "t13", ...o });

test("parseRequest: a valid open with a line", () => {
  const r = parseRequest(req({ action: "open", path: "/a/b.md", line: 12 }), now);
  assert.equal(r.ok, true);
  assert.deepEqual({ ...r.req, at: undefined }, { id: "x", action: "open", path: "/a/b.md", line: 12, repo: null, staged: false, terminal: "t13", at: undefined });
});

test("parseRequest: refusals", () => {
  assert.equal(parseRequest("{nope", now).error, "not JSON");
  assert.equal(parseRequest(JSON.stringify({ v: 2, action: "open" }), now).error, "unknown request version");
  assert.match(parseRequest(req({ action: "delete", path: "/a" }), now).error, /unknown action/);
  assert.equal(parseRequest(req({ action: "open", path: "relative/a.md" }), now).error, "path must be absolute");
  assert.equal(parseRequest(req({ action: "diff", path: "/r/a.js" }), now).error, "diff needs the repository");
  const stale = parseRequest(req({ action: "open", path: "/a", at: "2026-11-24T11:58:00Z" }), now);
  assert.deepEqual([stale.ok, stale.stale], [false, true]);
});

test("parseRequest: follow needs no path; Windows paths are absolute", () => {
  assert.equal(parseRequest(req({ action: "follow" }), now).ok, true);
  assert.equal(parseRequest(req({ action: "nav", path: "C:\\Users\\n" }), now).ok, true);
  assert.equal(parseRequest(req({ action: "open", path: "/a", line: -3 }), now).req.line, null);
});

test("sessionFromSocket, terminalAddress, splitClaimed", () => {
  assert.equal(sessionFromSocket("/Users/n/.local/state/herdr-core/default/default.sock"), "default");
  assert.equal(sessionFromSocket("/run/user/1000/herdr-core/work/x.sock"), "work");
  assert.equal(sessionFromSocket(""), "default");
  assert.equal(terminalAddress(null, "t13"), "t13");
  assert.equal(terminalAddress("njv-cachyos-default", "t2k"), "njv-cachyos-default/t2k");
  assert.equal(terminalAddress("m", "m/t2k"), "m/t2k");
  assert.deepEqual(splitClaimed('{"a":1}\n\x1e{"b":2}\n\x1e'), ['{"a":1}', '{"b":2}']);
});

// The bash commands, end to end, through the same validator the reader uses.
const bash = spawnSync("bash", ["--version"]).status === 0 && process.platform !== "win32";
const run = (cmd, args, env = {}) => spawnSync(join(BIN, cmd), args, {
  encoding: "utf8", env: { ...process.env, HC_TERMINAL_ID: "t42", HC_TERMINAL_SOCKET: "/s/herdr-core/work/x.sock", HERDR_REQUEST_DRY_RUN: "1", ...env },
});

test("herdr-request: awkward paths survive as valid JSON", { skip: !bash }, () => {
  for (const path of ['/tmp/a "quoted" name.md', "/tmp/back\\slash.md", "/tmp/ünïcödé 文件.md", "/tmp/$(rm -rf ~).md"]) {
    const r = run("herdr-request", ["open", path]);
    assert.equal(r.status, 0, r.stderr);
    const parsed = parseRequest(r.stdout, Date.now());
    assert.equal(parsed.ok, true, `${path}: ${parsed.error}`);
    assert.equal(parsed.req.path, path);
    assert.equal(parsed.req.terminal, "t42");
  }
});

test("herdr-request: refuses control characters, unknown actions and bad lines", { skip: !bash }, () => {
  assert.notEqual(run("herdr-request", ["open", "/tmp/a\nb"]).status, 0);
  assert.notEqual(run("herdr-request", ["delete", "/tmp/a"]).status, 0);
  assert.notEqual(run("herdr-request", ["open", "/tmp/a", "line=0"]).status, 0);
});

test("herdr-request: off Herdr it sends nothing and exits 2", { skip: !bash }, () => {
  const r = run("herdr-request", ["open", "/tmp/a"], { HC_TERMINAL_ID: "", HERDR_REQUEST_DRY_RUN: "" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not in a Herdr terminal/);
});

test("herdr-open: PATH:LINE, folders go to nav, diffs carry the repository", { skip: !bash }, () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "herdr-open-")));
  const file = join(dir, "notes.md");
  writeFileSync(file, "x\n");
  mkdirSync(join(dir, "sub"));
  let r = run("herdr-open", [`${file}:7`]);
  assert.equal(r.status, 0, r.stderr);
  let q = parseRequest(r.stdout, Date.now()).req;
  assert.deepEqual([q.action, q.path, q.line], ["open", file, 7]);
  q = parseRequest(run("herdr-open", [join(dir, "sub")]).stdout, Date.now()).req;
  assert.deepEqual([q.action, q.path], ["nav", join(dir, "sub")]);
  q = parseRequest(run("herdr-open", ["--external", file]).stdout, Date.now()).req;
  assert.equal(q.action, "external");
  assert.notEqual(run("herdr-open", [join(dir, "missing.md")]).status, 0);
  // --diff outside a repository is refused; inside one it names the repository.
  assert.notEqual(run("herdr-open", ["--diff", file]).status, 0);
  spawnSync("git", ["init", "-q", dir]);
  q = parseRequest(run("herdr-open", ["--staged", file]).stdout, Date.now()).req;
  assert.deepEqual([q.action, q.repo, q.staged], ["diff", dir, true]);
});

test("herdr-nav: folder, reveal, follow", { skip: !bash }, () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "herdr-nav-")));
  writeFileSync(join(dir, "a.txt"), "");
  assert.equal(parseRequest(run("herdr-nav", [dir]).stdout, Date.now()).req.action, "nav");
  const rev = parseRequest(run("herdr-nav", ["--reveal", join(dir, "a.txt")]).stdout, Date.now()).req;
  assert.deepEqual([rev.action, rev.path], ["reveal", join(dir, "a.txt")]);
  assert.equal(parseRequest(run("herdr-nav", ["--follow"]).stdout, Date.now()).req.action, "follow");
  assert.notEqual(run("herdr-nav", [join(dir, "missing")]).status, 0);
});
