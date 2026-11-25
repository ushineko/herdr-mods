// The git panel's pure helpers (spec 003). No herdr imports.
//
// Credits (Apache-2.0, written fresh here after reading theirs):
//   porcelain v2 status with branch.ab: ReidenXerx/herdr-git-panel git.js
//   stage/unstage arguments, unborn-HEAD unstage, read-only flags: munza/herdr-mods better-changes
//   worktree list parsing and deepest-worktree ownership: shiro-el/herdr-workbench t3-panel/worktrees.js

/** Flags for reads: no index refresh or lock, no fsmonitor (a folder watch would see them). */
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];

const letter = (c) => ({ A: "A", D: "D", R: "R", C: "C", T: "T" })[c] ?? "M";

/**
 * `git status --porcelain=v2 --branch -z --untracked-files=normal` into
 * { branch: { head, oid, upstream, ahead, behind }, staged, unstaged, untracked, conflicts }.
 * Each file: { path, code, orig? }. A file both staged and changed again is in both lists.
 */
export function parseStatus(z) {
  const branch = { head: null, oid: null, upstream: null, ahead: 0, behind: 0 };
  const staged = [], unstaged = [], untracked = [], conflicts = [];
  const t = String(z ?? "").split("\0");
  for (let i = 0; i < t.length; i++) {
    const rec = t[i];
    if (!rec) continue;
    if (rec.startsWith("# ")) {
      const [, key, ...rest] = rec.split(" ");
      const value = rest.join(" ");
      if (key === "branch.head") branch.head = value === "(detached)" ? null : value;
      else if (key === "branch.oid") branch.oid = value === "(initial)" ? null : value;
      else if (key === "branch.upstream") branch.upstream = value;
      else if (key === "branch.ab") {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) { branch.ahead = Number(m[1]); branch.behind = Number(m[2]); }
      }
      continue;
    }
    const kind = rec[0];
    if (kind === "?") { untracked.push({ path: rec.slice(2), code: "?" }); continue; }
    if (kind === "!") continue;
    if (kind === "u") {
      const f = rec.split(" ");
      conflicts.push({ path: f.slice(10).join(" "), code: "U" });
      continue;
    }
    if (kind === "1" || kind === "2") {
      const f = rec.split(" ");
      const xy = f[1], path = f.slice(kind === "1" ? 8 : 9).join(" ");
      const orig = kind === "2" ? t[++i] : null;
      if (xy[0] !== ".") staged.push({ path, code: letter(xy[0]), ...(orig ? { orig } : {}) });
      if (xy[1] !== ".") unstaged.push({ path, code: letter(xy[1]) });
    }
  }
  return { branch, staged, unstaged, untracked, conflicts };
}

/** `git diff [--cached] --numstat -z` into { path: { added, removed } } (null counts for binary files). */
export function parseNumstat(z) {
  const out = {};
  const t = String(z ?? "").split("\0");
  for (let i = 0; i < t.length; i++) {
    const rec = t[i];
    if (!rec) continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(rec);
    if (!m) continue;
    let path = m[3];
    if (path === "") { i++; path = t[++i]; } // a rename: "a\tr\t\0old\0new"
    if (!path) continue;
    out[path] = { added: m[1] === "-" ? null : Number(m[1]), removed: m[2] === "-" ? null : Number(m[2]) };
  }
  return out;
}

