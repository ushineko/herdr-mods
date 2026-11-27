import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPath, parentOf, childOf, breadcrumb, parseListing, sortEntries, filterEntries, parsePorcelain, marksFor, keyAction, columnLayout, parseDetails, sizeText, whenText } from "../lib/nav.js";

test("splitPath: POSIX and Windows", () => {
  assert.deepEqual(splitPath("/a/b"), { root: "/", parts: ["a", "b"], sep: "/" });
  assert.deepEqual(splitPath("/"), { root: "/", parts: [], sep: "/" });
  assert.deepEqual(splitPath("C:\\Users\\nvere"), { root: "C:\\", parts: ["Users", "nvere"], sep: "\\" });
  assert.deepEqual(splitPath("C:/Users/nvere/"), { root: "C:/", parts: ["Users", "nvere"], sep: "/" });
  assert.deepEqual(splitPath("C:\\"), { root: "C:\\", parts: [], sep: "\\" });
});

test("parentOf and childOf keep the separator; the root is its own parent", () => {
  assert.equal(parentOf("/a/b"), "/a");
  assert.equal(parentOf("/a"), "/");
  assert.equal(parentOf("/"), "/");
  assert.equal(parentOf("C:\\a\\b"), "C:\\a");
  assert.equal(parentOf("C:\\a"), "C:\\");
  assert.equal(childOf("/a", "b c"), "/a/b c");
  assert.equal(childOf("C:\\a", "b"), "C:\\a\\b");
  assert.equal(childOf("/", "etc"), "/etc");
});

test("breadcrumb under home starts with ~", () => {
  assert.deepEqual(breadcrumb("/Users/n/git/x", "/Users/n"), [
    { label: "~", path: "/Users/n" },
    { label: "git", path: "/Users/n/git" },
    { label: "x", path: "/Users/n/git/x" },
  ]);
  assert.deepEqual(breadcrumb("/Users/n", "/Users/n"), [{ label: "~", path: "/Users/n" }]);
});

test("breadcrumb outside home starts at the root; a sibling with a shared prefix is not home", () => {
  assert.deepEqual(breadcrumb("/etc/x", "/Users/n"), [
    { label: "/", path: "/" }, { label: "etc", path: "/etc" }, { label: "x", path: "/etc/x" },
  ]);
  assert.equal(breadcrumb("/Users/nn/a", "/Users/n")[0].label, "/");
});

test("breadcrumb on Windows: drive root, home case-insensitive", () => {
  assert.deepEqual(breadcrumb("C:\\Users\\nvere\\git", "c:\\users\\nvere").map((c) => c.label), ["~", "git"]);
  assert.deepEqual(breadcrumb("D:\\data", "C:\\Users\\nvere"), [
    { label: "D:", path: "D:\\" }, { label: "data", path: "D:\\data" },
  ]);
});

test("parseListing: pairs, .git skipped, overflow past the limit", () => {
  const out = "d\0src\0f\0README.md\0d\0.git\0f\0.env\0";
  assert.deepEqual(parseListing(out, 500), {
    entries: [{ name: "src", dir: true }, { name: "README.md", dir: false }, { name: ".env", dir: false }],
    overflow: false,
  });
  const many = Array.from({ length: 4 }, (_, i) => `f\0f${i}\0`).join("");
  assert.deepEqual(parseListing(many, 3).overflow, true);
  assert.equal(parseListing(many, 3).entries.length, 3);
  assert.deepEqual(parseListing("", 10), { entries: [], overflow: false });
});

test("sortEntries: folders first, case-insensitive, dotfiles hidden unless asked", () => {
  const entries = [
    { name: "b.txt", dir: false }, { name: "A.txt", dir: false }, { name: "zeta", dir: true },
    { name: "Alpha", dir: true }, { name: ".env", dir: false }, { name: ".config", dir: true },
  ];
  assert.deepEqual(sortEntries(entries).map((e) => e.name), ["Alpha", "zeta", "A.txt", "b.txt"]);
  assert.deepEqual(sortEntries(entries, true).map((e) => e.name), [".config", "Alpha", "zeta", ".env", "A.txt", "b.txt"]);
});

test("filterEntries: substring, case-insensitive; empty query keeps all", () => {
  const entries = [{ name: "README.md" }, { name: "src" }, { name: "readme-old.txt" }];
  assert.deepEqual(filterEntries(entries, "readme").map((e) => e.name), ["README.md", "readme-old.txt"]);
  assert.equal(filterEntries(entries, "").length, 3);
});

