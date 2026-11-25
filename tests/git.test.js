import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseStatus, parseNumstat, parseWorktrees, within, worktreeOf, placeAgent, lockedBy,
  stageArgs, unstageArgs, unstageAllArgs, pushArgs, pullArgs, fetchArgs, commitArgs,
  parseLog, ago, gitKeyAction, WRITES, parseCommit, parseCommitFiles, indexWorktrees, visibleWorktrees,
  planCleanup, cdCommand, isShell, CLEANUP_SCAN_SH, parseCleanupScan, FOREIGN_SCAN_SH, parseForeignScan, DOCKER_CHOWN_SH, DOCKER_PREFLIGHT_SH, removeArgs,
} from "../lib/git.js";

const z = (...recs) => recs.join("\0") + "\0";

test("parseStatus: branch header with upstream distance", () => {
  const s = parseStatus(z("# branch.oid abc123", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +2 -1"));
  assert.deepEqual(s.branch, { head: "main", oid: "abc123", upstream: "origin/main", ahead: 2, behind: 1 });
});

test("parseStatus: detached, initial, no upstream", () => {
  const s = parseStatus(z("# branch.oid (initial)", "# branch.head (detached)"));
  assert.deepEqual(s.branch, { head: null, oid: null, upstream: null, ahead: 0, behind: 0 });
});

test("parseStatus: staged, unstaged, both, untracked, renames with spaces, conflicts", () => {
  const s = parseStatus(z(
    "1 M. N... 100644 100644 100644 aaa bbb staged.js",
    "1 .M N... 100644 100644 100644 aaa bbb changed.js",
    "1 MM N... 100644 100644 100644 aaa bbb both.js",
    "1 A. N... 000000 100644 100644 000 bbb new file.txt",
    "1 .D N... 100644 100644 000000 aaa aaa gone.js",
    "2 R. N... 100644 100644 100644 aaa aaa R100 new name.md", "old name.md",
    "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.js",
    "? untracked dir/",
  ));
  assert.deepEqual(s.staged, [
    { path: "staged.js", code: "M" }, { path: "both.js", code: "M" },
    { path: "new file.txt", code: "A" }, { path: "new name.md", code: "R", orig: "old name.md" },
  ]);
  assert.deepEqual(s.unstaged, [{ path: "changed.js", code: "M" }, { path: "both.js", code: "M" }, { path: "gone.js", code: "D" }]);
  assert.deepEqual(s.conflicts, [{ path: "conflict.js", code: "U" }]);
  assert.deepEqual(s.untracked, [{ path: "untracked dir/", code: "?" }]);
});

test("parseNumstat: counts, binary, renames", () => {
  const out = parseNumstat(z("3\t1\ta.js", "-\t-\timg.png", "2\t0\t", "old.md", "new.md"));
  assert.deepEqual(out, {
    "a.js": { added: 3, removed: 1 },
    "img.png": { added: null, removed: null },
    "new.md": { added: 2, removed: 0 },
  });
});

test("parseWorktrees: main, linked, detached, locked, prunable; bare left out", () => {
  const text = [
    "worktree /r", "HEAD aaa", "branch refs/heads/main", "",
    "worktree /w/feat", "HEAD bbb", "branch refs/heads/feat/x", "locked", "",
    "worktree /w/old", "HEAD ccc", "detached", "prunable gitdir file points to non-existent location", "",
    "worktree /r.git", "bare", "",
  ].join("\n");
  const list = parseWorktrees(text);
  assert.deepEqual(list.map((w) => [w.path, w.branch, w.main, w.detached, w.locked, w.prunable]), [
    ["/r", "main", true, false, false, false],
    ["/w/feat", "feat/x", false, false, true, false],
    ["/w/old", null, false, true, false, true],
  ]);
});

test("within and worktreeOf: deepest wins; a shared prefix is not inside", () => {
  const wts = [{ path: "/w" }, { path: "/w/a" }, { path: "/w/ab" }];
  assert.equal(within("/w/a/src", "/w/a"), true);
  assert.equal(within("/w/ab", "/w/a"), false);
  assert.equal(worktreeOf("/w/a/src", wts).path, "/w/a");
  assert.equal(worktreeOf("/w/ab/x", wts).path, "/w/ab");
  assert.equal(worktreeOf("/w/other", wts).path, "/w");
  assert.equal(worktreeOf("/elsewhere", wts), null);
});

test("within on Windows: separators and case", () => {
  assert.equal(within("C:\\Users\\N\\repo\\src", "c:/users/n/repo"), true);
  assert.equal(within("C:\\Users\\N\\repo2", "C:/Users/N/repo"), false);
});

test("placeAgent: label, then program folder, then terminal folder", () => {
  const wts = [{ path: "/r" }, { path: "/w/feat" }];
  assert.deepEqual(placeAgent({ label: "/w/feat", program: "/r", terminal: "/home" }, wts), { worktree: wts[1], source: "label" });
  assert.deepEqual(placeAgent({ program: "/r/src", terminal: "/w/feat" }, wts), { worktree: wts[0], source: "program" });
  assert.deepEqual(placeAgent({ terminal: "/w/feat/x" }, wts), { worktree: wts[1], source: "terminal" });
  assert.equal(placeAgent({ terminal: "/home" }, wts), null);
});

test("placeAgent: an agent working in another repository is not placed here by its terminal's folder (#13)", () => {
  const wts = [{ path: "/git/sysadmin" }];
  // The session started in sysadmin; the agent works in herdr-mods.
  assert.equal(placeAgent({ program: "/git/herdr-mods", terminal: "/git/sysadmin" }, wts), null);
  assert.equal(placeAgent({ label: "/elsewhere", terminal: "/git/sysadmin/x" }, wts), null);
});

test("lockedBy: only a working agent locks", () => {
  assert.equal(lockedBy([{ name: "a", status: "idle" }, { name: "b", status: "blocked" }, { name: "c", status: "done" }]), null);
  assert.equal(lockedBy([{ name: "a", status: "idle" }, { name: "b", status: "working" }]).name, "b");
});

test("write commands: argument vectors, paths after --, nothing forced", () => {
  assert.deepEqual(stageArgs(["a b.js", "-x"]), ["--literal-pathspecs", "add", "--", "a b.js", "-x"]);
  assert.deepEqual(unstageArgs(["a.js"], true), ["--literal-pathspecs", "reset", "-q", "HEAD", "--", "a.js"]);
  assert.deepEqual(unstageArgs(["a.js"], false), ["--literal-pathspecs", "rm", "--cached", "-r", "-q", "--", "a.js"]);
  assert.deepEqual(unstageAllArgs(true), ["--literal-pathspecs", "reset", "-q", "HEAD", "--", "."]);
  assert.deepEqual(pullArgs(), ["pull", "--ff-only"]);
  assert.deepEqual(pushArgs("main", "origin/main"), ["push"]);
  assert.deepEqual(pushArgs("feat", null), ["push", "-u", "origin", "feat"]);
  assert.deepEqual(fetchArgs(), ["fetch", "--prune"]);
  assert.deepEqual(commitArgs("fix: a \"quoted\" message; rm -rf ~"), ["commit", "-m", "fix: a \"quoted\" message; rm -rf ~"]);
  for (const argv of [pullArgs(), pushArgs("m", null), fetchArgs()]) assert.ok(!argv.some((a) => /force|--hard/.test(a)));
});

test("parseLog and ago", () => {
  const log = parseLog("abc1234\x1ffix: thing\x1f1700000000\x1fNJ Verenini\ndef5678\x1f\x1f1700003600\n");
  assert.deepEqual(log, [
    { hash: "abc1234", subject: "fix: thing", time: 1700000000, author: "NJ Verenini" },
    { hash: "def5678", subject: "", time: 1700003600, author: "" }, // the clean-up scan's format has no author
  ]);
  const now = 1700100000;
  assert.equal(ago(now - 30, now), "now");
  assert.equal(ago(now - 300, now), "5m");
  assert.equal(ago(now - 3 * 3600, now), "3h");
  assert.equal(ago(now - 2 * 86400, now), "2d");
  assert.equal(ago(now - 30 * 86400, now), "4w");
});

test("gitKeyAction: lazygit keys; writes are the lockable set", () => {
  assert.equal(gitKeyAction({ key: "space" }), "toggle");
  assert.equal(gitKeyAction({ key: "p", key_char: "p" }), "pull");
  assert.equal(gitKeyAction({ key: "p", key_char: "P", modifiers: { shift: true } }), "push");
  assert.equal(gitKeyAction({ key: "enter" }), "diff");
  assert.equal(gitKeyAction({ key: "/", key_char: "?", modifiers: { shift: true } }), "help");
  assert.equal(gitKeyAction({ key: "p", key_char: "p", modifiers: { platform: true } }), null);
  assert.deepEqual([...WRITES].sort(), ["all", "commit", "fetch", "pull", "push", "toggle"]);
});

test("parseCommit: subject, body, author, time", () => {
  const c = parseCommit("abc123\x1fAda\x1fada@x.y\x1f1700000000\x1ffix: a thing\n\nWhy it was wrong.\nMore.\n\n");
  assert.deepEqual(c, { hash: "abc123", author: "Ada", email: "ada@x.y", time: 1700000000, subject: "fix: a thing", body: "Why it was wrong.\nMore." });
  assert.equal(parseCommit("h\x1fa\x1fe\x1f1\x1fone line").body, "");
});

test("parseCommitFiles: status, renames, counts, binary", () => {
  const names = ["M", "a.js", "A", "new file.md", "D", "gone.txt", "R100", "old.md", "moved.md", "M", "img.png", ""].join("\0");
  const nums = ["3\t1\ta.js", "10\t0\tnew file.md", "0\t4\tgone.txt", "0\t0\t", "old.md", "moved.md", "-\t-\timg.png", ""].join("\0");
  assert.deepEqual(parseCommitFiles(names, nums), [
    { path: "a.js", code: "M", added: 3, removed: 1 },
    { path: "new file.md", code: "A", added: 10, removed: 0 },
    { path: "gone.txt", code: "D", added: 0, removed: 4 },
    { path: "moved.md", code: "R", orig: "old.md", added: 0, removed: 0 },
    { path: "img.png", code: "M", added: null, removed: null },
  ]);
});

test("indexWorktrees: same answers as worktreeOf, deepest first, prefix-safe", () => {
  const wts = [{ path: "/w" }, { path: "/w/a" }, { path: "/w/ab" }, { path: "C:/R/x" }];
  const ix = indexWorktrees(wts);
  for (const f of ["/w/a/src", "/w/ab/x", "/w/other", "/elsewhere", "/w", "c:\\r\\x\\y", ""]) {
    assert.equal(ix.lookup(f), worktreeOf(f, wts), f);
  }
  assert.equal(worktreeOf("/w/a/src", ix).path, "/w/a");
  assert.deepEqual(placeAgent({ terminal: "/w/ab/q" }, ix), { worktree: wts[2], source: "terminal" });
});

test("indexWorktrees: 80 worktrees x 80 lookups stays fast", () => {
  const wts = Array.from({ length: 80 }, (_, i) => ({ path: `/home/u/git/repo-wt-${i}` }));
  const ix = indexWorktrees(wts);
  const t0 = Date.now();
  for (let r = 0; r < 200; r++) for (const w of wts) ix.lookup(w.path + "/src/deep/file");
  assert.ok(Date.now() - t0 < 500);
});

test("visibleWorktrees: caps the strip, keeps shown/here/agents/changed, in list order", () => {
  const list = Array.from({ length: 30 }, (_, i) => ({ path: `/w${i}` }));
  const { rows, hidden } = visibleWorktrees(list, { shown: "/w20", here: "/w25", agents: { "/w29": [1] }, counts: { "/w27": 3 }, cap: 5 });
  assert.deepEqual(rows.map((w) => w.path), ["/w0", "/w20", "/w25", "/w27", "/w29"]);
  assert.equal(hidden, 25);
  assert.equal(visibleWorktrees(list, { cap: 5, all: true }).rows.length, 30);
  assert.equal(visibleWorktrees(list.slice(0, 4), { cap: 5 }).hidden, 0);
});

const wt = (o) => ({ path: "/r.wt/feat", main: false, locked: false, branch: "feat", detached: false, changes: 0, upstream: "origin/feat", ahead: 0, onRemote: false, agents: [], terminals: [], ...o });

test("planCleanup: a clean, pushed, unused worktree is eligible", () => {
  const [p] = planCleanup([wt({ terminals: [{ address: "t1", program: "zsh" }, { address: "m/t2", program: "-bash" }] })]);
  assert.equal(p.eligible, true);
  assert.equal(p.why, "clean · pushed to origin/feat");
  assert.equal(p.parent, "/r.wt");
  assert.deepEqual(p.shells, [{ address: "t1", cmd: " cd '/r.wt'" }, { address: "m/t2", cmd: " cd '/r.wt'" }]);
});

test("planCleanup: behind its upstream is fine; detached on a remote branch is fine", () => {
  assert.equal(planCleanup([wt({ ahead: 0, behind: 3 })])[0].why, "clean · pushed to origin/feat (3 behind)");
  const d = planCleanup([wt({ detached: true, branch: null, upstream: null, onRemote: true, remoteRef: "origin/main" })])[0];
  assert.deepEqual([d.eligible, d.why], [true, "clean · commit is on origin/main"]);
  assert.deepEqual(planCleanup([wt({ last: { hash: "abc", subject: "s", time: 1 } })])[0].last, { hash: "abc", subject: "s", time: 1 });
});

test("planCleanup: each reason to keep a worktree", () => {
  const reasons = planCleanup([
    wt({ main: true }), wt({ locked: true }), wt({ changes: 1 }), wt({ changes: 3 }),
    wt({ upstream: null }), wt({ ahead: 2 }), wt({ detached: true, onRemote: false }),
    wt({ agents: ["claude-code"] }), wt({ terminals: [{ address: "t9", program: "nvim" }, { address: "t3", program: "zsh" }] }),
  ]).map((p) => [p.eligible, p.reason]);
  assert.deepEqual(reasons, [
    [false, "the main worktree"], [false, "locked"], [false, "1 uncommitted change"], [false, "3 uncommitted changes"],
    [false, "never pushed (no upstream)"], [false, "2 commits not pushed"], [false, "detached HEAD not on any remote branch"],
    [false, "agent in use: claude-code"], [false, "in use: nvim (t9)"],
  ]);
  const f = planCleanup([wt({ path: "/r.wt/it's", foreign: { path: "/r.wt/it's/tools/__pycache__", owner: "root" } })])[0];
  assert.deepEqual([f.eligible, f.reason, f.fix], [false,
    "contains files owned by root (e.g. …/tools/__pycache__); git cannot delete them. Fix ownership, or run:",
    `sudo chown -R "$USER" -- '/r.wt/it'\\''s'`]);
});

test("cdCommand: quoted for POSIX shells and PowerShell; isShell", () => {
  assert.equal(cdCommand("/a/it's here", "zsh"), " cd '/a/it'\\''s here'");
  assert.equal(cdCommand("C:\\w\\it's", "pwsh"), " cd 'C:\\w\\it''s'");
  assert.equal(isShell("-zsh"), true);
  assert.equal(isShell("/bin/bash"), true);
  assert.equal(isShell("powershell.exe"), true);
  assert.equal(isShell("nvim"), false);
  assert.equal(isShell("claude"), false);
});

test("CLEANUP_SCAN_SH against real worktrees, parsed by parseCleanupScan", { skip: process.platform === "win32" }, async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, realpathSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "herdr-scan-")));
  const g = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdio: "pipe" });
  g(dir, "init", "-q", "--bare", "origin.git");
  g(dir, "clone", "-q", "origin.git", "repo");
  const repo = join(dir, "repo");
  g(repo, "commit", "-q", "--allow-empty", "-m", "init");
  g(repo, "push", "-q", "origin", "HEAD");
  g(repo, "worktree", "add", "-q", "-b", "feat", join(dir, "wt feat"));
  writeFileSync(join(dir, "wt feat", "x.txt"), "x");
  g(repo, "worktree", "add", "-q", "--detach", join(dir, "wt-det"));
  g(repo, "worktree", "add", "-q", "--detach", join(dir, "wt-local"));
  g(join(dir, "wt-local"), "commit", "-q", "--allow-empty", "-m", "only here");
  const tmp = join(dir, "tmp");
  const { mkdirSync, readdirSync } = await import("node:fs");
  mkdirSync(tmp);
  const paths = [repo, join(dir, "wt feat"), join(dir, "wt-det"), join(dir, "wt-local")];
  const out = spawnSync("sh", ["-c", CLEANUP_SCAN_SH, "scan", ...paths], { encoding: "utf8", env: { ...process.env, TMPDIR: tmp } }).stdout;
  const scan = parseCleanupScan(out);
  // In the order given, whatever order the parallel checks finished in; nothing left behind.
  assert.deepEqual(Object.keys(scan), paths);
  assert.deepEqual(readdirSync(tmp), []);
  assert.equal(scan[repo].status.branch.head, execFileSync("git", ["-C", repo, "branch", "--show-current"], { encoding: "utf8" }).trim());
  assert.equal(scan[repo].last.subject, "init");
  assert.equal(scan[repo].remoteRef, null);
  assert.equal(scan[join(dir, "wt feat")].status.untracked.length, 1);
  assert.equal(scan[join(dir, "wt-det")].status.branch.head, null);
  assert.equal(scan[join(dir, "wt-det")].remoteRef, "a remote branch");
  assert.equal(scan[join(dir, "wt-local")].remoteRef, null);
  assert.equal(scan[join(dir, "wt-local")].last.subject, "only here");
});

