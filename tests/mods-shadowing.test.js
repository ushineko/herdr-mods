// A mod must not declare, at its top level, a name it also imports. The chat once
// defined `const fs = …` (a text size helper) beside `import * as fs from
// "fs/promises"`: herdr-app check still passed, but fs.writeFile was gone and every
// image failed to save (#22). This reads every mod's files for such clashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;

/** Names a module imports: default, namespace and named (after `as`). */
export function importedNames(src) {
  const names = [];
  for (const m of src.matchAll(/^\s*import\s+([\s\S]*?)\s+from\s+["'][^"']+["']/gm)) {
    const clause = m[1].replace(/\/\/.*$/gm, "");
    const named = /\{([\s\S]*)\}/.exec(clause);
    if (named) {
      for (const part of named[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) names.push(name);
      }
    }
    const rest = clause.replace(/\{[\s\S]*\}/, "");
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(rest);
    if (ns) names.push(ns[1]);
    const def = /^\s*([A-Za-z_$][\w$]*)\s*(,|$)/.exec(rest);
    if (def) names.push(def[1]);
  }
  return names;
}

/** Names declared at the top level (no indentation): const/let/var, function, class. */
export function topLevelNames(src) {
  const names = [];
  for (const m of src.matchAll(/^(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+([^=;]+)/gm)) {
    // `const a = 1, b = 2` and `let x;`: the first name; destructuring is skipped.
    const first = /^\s*([A-Za-z_$][\w$]*)/.exec(m[1]);
    if (first) names.push(first[1]);
  }
  for (const m of src.matchAll(/^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) names.push(m[1]);
  return names;
}

export function clashes(src) {
  const imported = new Set(importedNames(src));
  return [...new Set(topLevelNames(src).filter((n) => imported.has(n)))];
}

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

test("the checker finds the clash that broke images (#22), and only real clashes", () => {
  const bug = 'import * as fs from "fs/promises";\nimport { exec, hc as run } from "herdr";\nconst fs = (n) => n * 2;\n';
  assert.deepEqual(clashes(bug), ["fs"]);
  const named = 'import { a,\n  b as c } from "x";\nexport function c() {}\nlet a;\n';
  assert.deepEqual(clashes(named).sort(), ["a", "c"]);
  const fine = 'import * as fs from "fs/promises";\nfunction draw() {\n  const fs = 1;\n}\nconst tsz = (n) => n;\n';
  assert.deepEqual(clashes(fine), [], "a name inside a function is its own scope");
});

test("no mod declares a top-level name it also imports", () => {
  const found = [];
  for (const file of jsFiles(join(root, "mods"))) {
    const bad = clashes(readFileSync(file, "utf8"));
    if (bad.length) found.push(`${relative(root, file)}: ${bad.join(", ")}`);
  }
  assert.deepEqual(found, [], `top-level names that hide an import:\n${found.join("\n")}`);
});
