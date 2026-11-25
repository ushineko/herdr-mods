import { test } from "node:test";
import assert from "node:assert/strict";
import { fileType, extension, baseName, isBinary, bounded, lineCount } from "../lib/filetype.js";

test("markdown extensions", () => {
  for (const p of ["/a/README.md", "/a/b.markdown", "x.mdx", "NOTES.MD"]) {
    assert.deepEqual(fileType(p), { kind: "markdown", lang: "markdown" }, p);
  }
});

test("images", () => {
  for (const p of ["a.png", "a.JPG", "a.jpeg", "a.gif", "a.webp", "icon.svg"]) {
    assert.equal(fileType(p).kind, "image", p);
  }
});

test("code: extensions map to editor languages", () => {
  const cases = {
    "main.go": "go", "lib.rs": "rs", "x.py": "py", "s.sh": "sh", "s.zsh": "sh",
    "a.ts": "js", "a.tsx": "js", "a.mjs": "js", "c.json": "json", "c.jsonc": "json",
    "c.yml": "yaml", "Cargo.toml": "yaml", "i.html": "html", "s.css": "css",
    "m.c": "c", "m.h": "c", "m.hpp": "cpp", "J.java": "java", "r.rb": "rb",
    "l.lua": "lua", "q.sql": "sql",
  };
  for (const [p, lang] of Object.entries(cases)) {
    assert.deepEqual(fileType(p), { kind: "code", lang }, p);
  }
});

test("code: names without an extension", () => {
  assert.deepEqual(fileType("/r/Dockerfile"), { kind: "code", lang: "dockerfile" });
  assert.deepEqual(fileType("/r/Makefile"), { kind: "code", lang: "make" });
  assert.deepEqual(fileType("/r/PKGBUILD"), { kind: "code", lang: "sh" });
  assert.deepEqual(fileType("/home/u/.zshrc"), { kind: "code", lang: "sh" });
});

test("unknown and extensionless files are text", () => {
  assert.deepEqual(fileType("/a/LICENSE"), { kind: "text", lang: null });
  assert.deepEqual(fileType("/a/data.weird"), { kind: "text", lang: null });
  // A leading dot is a hidden file, not an extension.
  assert.equal(extension("/a/.hidden"), "");
});

test("baseName handles both separators", () => {
  assert.equal(baseName("/a/b/c.txt"), "c.txt");
  assert.equal(baseName("C:\\a\\b.md"), "b.md");
});

test("binary detection", () => {
  assert.equal(isBinary("abc\0def"), true);
  assert.equal(isBinary("plain text"), false);
  assert.equal(isBinary(null), false);
});

test("bounded cuts at a line end and says so", () => {
  assert.deepEqual(bounded("short", 100), { text: "short", cut: false });
  const r = bounded("aaa\nbbb\nccc", 9);
  assert.equal(r.cut, true);
  assert.equal(r.text, "aaa\nbbb");
});

test("lineCount", () => {
  assert.equal(lineCount(""), 0);
  assert.equal(lineCount("a"), 1);
  assert.equal(lineCount("a\n"), 1);
  assert.equal(lineCount("a\nb"), 2);
  assert.equal(lineCount("a\nb\n"), 2);
});
