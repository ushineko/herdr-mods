import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPath, parentOf, childOf, breadcrumb, parseListing, sortEntries, filterEntries, parsePorcelain, marksFor, keyAction } from "../lib/nav.js";

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
