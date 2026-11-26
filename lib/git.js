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

/** The deepest worktree (by path) containing `folder`, or null. Accepts an index (indexWorktrees). */
export function worktreeOf(folder, worktrees) {
  if (worktrees?.lookup) return worktrees.lookup(folder);
  let best = null;
  for (const w of worktrees) if (within(folder, w.path) && (!best || norm(w.path).length > norm(best.path).length)) best = w;
  return best;
}

/**
 * An index of worktrees for repeated lookups (repositories with many worktrees are
 * looked up on every render): paths normalised once, deepest first.
 * Returns { list, lookup(folder) } where `lookup` gives the deepest worktree containing
 * the folder, or null.
 */
export function indexWorktrees(list) {
  const keyOf = (p) => { const n = norm(p); return windowsPath(n) ? n.toLowerCase() : n; };
  const byDepth = list.map((w) => ({ w, key: keyOf(w.path) })).sort((a, b) => b.key.length - a.key.length);
  return {
    list,
    lookup(folder) {
      if (!folder) return null;
      const f = keyOf(folder);
      for (const { w, key } of byDepth) if (f === key || f.startsWith(key + "/")) return w;
      return null;
    },
  };
}

/**
 * Which worktrees the strip shows (R3), at most `cap`: the shown one, the one
 * `here` is in, those with agents, those with changes, then the rest in order.
 * Returns { rows, hidden } (hidden: how many are left out).
 */
export function visibleWorktrees(list, { shown, here, agents = {}, counts = {}, cap = 12, all = false }) {
  if (all || list.length <= cap) return { rows: list, hidden: 0 };
  const rank = (w) => (w.path === shown ? 0 : w.path === here ? 1 : agents[w.path]?.length ? 2 : counts[w.path] ? 3 : 4);
  const picked = list.map((w, i) => ({ w, i, r: rank(w) })).sort((a, b) => a.r - b.r || a.i - b.i).slice(0, cap)
    .sort((a, b) => a.i - b.i).map((x) => x.w);
  return { rows: picked, hidden: list.length - picked.length };
}

export const WORKTREE_LABEL = "herdr-mods.worktree";

/**
 * Where an agent works (spec 003 R5a): the first signal it has decides, of its
 * label, its program's folder, its terminal's folder. A label or program folder
 * outside these worktrees means the agent works elsewhere: it never falls through
 * to the terminal's folder, which stays where the session started (#13).
 * @returns { worktree, source: "label" | "program" | "terminal" } or null
 */