test("parsePorcelain: marks", () => {
  const z = [" M a.js", "M  b.js", "A  c.js", " D d.js", "UU e.js", "?? new/", "?? f.txt", "AM g.js", ""].join("\0");
  assert.deepEqual(parsePorcelain(z), [
    { path: "a.js", mark: "M" }, { path: "b.js", mark: "M" }, { path: "c.js", mark: "A" },
    { path: "d.js", mark: "D" }, { path: "e.js", mark: "U" }, { path: "new/", mark: "?" },
    { path: "f.txt", mark: "?" }, { path: "g.js", mark: "A" },
  ]);
});

test("marksFor: files in the folder get marks, sub-folders get counts", () => {
  const changes = parsePorcelain(["  M src/a.js", "?? src/lib/x.js", " M src/lib/y.js", " M top.md", "?? src/new/", ""].join("\0").replace(/^ {2}/, " "));
  assert.deepEqual(marksFor(changes, "/r", "/r"), { files: { "top.md": "M" }, folders: { src: 4 } });
  assert.deepEqual(marksFor(changes, "/r", "/r/src"), { files: { "a.js": "M" }, folders: { lib: 2, new: 1 } });
  assert.deepEqual(marksFor(changes, "/r", "/r/src/lib"), { files: { "x.js": "?", "y.js": "M" }, folders: {} });
});

test("marksFor: outside the repository, and a sibling with a shared prefix, gets nothing", () => {
  const changes = [{ path: "a.js", mark: "M" }];
  assert.deepEqual(marksFor(changes, "/r", "/other"), { files: {}, folders: {} });
  assert.deepEqual(marksFor(changes, "/r", "/rr"), { files: {}, folders: {} });
});

test("marksFor: Windows roots from git use forward slashes; the folder may use backslashes", () => {
  const changes = [{ path: "src/a.js", mark: "M" }];
  assert.deepEqual(marksFor(changes, "C:/Users/n/repo", "C:\\Users\\n\\repo\\src"), { files: { "a.js": "M" }, folders: {} });
});

test("keyAction: yazi-style keys, shift by character, modifiers ignored", () => {
  assert.equal(keyAction({ key: "j", key_char: "j" }), "down");
  assert.equal(keyAction({ key: "down" }), "down");
  assert.equal(keyAction({ key: "g", key_char: "g" }), "top");
  assert.equal(keyAction({ key: "g", key_char: "G", modifiers: { shift: true } }), "bottom");
  assert.equal(keyAction({ key: "f", key_char: "F", modifiers: { shift: true } }), "follow");
  assert.equal(keyAction({ key: "enter" }), "open");
  assert.equal(keyAction({ key: ".", key_char: "." }), "hidden");
  assert.equal(keyAction({ key: "j", key_char: "j", modifiers: { control: true } }), null);
  assert.equal(keyAction({ key: "q", key_char: "q" }), null);
});

test("columnLayout: each column filled to the foot before the next, as ls does", () => {
  assert.deepEqual(columnLayout(5, 11, 3), { cols: 1, rows: 5, cells: [0, 1, 2, 3, 4] });
  // 16 entries, 11 rows fit: a full column of 11, then 5 in the next.
  const two = columnLayout(16, 11, 3);
  assert.equal(two.cols, 2);
  assert.equal(two.rows, 11);
  assert.deepEqual(two.cells.slice(0, 4), [0, 11, 1, 12]);
  assert.deepEqual(two.cells.slice(-2), [10, null]);
  // Too many to fit: every column there is, longer than the block, and it scrolls.
  assert.deepEqual([columnLayout(100, 10, 3).cols, columnLayout(100, 10, 3).rows], [3, 34]);
  assert.equal(columnLayout(0, 10, 3).cols, 1);
});

test("parseDetails: a file, a folder, a link; nothing for odd output", () => {
  assert.deepEqual(parseDetails("1234|1764280000|-rw-r--r--|n|staff||\n"),
    { size: 1234, modified: 1764280000000, mode: "-rw-r--r--", owner: "n", group: "staff", link: null, count: null });
  const dir = parseDetails("4096|1764280000|drwxr-xr-x|n|staff||17");
  assert.equal(dir.size, null);
  assert.equal(dir.count, 17);
  assert.equal(parseDetails("10|1764280000|-rw-r--r--|n|staff|../a/b.md|").link, "../a/b.md");
  assert.equal(parseDetails("Archive, ReadOnly|x"), null);
  assert.equal(parseDetails(""), null);
});

test("sizeText and whenText", () => {
  assert.equal(sizeText(1), "1 byte");
  assert.equal(sizeText(999), "999 bytes");
  assert.equal(sizeText(1234), "1.2 KB");
  assert.equal(sizeText(34_000_000), "34 MB");
  const at = new Date(2026, 10, 27, 14, 5).getTime();
  assert.equal(whenText(at, at + 3 * 3600_000), "2026-11-27 14:05 · 3 h ago");
  assert.equal(whenText(at, at + 400 * 86400_000), "2026-11-27 14:05");
});
