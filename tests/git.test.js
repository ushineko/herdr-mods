import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseStatus, parseNumstat, parseWorktrees, within, worktreeOf, placeAgent, lockedBy,
  stageArgs, unstageArgs, unstageAllArgs, pushArgs, pullArgs, fetchArgs, commitArgs,
  parseLog, ago, gitKeyAction, WRITES, parseCommit, parseCommitFiles, indexWorktrees, visibleWorktrees,
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
  assert.deepEqual(placeAgent({ label: "/elsewhere", terminal: "/w/feat/x" }, wts), { worktree: wts[1], source: "terminal" });
  assert.equal(placeAgent({ terminal: "/home" }, wts), null);
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
  const log = parseLog("abc1234\x1ffix: thing\x1f1700000000\ndef5678\x1f\x1f1700003600\n");
  assert.deepEqual(log, [{ hash: "abc1234", subject: "fix: thing", time: 1700000000 }, { hash: "def5678", subject: "", time: 1700003600 }]);
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
