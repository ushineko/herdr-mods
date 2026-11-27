import { test } from "node:test";
import assert from "node:assert/strict";
import { notebookToMarkdown, base64 } from "../lib/notebook.js";

const nb = {
  metadata: { language_info: { name: "python" } },
  cells: [
    { cell_type: "markdown", source: ["# Title\n", "Some *text*."] },
    { cell_type: "code", execution_count: 3, source: ["print('hi')\n", "1 + 1"], outputs: [
      { output_type: "stream", name: "stdout", text: ["hi\n"] },
      { output_type: "execute_result", data: { "text/plain": ["2"] } },
    ] },
    { cell_type: "code", execution_count: 4, source: "plot()", outputs: [
      { output_type: "display_data", data: { "image/png": "iVBORw0KGgo=\n", "text/plain": "<Figure>" } },
      { output_type: "error", ename: "ValueError", evalue: "bad", traceback: ["\u001b[0;31mValueError\u001b[0m: bad"] },
    ] },
  ],
};

test("notebookToMarkdown: Markdown cells, code with In [n], text, results, pictures, errors without ANSI", () => {
  const { markdown, images } = notebookToMarkdown(nb);
  assert.equal(markdown, [
    "# Title\nSome *text*.",
    "**In [3]:**", "```python\nprint('hi')\n1 + 1\n```",
    "```\nhi\n```", "```\n2\n```",
    "**In [4]:**", "```python\nplot()\n```",
    "![output](nbimg:0)", "```\nValueError: bad\n```",
  ].join("\n\n") + "\n");
  assert.deepEqual(images, [{ ext: "png", data: "iVBORw0KGgo=" }]);
});

test("notebookToMarkdown: a fence longer than backticks in the code; SVG pictures encoded; empty cells skipped", () => {
  const { markdown, images } = notebookToMarkdown({ cells: [
    { cell_type: "code", source: "s = '```'", outputs: [{ output_type: "display_data", data: { "image/svg+xml": ["<svg/>"] } }] },
    { cell_type: "markdown", source: "   " },
  ] });
  assert.match(markdown, /^\*\*In \[ \]:\*\*\n\n````\ns = '```'\n````/);
  assert.deepEqual(images, [{ ext: "svg", data: base64("<svg/>") }]);
});

test("base64: UTF-8 text, any length", () => {
  for (const s of ["", "a", "ab", "abc", "héllo ✓"]) assert.equal(base64(s), Buffer.from(s, "utf8").toString("base64"));
});
