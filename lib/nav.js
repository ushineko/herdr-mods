// nav's pure helpers (spec 002): paths and breadcrumbs (POSIX and Windows), folder
// listings, sorting and filtering, git marks, and the key map. No herdr imports.

/** { root, parts, sep } for "/a/b", "C:\\a\\b" or "C:/a/b". root: "/" or "C:\\" (with the path's separator). */
export function splitPath(path) {
  const p = String(path ?? "");
  const drive = /^([A-Za-z]:)([\\/]|$)/.exec(p);
  if (drive) {
    const sep = p.includes("\\") ? "\\" : "/";
    return { root: drive[1] + sep, parts: p.slice(drive[0].length).split(/[\\/]+/).filter(Boolean), sep };
  }
  return { root: "/", parts: p.split("/").filter(Boolean), sep: "/" };
}

export function joinPath(root, parts, sep = "/") {
  return root + parts.join(sep);
}

/** The folder above `path`, or `path` itself at its root. */
export function parentOf(path) {
  const { root, parts, sep } = splitPath(path);
  return joinPath(root, parts.slice(0, -1), sep);
}

export function childOf(path, name) {
  const { root, parts, sep } = splitPath(path);
  return joinPath(root, [...parts, name], sep);
}

const same = (a, b, windows) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);

/**
 * Breadcrumb segments for `path`, as [{ label, path }]: under `home` it starts with "~",
 * else with the root ("/" or "C:").
 */
export function breadcrumb(path, home) {
  const at = splitPath(path), h = home ? splitPath(home) : null;
  const windows = at.root !== "/";
  const crumbs = [];
  let start = 0;
  if (h && same(h.root, at.root, windows) && h.parts.length <= at.parts.length
      && h.parts.every((part, i) => same(part, at.parts[i], windows))) {
    crumbs.push({ label: "~", path: joinPath(at.root, at.parts.slice(0, h.parts.length), at.sep) });
    start = h.parts.length;
  } else {
    crumbs.push({ label: windows ? at.root.slice(0, 2) : "/", path: at.root });
  }
  for (let i = start; i < at.parts.length; i++) {
    crumbs.push({ label: at.parts[i], path: joinPath(at.root, at.parts.slice(0, i + 1), at.sep) });
  }
  return crumbs;
}

/** NUL-separated kind/name pairs ("d"/"f") into { entries: [{ name, dir }], overflow }. */
export function parseListing(stdout, limit) {
  const fields = String(stdout ?? "").split("\0");
  const entries = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (!fields[i + 1] || fields[i + 1] === ".git") continue;
    entries.push({ name: fields[i + 1], dir: fields[i] === "d" });
  }
  const overflow = entries.length > limit;
  return { entries: overflow ? entries.slice(0, limit) : entries, overflow };
}

const hidden = (name) => name.startsWith(".");

/** Folders first, then files, each case-insensitively by name; dotfiles only with `showHidden`. */
export function sortEntries(entries, showHidden = false) {
  return entries
    .filter((e) => showHidden || !hidden(e.name))
    .slice()
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.name.localeCompare(b.name));
}

/** Entries whose name contains `query` (case-insensitive). */
export function filterEntries(entries, query) {
  const q = String(query ?? "").toLowerCase();
  return q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries;
}

/**
 * `git status --porcelain=v1 -z --no-renames` into [{ path, mark }], paths relative to
 * the repository root with "/". mark: "M" modified, "A" added, "D" deleted, "U" conflict, "?" untracked.
 */
export function parsePorcelain(z) {
  const out = [];
  for (const record of String(z ?? "").split("\0")) {
    if (record.length < 4) continue;
    const xy = record.slice(0, 2), path = record.slice(3);
    let mark;
    if (xy === "??") mark = "?";
    else if (xy.includes("U") || xy === "AA" || xy === "DD") mark = "U";
    else if (xy.includes("D")) mark = "D";
    else if (xy.includes("A")) mark = "A";
    else mark = "M";
    out.push({ path, mark });
  }
  return out;
}

const slashes = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "");

/**
 * Marks for one folder's entries: { files: { name: mark }, folders: { name: changedCount } }.
 * `root` is the repository root, `folder` the folder shown (absolute, either separator).
 */