export function placeAgent({ label, program, terminal }, worktrees) {
  for (const [source, folder] of [["label", label], ["program", program], ["terminal", terminal]]) {
    if (!folder) continue;
    const worktree = worktreeOf(folder, worktrees);
    return worktree ? { worktree, source } : null;
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

export const LOG_FORMAT = "%h%x1f%s%x1f%ct%x1f%an";

/** `git log -n5 --format=LOG_FORMAT` into [{ hash, subject, time, author }] (time in seconds). */
export function parseLog(text) {
  return String(text ?? "").split("\n").filter(Boolean).map((line) => {
    const [hash, subject, time, author] = line.split("\x1f");
    return { hash, subject: subject ?? "", time: Number(time) || 0, author: author ?? "" };
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
/**
 * A commit message's body as blocks to draw, for a proportional font: the hard wraps
 * of a paragraph (git's 72 columns) are joined so the text fills the width. Kept as
 * they are: list items (`- `, `* `, `+ `, `1. `, `1) `; their wrapped lines join the
 * item), indented or fenced lines (code), trailers (`Closes #41`, `Signed-off-by: x`),
 * and lines that end in two spaces. Blank lines separate blocks.
 *   { kind: "para", text } | { kind: "item", marker, text, depth } | { kind: "pre", text } | { kind: "line", text }
 */
const ITEM = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const TRAILER = /^(?:[A-Z][a-z]+(?:-[A-Za-z]+)+: \S|(?:Closes|Fixes|Resolves|Refs) #?\w)/;
export function reflowMessage(body) {
  const lines = String(body ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let open = null; // the para or item that the next plain line continues
  let fence = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (fence) {
      fence.text += "\n" + raw;
      if (/^\s*(```|~~~)/.test(raw)) fence = null;
      continue;
    }
    if (/^\s*(```|~~~)/.test(raw)) { fence = { kind: "pre", text: raw }; out.push(fence); open = null; continue; }
    if (!line.trim()) { open = null; continue; }
    const item = ITEM.exec(line);
    if (item) {
      open = { kind: "item", marker: /\d/.test(item[2]) ? item[2] : "•", text: item[3], depth: item[1].length >= 2 ? 1 : 0 };
      out.push(open);
      continue;
    }
    const indent = /^(\t| {4})/.test(raw);
    if (indent && !(open?.kind === "item")) {
      const last = out.at(-1);
      if (last?.kind === "pre" && open === last) last.text += "\n" + raw;
      else { open = { kind: "pre", text: raw }; out.push(open); }
      continue;
    }
    if (TRAILER.test(line) && !open) { out.push({ kind: "line", text: line }); continue; }
    if (open && (open.kind === "para" || open.kind === "item") && !open.hard) {
      open.text += " " + line.trim();
    } else {
      open = { kind: "para", text: line.trim() };
      out.push(open);
    }
    if (/ {2}$/.test(raw)) open.hard = true;
  }
  for (const b of out) delete b.hard;
  return out;
}

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

// --- Worktree clean-up (spec 007) ---

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "tcsh", "csh", "nu", "pwsh", "powershell", "pwsh.exe", "powershell.exe", "cmd.exe"]);
const POWERSHELL = new Set(["pwsh", "powershell", "pwsh.exe", "powershell.exe"]);

/** True when a foreground program name is a shell at its prompt. */
export const isShell = (name) => SHELLS.has(String(name ?? "").split(/[\\/]/).pop().replace(/^-/, "").toLowerCase());

/** The line typed into a shell to leave a worktree: ` cd '<folder>'` (leading space: kept out of history). */
export function cdCommand(folder, shell) {
  const name = String(shell ?? "").split(/[\\/]/).pop().toLowerCase();
  const quoted = POWERSHELL.has(name) ? `'${folder.replace(/'/g, "''")}'` : `'${folder.replace(/'/g, "'\\''")}'`;
  return ` cd ${quoted}`;
}

const parentOf = (p) => { const n = String(p).replace(/[\\/]+$/, ""); const i = Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\")); return i > 0 ? n.slice(0, i) : n; };

/**
 * Which worktrees can go (spec 007 R2). Each input: { path, main, locked, branch,
 * detached, changes (count), upstream, ahead, behind, onRemote (detached: HEAD on a
 * remote branch, named by remoteRef), agents: [name], terminals: [{ address, program }],
 * last: { hash, subject, time }, foreign: a path inside owned by another user, or null }.
 * Returns [{ path, branch, eligible, reason, why, fix, parent, last, shells: [{ address, cmd }] }]:
 * `why` says what makes an eligible one safe to remove, `reason` why one is kept, and
 * `fix` a command that clears the reason when there is one (another user's files).
 * A kept one also gets `force` (spec 007 R3e, "Really remove…"): { allowed: false,
 * refused } when it is in use or cannot be deleted, else { allowed: true, lost: [what
 * --force discards], kept: [what survives], locked, shells }.
 */
export function planCleanup(items) {
  return items.map((w) => {
    const parent = parentOf(w.path);
    const out = { path: w.path, branch: w.branch ?? null, parent, eligible: false, reason: null, why: null, fix: null, last: w.last ?? null, shells: [] };
    const busy = (w.terminals ?? []).filter((t) => !isShell(t.program));
    if (w.main) out.reason = "the main worktree";
    else if (w.locked) out.reason = "locked";
    else if (w.changes > 0) out.reason = `${w.changes} uncommitted change${w.changes === 1 ? "" : "s"}`;
    else if (w.detached && !w.onRemote) out.reason = "detached HEAD not on any remote branch";
    else if (!w.detached && !w.upstream) out.reason = "never pushed (no upstream)";
    else if (!w.detached && w.ahead > 0) out.reason = `${w.ahead} commit${w.ahead === 1 ? "" : "s"} not pushed`;
    else if ((w.agents ?? []).length) out.reason = `agent in use: ${w.agents.join(", ")}`;
    else if (w.foreign) out.reason = `contains files owned by ${foreignOf(w).owner} (e.g. ${foreignWhere(w)}); git cannot delete them. Fix ownership, or run:`;
    else if (busy.length) out.reason = `in use: ${busy.map((t) => `${t.program} (${t.address})`).join(", ")}`;
    else {
      out.eligible = true;
      const behind = w.behind > 0 ? ` (${w.behind} behind)` : "";
      out.why = w.detached ? `clean · commit is on ${w.remoteRef ?? "a remote branch"}` : `clean · pushed to ${w.upstream}${behind}`;
      out.shells = (w.terminals ?? []).map((t) => ({ address: t.address, cmd: cdCommand(parent, t.program) }));
    }
    // Another user's files, whatever else keeps it: Fix ownership is offered on the card.
    if (w.foreign) { out.owner = foreignOf(w).owner; out.fix = `sudo chown -R "$USER" -- ${shq(w.path)}`; }
    if (!out.eligible) out.force = forcePlan(w, parent, busy);
    return out;
  });
}

const foreignOf = (w) => (typeof w.foreign === "string" ? { path: w.foreign, owner: "another user" } : w.foreign);
const foreignWhere = (w) => { const f = foreignOf(w); return f.path.startsWith(w.path) ? "…" + f.path.slice(w.path.length) : f.path; };

// What removing a kept worktree anyway would cost, or why it is still refused: a
// worktree in use (main, an agent, a program) is not stale, and another user's files
// is handed back first (Docker), since git cannot delete it even with --force.
function forcePlan(w, parent, busy) {
  const n = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  if (w.main) return { allowed: false, refused: "the main worktree is never removed" };
  if ((w.agents ?? []).length) return { allowed: false, refused: `an agent is working in it (${w.agents.join(", ")})` };
  if (busy.length) return { allowed: false, refused: `${busy.map((t) => `${t.program} (${t.address})`).join(", ")} running in it; close ${busy.length === 1 ? "it" : "them"} first` };
  const lost = [], kept = [];
  if (w.changes > 0) lost.push(`${n(w.changes, "uncommitted change")} (untracked files included)`);
  if (w.detached && !w.onRemote) lost.push(`commit ${w.last?.hash ?? "HEAD"} is on no branch or remote`);
  if (!w.detached && !w.upstream) kept.push(`branch ${w.branch} keeps its commits (it was never pushed)`);
  else if (!w.detached && w.ahead > 0) kept.push(`branch ${w.branch} keeps its ${n(w.ahead, "unpushed commit")}`);
  else if (!w.detached) kept.push(`branch ${w.branch} is kept`);
  return {
    allowed: true, lost, kept, locked: Boolean(w.locked), chown: w.foreign ? foreignOf(w).owner : null,
    shells: (w.terminals ?? []).map((t) => ({ address: t.address, cmd: cdCommand(parent, t.program) })),
  };
}

/** `git worktree remove` arguments; force twice for a locked worktree, as git requires. */
export const removeArgs = (root, path, { force = false, locked = false } = {}) =>
  ["-C", root, "worktree", "remove", ...(force ? (locked ? ["--force", "--force"] : ["--force"]) : []), path];

/**
 * One sh round trip for the clean-up checks of many worktrees (spec 007): per
 * worktree, U+001E path U+001D status (porcelain v2, -z) U+001D latest commit
 * (LOG_FORMAT) U+001D "a remote branch" when a detached HEAD is on one. Eight at a
 * time, each into its own file of a temp folder (removed on exit), printed in order.
 * "On a remote" asks rev-list for a commit not reachable from any remote ref, which
 * stops early; `branch -r --contains` tested each of 2871 refs (~1.1 s a worktree).
 */
export const CLEANUP_SCAN_SH = `d=$(mktemp -d "\${TMPDIR:-/tmp}/herdr-scan.XXXXXX") || exit 1
trap 'rm -rf -- "$d"' EXIT
i=0; for w; do i=$((i+1)); printf '%s\\0%s\\0' "$i" "$w"; done | xargs -0 -n 2 -P 8 sh -c '
  w=$2
  {
    printf "\\036%s\\035" "$w"
    git -C "$w" --no-optional-locks -c core.fsmonitor=false status --porcelain=v2 --branch -z --untracked-files=normal 2>/dev/null
    printf "\\035"
    git -C "$w" --no-optional-locks log -1 --format="%h%x1f%s%x1f%ct" 2>/dev/null
    printf "\\035"
    if ! git -C "$w" symbolic-ref -q HEAD >/dev/null 2>&1; then
      o=$(git -C "$w" --no-optional-locks rev-list -n 1 HEAD --not --remotes 2>/dev/null) && [ -z "$o" ] && echo "a remote branch"
    fi
  } > "$0/$1"' "$d"
i=0; for w; do i=$((i+1)); cat "$d/$i" 2>/dev/null; done`;

/**
 * Per worktree, the first path inside not owned by the running user (root-owned
 * __pycache__ from a container or sudo run): git cannot delete those, and a remove
 * that hits one fails half done (the worktree is unregistered, the folder stays).
 * Output: "<worktree>\t<path or empty>" lines.
 */
export const FOREIGN_SCAN_SH = `u=$(id -u)
for w; do
  f=$(find "$w" ! -user "$u" -print -quit 2>/dev/null); o=
  [ -n "$f" ] && o=$(stat -c %U "$f" 2>/dev/null || stat -f %Su "$f" 2>/dev/null)
  printf '%s\\t%s\\t%s\\n' "$w" "$f" "$o"
done`;

/**
 * Before Fix ownership: Docker must be the default setup, where a container's root
 * is the host's root; anything else is refused rather than handled (operator's call,
 * 2026-11-25): rootless or user-namespace-remapped Docker would map the chown to
 * another uid, Podman likewise, SELinux blocks the bind mount, and Docker Desktop
 * runs in a VM with its own file ownership. Exit 3 and one line why, or exit 0.
 */
export const DOCKER_PREFLIGHT_SH = `refuse() { echo "refused: $*; use the sudo command instead" >&2; exit 3; }
[ "$(uname -s)" = Linux ] || refuse "not Linux"
command -v docker >/dev/null 2>&1 || refuse "docker is not installed"
info=$(docker info --format '{{.OperatingSystem}}|{{json .SecurityOptions}}' 2>&1) || refuse "docker cannot be reached ($(printf '%s' "$info" | tail -n 1))"
case "$info" in *"Docker Desktop"*) refuse "Docker Desktop";; esac
case "$info" in *rootless*) refuse "Docker runs rootless";; esac
case "$info" in *userns*) refuse "Docker remaps user namespaces";; esac
case "$info" in *selinux*) refuse "SELinux is on for Docker";; esac
docker version --format '{{range .Server.Components}}{{.Name}};{{end}}' 2>/dev/null | grep -qi podman && refuse "this is Podman, not Docker"
docker image inspect alpine >/dev/null 2>&1 || refuse "the alpine image is not on this machine"
exit 0`;

/**
 * Hands a folder's files back to the running user through Docker, which made them
 * (root in a container writing to a mapped volume): no sudo, only the docker group.
 * Uses the local alpine image and never pulls one. $1 is the folder.
 */
export const DOCKER_CHOWN_SH = `case "$1" in *,*) echo "a path with a comma cannot be mounted: $1" >&2; exit 2;; esac
exec docker run --rm --pull never --network none --mount "type=bind,source=$1,target=/w" alpine chown -R "$(id -u):$(id -g)" /w`;

/** FOREIGN_SCAN_SH's output into { [worktree]: { path, owner } | null }. */
export function parseForeignScan(stdout) {
  const out = {};
  for (const line of String(stdout ?? "").split("\n")) {
    const [w, path, owner] = line.split("\t");
    if (!w || path === undefined) continue;
    out[w] = path.trim() ? { path: path.trim(), owner: (owner ?? "").trim() || "another user" } : null;
  }
  return out;
}

const shq = (p) => `'${String(p).replace(/'/g, "'\\''")}'`;

/** CLEANUP_SCAN_SH's output into { [path]: { status, last, remoteRef } } (status: parseStatus, or null). */
export function parseCleanupScan(stdout) {
  const out = {};
  for (const rec of String(stdout ?? "").split("\x1e")) {
    if (!rec) continue;
    const [path, status, log, remote] = rec.split("\x1d");
    if (!path) continue;
    out[path] = {
      status: status ? parseStatus(status) : null,
      last: parseLog((log ?? "").trim())[0] ?? null,
      remoteRef: (remote ?? "").trim() || null,
    };
  }
  return out;
}

// --- Keys (R9) ---

const KEYS = {
  j: "down", down: "down", k: "up", up: "up",
  space: "toggle", " ": "toggle", a: "all", c: "commit",
  p: "pull", P: "push", f: "fetch", r: "refresh", w: "worktrees",
  "?": "help", enter: "diff", o: "open", e: "edit", F: "follow", escape: "escape",
  "-": "font-smaller", "=": "font-bigger", "+": "font-bigger", "0": "font-reset",
};

/** Writing actions, refused while the worktree is locked (R11a). */
export const WRITES = new Set(["toggle", "all", "commit", "pull", "push", "fetch"]);

export function gitKeyAction(e) {
  const m = e?.modifiers ?? {};
  if (m.control || m.platform || m.alt || m.function) return null;
  const typed = e?.key_char && e.key_char.length === 1 ? e.key_char : null;
  return KEYS[typed ?? ""] ?? KEYS[e?.key ?? ""] ?? null;
}
