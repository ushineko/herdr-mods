import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDark, mermaidTheme, mermaidFailure, NO_MMDC } from "../lib/mermaid.js";
import { splitBlocks } from "../mods/cria-file-preview/markdown-blocks.js";
import { programs } from "../mods/cria-file-preview/programs.js";

test("splitBlocks: a mermaid fence is a diagram block between the text around it", () => {
  const blocks = splitBlocks("Before\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter\n");
  assert.deepEqual(blocks, [{ text: "Before\n\n" }, { mermaid: { source: "flowchart LR\n  A --> B" } }, { text: "\nAfter\n" }]);
});

test("splitBlocks: tilde and long fences; other fences and nested mermaid stay text", () => {
  assert.deepEqual(splitBlocks("~~~~ mermaid\nsequenceDiagram\n~~~~\n").filter((b) => b.mermaid),
    [{ mermaid: { source: "sequenceDiagram" } }]);
  const nested = splitBlocks("````markdown\n```mermaid\ngraph TD\n```\n````\n");
  assert.ok(!nested.some((b) => b.mermaid), "inside another fence");
  assert.ok(!splitBlocks("```js\nconst a = 1;\n```\n").some((b) => b.mermaid));
  assert.ok(!splitBlocks("```mermaidish\nx\n```\n").some((b) => b.mermaid), "only the word mermaid");
});

test("splitBlocks: an unclosed mermaid fence is left as code", () => {
  const blocks = splitBlocks("Intro\n```mermaid\ngraph TD\n");
  assert.ok(!blocks.some((b) => b.mermaid));
  assert.match(blocks.map((b) => b.text).join(""), /```mermaid\ngraph TD\n/);
});

test("isDark and mermaidTheme follow the background", () => {
  assert.equal(isDark("#1e1e2e"), true);
  assert.equal(isDark("#fff"), false);
  assert.equal(isDark("#fafafa"), false);
  assert.equal(isDark("rgb(1,2,3)"), true, "unknown: dark, the app's default");
  assert.equal(mermaidTheme("#101010"), "dark");
  assert.equal(mermaidTheme("#ffffff"), "default");
});

test("mermaidFailure: not installed, too slow, or Mermaid's own words without the stack", () => {
  assert.equal(mermaidFailure({ code: 127, stderr: `${NO_MMDC}\n` }), "Mermaid isn't installed (mermaid-cli)");
  assert.equal(mermaidFailure({ error: `Error: ${NO_MMDC}` }), "Mermaid isn't installed (mermaid-cli)");
  assert.equal(mermaidFailure({ error: "exec timed out after 30000 ms" }), "Mermaid took too long");
  const stderr = [
    "", "Error: Parse error on line 4:", "...lowchart LR A -->", "--------------------^",
    "Expecting 'AMP', 'COLON', got 'EOF'",
    "Parser.parseError (https://mermaid-cli-intercept.invalid/x.mjs:1561:21)", "    at run (file:///x.js:1:1)",
  ].join("\n");
  assert.equal(mermaidFailure({ code: 1, stderr }), "Parse error on line 4:\n...lowchart LR A -->\n--------------------^\nExpecting 'AMP', 'COLON', got 'EOF'");
  assert.equal(mermaidFailure({ code: 1, stderr: "" }), "Mermaid couldn't draw this diagram");
});

test("programs().mermaid: values travel as arguments, never in the script", () => {
  const source = "graph TD\n  A[\"it's $(rm -rf ~)\"] --> B";
  const [program, args] = programs("linux").mermaid("/d", "k1", "dark", source);
  assert.equal(program, "sh");
  assert.deepEqual(args.slice(2), ["mermaid", "/d", "k1", "dark", source]);
  assert.ok(!args[1].includes("rm -rf"));
  assert.deepEqual(programs("macos").mermaid("/d", "k", "default", "x")[1].slice(3), ["/d", "k", "default", "x"]);
  const [ps, psArgs] = programs("windows").mermaid("C:/d", "k1", "dark", source);
  assert.equal(ps, "powershell");
  assert.ok(!psArgs.join(" ").includes("rm -rf"), "the source goes as character codes");
});

// The real POSIX script with a stand-in mmdc first on PATH: it draws once, then
// reuses the picture; a failure leaves nothing behind.
test("the POSIX script draws once, caches, and reports a failure", { skip: process.platform === "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "mermaid-")), bin = join(root, "bin"), dir = join(root, "cache"), calls = join(root, "calls");
  spawnSync("mkdir", ["-p", bin]);
  writeFileSync(join(bin, "mmdc"), `#!/bin/sh
echo "$@" >> "${calls}"
while [ $# -gt 0 ]; do case $1 in -i) in=$2; shift;; -o) out=$2; shift;; esac; shift; done
grep -q broken "$in" && { echo "Error: Parse error on line 1:" >&2; exit 1; }
cp "$in" "$out"
`);
  chmodSync(join(bin, "mmdc"), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const draw = (key, source) => {
    const [program, args] = programs("linux").mermaid(dir, key, "dark", source);
    return spawnSync(program, args, { encoding: "utf8", env });
  };
  const first = draw("a", "graph TD");
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.trim(), "mermaid-a.png");
  assert.equal(readFileSync(join(dir, "mermaid-a.png"), "utf8"), "graph TD\n");
  assert.equal(draw("a", "graph TD").stdout.trim(), "mermaid-a.png");
  assert.equal(readFileSync(calls, "utf8").trim().split("\n").length, 1, "drawn once");
  assert.match(readFileSync(calls, "utf8"), /-t dark -b transparent -s 2/);
  const bad = draw("b", "broken");
  assert.equal(bad.status, 1);
  assert.match(mermaidFailure({ code: bad.status, stderr: bad.stderr }), /^Parse error on line 1:/);
  assert.ok(!existsSync(join(dir, "mermaid-b.png")));
  assert.deepEqual(readdirSync(dir).sort(), ["mermaid-a.png"], "no temporary files left");
});

test("lib's MERMAID_SH is the viewer's script, unchanged", async () => {
  const { MERMAID_SH } = await import("../lib/mermaid.js");
  assert.equal(MERMAID_SH, programs("linux").mermaid("d", "k", "dark", "s")[1][1]);
});