export function marksFor(changes, root, folder) {
  const r = slashes(root), f = slashes(folder);
  const windows = /^[A-Za-z]:/.test(r);
  const files = {}, folders = {};
  let rel;
  if (same(f, r, windows)) rel = "";
  else if ((windows ? f.toLowerCase() : f).startsWith((windows ? r.toLowerCase() : r) + "/")) rel = f.slice(r.length + 1);
  else return { files, folders };
  const prefix = rel ? rel + "/" : "";
  for (const { path, mark } of changes) {
    const p = path.replace(/\/$/, "");
    if (prefix && !(windows ? p.toLowerCase() : p).startsWith(windows ? prefix.toLowerCase() : prefix)) continue;
    const rest = p.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) files[rest] = mark;
    else {
      const name = rest.slice(0, slash);
      folders[name] = (folders[name] ?? 0) + 1;
    }
    // An untracked folder comes as "dir/": the folder itself is the change.
    if (path.endsWith("/") && slash < 0) { delete files[rest]; folders[rest] = (folders[rest] ?? 0) + 1; }
  }
  return { files, folders };
}

// Keys (spec 002 R9). By the character typed when there is one, so "G" differs from "g".
const KEYS = {
  j: "down", down: "down", k: "up", up: "up",
  l: "open", enter: "open", right: "open",
  h: "parent", backspace: "parent", left: "parent",
  g: "top", G: "bottom", home: "top", end: "bottom",
  ".": "hidden", F: "follow", "/": "filter",
  y: "copy", o: "system", e: "external", escape: "escape",
};

/** The action for a key event ({ key, key_char, modifiers }), or null. */
export function keyAction(e) {
  const m = e?.modifiers ?? {};
  if (m.control || m.platform || m.alt || m.function) return null;
  const typed = e?.key_char && e.key_char.length === 1 ? e.key_char : null;
  return KEYS[typed ?? ""] ?? KEYS[e?.key ?? ""] ?? null;
}

/**
 * The list's columns, filled as `ls` does: `n` entries, `fit` rows that fit the
 * block's height, at most `most` columns side by side. Each column is filled to the
 * foot of the block before the next starts; past `most` columns, the columns grow
 * longer and the list scrolls.
 * Returns { cols, rows, cells }: `cells` in the grid's reading order (left to right,
 * then down, as a wrapping row lays them out), each an entry's index or null (a gap
 * in the last column).
 */
export function columnLayout(n, fit, most) {
  const rows = Math.max(1, Math.min(n, Math.max(fit, Math.ceil(n / Math.max(1, most)))));
  const cols = Math.ceil(n / rows) || 1;
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(c * rows + r < n ? c * rows + r : null);
  return { cols, rows, cells };
}

/**
 * A file's details from the details script's output (one line, fields split by "|":
 * size, modified in Unix seconds, mode, owner, group, link target, item count), or
 * null. Empty fields are null; a folder's size is left out (it says nothing).
 */
export function parseDetails(text) {
  const f = String(text ?? "").replace(/\r?\n$/, "").split("|");
  if (f.length < 7) return null;
  const [size, mtime, mode, owner, group, link] = f;
  const count = f.slice(6).join("|");
  const num = (s) => (/^\d+$/.test(String(s).trim()) ? Number(s) : null);
  const dir = count !== "";
  return {
    size: dir ? null : num(size),
    modified: num(mtime) === null ? null : num(mtime) * 1000,
    mode: mode || null, owner: owner || null, group: group || null,
    link: link || null, count: dir ? num(count) : null,
  };
}

const UNITS = ["KB", "MB", "GB", "TB"];
/** Bytes for people: "512 bytes", "1.2 KB", "34 MB" (1000s, as file managers show). */
export function sizeText(bytes) {
  if (!(bytes >= 1000)) return `${bytes ?? 0} byte${bytes === 1 ? "" : "s"}`;
  let v = bytes, u = -1;
  while (v >= 1000 && u < UNITS.length - 1) { v /= 1000; u++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${UNITS[u]}`;
}

/** A time as "2026-11-27 14:05" (local), with how long ago from `now`: "3 h ago". */
export function whenText(ms, now = Date.now()) {
  const d = new Date(ms), p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const s = Math.max(0, Math.round((now - ms) / 1000));
  const ago = s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago`
    : s < 86400 * 60 ? `${Math.floor(s / 86400)} d ago` : null;
  return ago ? `${stamp} · ${ago}` : stamp;
}