test("FOREIGN_SCAN_SH: nothing foreign in a tree the user owns", { skip: process.platform === "win32" }, async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "herdr-foreign-"));
  mkdirSync(join(dir, "a b", "__pycache__"), { recursive: true });
  writeFileSync(join(dir, "a b", "__pycache__", "x.pyc"), "");
  const out = spawnSync("sh", ["-c", FOREIGN_SCAN_SH, "scan", join(dir, "a b")], { encoding: "utf8" }).stdout;
  assert.deepEqual(parseForeignScan(out), { [join(dir, "a b")]: null });
  assert.deepEqual(parseForeignScan("/w\t/w/x/__pycache__\troot\n/v\t\t\n"), { "/w": { path: "/w/x/__pycache__", owner: "root" }, "/v": null });
});

test("DOCKER_CHOWN_SH refuses a path docker --mount cannot take", { skip: process.platform === "win32" }, async () => {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync("sh", ["-c", DOCKER_CHOWN_SH, "fix", "/tmp/a,b"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /comma/);
});

// A stand-in `docker` on PATH reports a given setup; the preflight accepts only the default.
test("DOCKER_PREFLIGHT_SH accepts default Docker and refuses everything else", { skip: process.platform !== "linux" }, async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "herdr-docker-"));
  try {
    const run = ({ info = 'Arch Linux|["name=seccomp,profile=builtin","name=cgroupns"]', components = "Engine;containerd;", image = true } = {}) => {
      writeFileSync(join(dir, "docker"), `#!/bin/sh
case "$1" in
  info) printf '%s\\n' '${info}';;
  version) printf '%s\\n' '${components}';;
  image) exit ${image ? 0 : 1};;
esac
`);
      chmodSync(join(dir, "docker"), 0o755);
      const r = spawnSync("sh", ["-c", DOCKER_PREFLIGHT_SH], { encoding: "utf8", env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` } });
      return [r.status, r.stderr.trim()];
    };
    assert.deepEqual(run(), [0, ""]);
    assert.deepEqual(run({ info: 'Arch Linux|["name=seccomp","name=rootless"]' }), [3, "refused: Docker runs rootless; use the sudo command instead"]);
    assert.deepEqual(run({ info: 'Arch Linux|["name=userns"]' })[1], "refused: Docker remaps user namespaces; use the sudo command instead");
    assert.deepEqual(run({ info: 'Fedora Linux|["name=selinux"]' })[1], "refused: SELinux is on for Docker; use the sudo command instead");
    assert.deepEqual(run({ info: 'Docker Desktop|[]' })[1], "refused: Docker Desktop; use the sudo command instead");
    assert.deepEqual(run({ components: "Podman Engine;" })[1], "refused: this is Podman, not Docker; use the sudo command instead");
    assert.deepEqual(run({ image: false })[1], "refused: the alpine image is not on this machine; use the sudo command instead");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("planCleanup force: what Really remove would lose or keep, and when it is refused", () => {
  const force = (o) => planCleanup([wt(o)])[0].force;
  assert.equal(planCleanup([wt()])[0].force, undefined);
  assert.deepEqual(force({ changes: 3, ahead: 2 }), { allowed: true, locked: false, chown: null, shells: [],
    lost: ["3 uncommitted changes (untracked files included)"], kept: ["branch feat keeps its 2 unpushed commits"] });
  assert.deepEqual(force({ upstream: null }).kept, ["branch feat keeps its commits (it was never pushed)"]);
  const d = force({ detached: true, branch: null, upstream: null, onRemote: false, last: { hash: "abc1234", subject: "s", time: 1 } });
  assert.deepEqual([d.lost, d.kept], [["commit abc1234 is on no branch or remote"], []]);
  const l = force({ locked: true, terminals: [{ address: "t1", program: "zsh" }] });
  assert.deepEqual([l.locked, l.kept, l.shells], [true, ["branch feat is kept"], [{ address: "t1", cmd: " cd '/r.wt'" }]]);
  assert.deepEqual(force({ main: true }), { allowed: false, refused: "the main worktree is never removed" });
  assert.match(force({ changes: 1, agents: ["claude-code"] }).refused, /agent is working in it \(claude-code\)/);
  assert.match(force({ terminals: [{ address: "t9", program: "nvim" }] }).refused, /nvim \(t9\) running in it; close it first/);
  const o = planCleanup([wt({ changes: 2, foreign: { path: "/r.wt/feat/x", owner: "root" } })])[0];
  assert.deepEqual([o.reason, o.owner, o.force.allowed, o.force.chown], ["2 uncommitted changes", "root", true, "root"]);
  assert.equal(force({ changes: 1 }).chown, null);
});

test("removeArgs: --force once, twice for a locked worktree", () => {
  assert.deepEqual(removeArgs("/r", "/w"), ["-C", "/r", "worktree", "remove", "/w"]);
  assert.deepEqual(removeArgs("/r", "/w", { force: true }), ["-C", "/r", "worktree", "remove", "--force", "/w"]);
  assert.deepEqual(removeArgs("/r", "/w", { force: true, locked: true }), ["-C", "/r", "worktree", "remove", "--force", "--force", "/w"]);
});

test("removeArgs against git: --force discards changes; locked needs it twice", { skip: process.platform === "win32" }, async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, existsSync, realpathSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "herdr-force-")));
  const g = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdio: "pipe" });
  g(dir, "init", "-q", "repo");
  const repo = join(dir, "repo");
  g(repo, "commit", "-q", "--allow-empty", "-m", "init");
  g(repo, "worktree", "add", "-q", "-b", "dirty", join(dir, "dirty"));
  writeFileSync(join(dir, "dirty", "x.txt"), "x");
  assert.notEqual(spawnSync("git", removeArgs(repo, join(dir, "dirty"))).status, 0);
  assert.equal(spawnSync("git", removeArgs(repo, join(dir, "dirty"), { force: true })).status, 0);
  assert.equal(existsSync(join(dir, "dirty")), false);
  g(repo, "worktree", "add", "-q", "-b", "held", join(dir, "held"));
  g(repo, "worktree", "lock", join(dir, "held"));
  assert.notEqual(spawnSync("git", removeArgs(repo, join(dir, "held"), { force: true })).status, 0);
  assert.equal(spawnSync("git", removeArgs(repo, join(dir, "held"), { force: true, locked: true })).status, 0);
  assert.equal(g(repo, "branch", "--list", "dirty", "held").toString().split("\n").filter(Boolean).length, 2);
});