/** `git worktree list --porcelain` into [{ path, head, branch, detached, locked, prunable, main }]. Bare entries are left out. */
export function parseWorktrees(text) {
  const list = [];
  for (const block of String(text ?? "").replace(/\r/g, "").split(/\n\n+/)) {
    const w = { path: null, head: null, branch: null, detached: false, locked: false, prunable: false, bare: false };
    for (const line of block.split("\n")) {
      const [key, ...rest] = line.split(" ");
      const value = rest.join(" ");
      if (key === "worktree") w.path = value;
      else if (key === "HEAD") w.head = value;
      else if (key === "branch") w.branch = value.replace(/^refs\/heads\//, "");
      else if (key === "detached") w.detached = true;
      else if (key === "locked") w.locked = true;
      else if (key === "prunable") w.prunable = true;
      else if (key === "bare") w.bare = true;
    }
    if (w.path && !w.bare) list.push(w);
  }
  return list.map((w, i) => {
    const { bare, ...rest } = w;
    return { ...rest, main: i === 0 };
  });
}

const norm = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
const windowsPath = (p) => /^[A-Za-z]:/.test(p);

/** True when `path` is `root` or inside it (not a sibling sharing a prefix). Windows paths ignore case. */
export function within(path, root) {
  let p = norm(path), r = norm(root);
  if (!p || !r) return false;
  if (windowsPath(p) || windowsPath(r)) { p = p.toLowerCase(); r = r.toLowerCase(); }
  return p === r || p.startsWith(r + "/");
}

/** The deepest worktree (by path) containing `folder`, or null. */
export function worktreeOf(folder, worktrees) {
  let best = null;
  for (const w of worktrees) if (within(folder, w.path) && (!best || norm(w.path).length > norm(best.path).length)) best = w;
  return best;
}

export const WORKTREE_LABEL = "herdr-mods.worktree";

/**
 * Where an agent works (spec 003 R5a), first match wins:
 * its label, its program's folder, its terminal's folder.
 * @returns { worktree, source: "label" | "program" | "terminal" } or null
 */
export function placeAgent({ label, program, terminal }, worktrees) {
  for (const [source, folder] of [["label", label], ["program", program], ["terminal", terminal]]) {
    if (!folder) continue;
    const worktree = worktreeOf(folder, worktrees);
    if (worktree) return { worktree, source };
  }
  return null;
}

/** The first working agent among `agents` ({ status, name }), or null: the worktree is locked by it (R11a). */
export function lockedBy(agents) {
  return agents.find((a) => a.status === "working") ?? null;
}

// --- Writing commands (R9-R12): argument vectors, paths after "--" ---

const LITERAL = ["--literal-pathspecs"];
export const stageArgs = (paths) => [...LITERAL, "add", "--", ...paths];
export const unstageArgs = (paths, hasHead) =>
  hasHead ? [...LITERAL, "reset", "-q", "HEAD", "--", ...paths] : [...LITERAL, "rm", "--cached", "-r", "-q", "--", ...paths];
export const stageAllArgs = () => ["add", "-A"];
export const unstageAllArgs = (hasHead) => unstageArgs(["."], hasHead);
export const commitArgs = (message) => ["commit", "-m", message];
export const pullArgs = () => ["pull", "--ff-only"];
export const pushArgs = (branch, upstream) => (upstream ? ["push"] : ["push", "-u", "origin", branch]);
export const fetchArgs = () => ["fetch", "--prune"];

// --- Recent commits ---

export const LOG_FORMAT = "%h%x1f%s%x1f%ct";

/** `git log -n5 --format=LOG_FORMAT` into [{ hash, subject, time }] (time in seconds). */
export function parseLog(text) {
  return String(text ?? "").split("\n").filter(Boolean).map((line) => {
    const [hash, subject, time] = line.split("\x1f");
    return { hash, subject: subject ?? "", time: Number(time) || 0 };
  });
}

/** "now", "5m", "3h", "2d", "6w" since `time` (seconds). */
export function ago(time, now = Date.now() / 1000) {
  const s = Math.max(0, now - time);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 7))}w`;
}

// --- One commit (R8a) ---

/** `git show -s --format=COMMIT_FORMAT <hash>` into { hash, author, email, time, subject, body }. */
export const COMMIT_FORMAT = "%H%x1f%an%x1f%ae%x1f%ct%x1f%B";
export function parseCommit(text) {
  const [hash, author, email, time, ...rest] = String(text ?? "").split("\x1f");
  const message = rest.join("\x1f").replace(/\s+$/, "");
  const nl = message.indexOf("\n");
  return {
    hash: (hash ?? "").trim(), author: author ?? "", email: email ?? "", time: Number(time) || 0,
    subject: nl < 0 ? message : message.slice(0, nl),
    body: nl < 0 ? "" : message.slice(nl + 1).replace(/^\n+/, ""),
  };
}

/**
 * A commit's files from `git show --format= --name-status -z <hash>` and
 * `git show --format= --numstat -z <hash>`: [{ path, code, orig?, added, removed }].
 */
export function parseCommitFiles(nameStatusZ, numstatZ) {
  const counts = parseNumstat(numstatZ);
  const out = [];
  const t = String(nameStatusZ ?? "").split("\0");
  for (let i = 0; i < t.length; i++) {
    const code = t[i];
    if (!code) continue;
    const kind = code[0];
    if (kind === "R" || kind === "C") {
      const orig = t[++i], path = t[++i];
      if (path) out.push({ path, code: kind, orig, ...(counts[path] ?? { added: null, removed: null }) });
    } else {
      const path = t[++i];
      if (path) out.push({ path, code: letter(kind), ...(counts[path] ?? { added: null, removed: null }) });
    }
  }
  return out;
}

// --- Keys (R9) ---

const KEYS = {
  j: "down", down: "down", k: "up", up: "up",
  space: "toggle", " ": "toggle", a: "all", c: "commit",
  p: "pull", P: "push", f: "fetch", r: "refresh", w: "worktrees",
  "?": "help", enter: "diff", o: "open", e: "edit", F: "follow", escape: "escape",
};

/** Writing actions, refused while the worktree is locked (R11a). */
export const WRITES = new Set(["toggle", "all", "commit", "pull", "push", "fetch"]);

export function gitKeyAction(e) {
  const m = e?.modifiers ?? {};
  if (m.control || m.platform || m.alt || m.function) return null;
  const typed = e?.key_char && e.key_char.length === 1 ? e.key_char : null;
  return KEYS[typed ?? ""] ?? KEYS[e?.key ?? ""] ?? null;
}
