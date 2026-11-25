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
