import { test } from "node:test";
import assert from "node:assert/strict";
import { editorArgv } from "../lib/editor.js";

test("editorArgv: nvim by default, +line for vim-family editors", () => {
  assert.deepEqual(editorArgv("", "/a/b.md"), ["nvim", "/a/b.md"]);
  assert.deepEqual(editorArgv(null, "/a/b.md", 12), ["nvim", "+12", "/a/b.md"]);
  assert.deepEqual(editorArgv("vim", "/a b/c.js", 3), ["vim", "+3", "/a b/c.js"]);
  assert.deepEqual(editorArgv("/opt/homebrew/bin/nvim", "/x", 5), ["/opt/homebrew/bin/nvim", "+5", "/x"]);
  assert.deepEqual(editorArgv("nano", "/x", 2), ["nano", "+2", "/x"]);
});

test("editorArgv: GUI editors lose their wait flag and get no +line", () => {
  assert.deepEqual(editorArgv("code --wait", "/x", 9), ["code", "/x"]);
  assert.deepEqual(editorArgv("subl -w", "/x"), ["subl", "/x"]);
  assert.deepEqual(editorArgv("C:\\Tools\\nvim.exe", "C:\\a.md", 4), ["C:\\Tools\\nvim.exe", "+4", "C:\\a.md"]);
});
