import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULES, parseRules, pickRule, argvFor } from "../lib/external.js";

test("no config file means the defaults", () => {
  assert.deepEqual(parseRules(null), { rules: DEFAULT_RULES, error: null });
  assert.deepEqual(parseRules(""), { rules: DEFAULT_RULES, error: null });
});

test("invalid config falls back to defaults and says why", () => {
  const bad = parseRules("{ not json");
  assert.equal(bad.rules, DEFAULT_RULES);
  assert.match(bad.error, /external\.json/);
  const noRules = parseRules('{"x": 1}');
  assert.equal(noRules.rules, DEFAULT_RULES);
  assert.match(noRules.error, /rules/);
});

test("defaults: markdown -> Zettlr, anything else -> system opener", () => {
  assert.equal(pickRule(DEFAULT_RULES, "/a/README.md", "macos").app, "Zettlr");
  assert.equal(pickRule(DEFAULT_RULES, "/a/README.md", "linux").app, "Zettlr");
  assert.equal(pickRule(DEFAULT_RULES, "/a/pic.png", "macos").app, "default app");
});

test("defaults on Linux detach the app so exec does not wait for it", () => {
  assert.deepEqual(argvFor(pickRule(DEFAULT_RULES, "/a/b.md", "linux"), "linux", "/a/b.md"), ["setsid", "-f", "zettlr", "/a/b.md"]);
  const argv = argvFor(pickRule(DEFAULT_RULES, "/a/b.png", "linux"), "linux", "/a/b.png");
  assert.equal(argv[0], "sh");
  assert.equal(argv.at(-1), "/a/b.png", "the path is its own argument, not part of the script");
  assert.ok(!argv[2].includes("/a/b.png"));
});

test("defaults on Windows: no Zettlr rule there, so Markdown falls through to the default app", () => {
  assert.equal(pickRule(DEFAULT_RULES, "C:\\a\\README.md", "windows").app, "default app");
  assert.deepEqual(argvFor(pickRule(DEFAULT_RULES, "C:\\a\\x.png", "windows"), "windows", "C:\\a\\x.png"), ["cmd", "/c", "start", "", "C:\\a\\x.png"]);
});

test("rules are tried in order; ext and type both match", () => {
  const rules = [
    { match: { ext: ["PDF"] }, app: "Preview", macos: ["open", "{path}"] },
    { match: { type: "code" }, app: "Zed", macos: ["zed", "{path}"] },
    { match: { any: true }, app: "default", macos: ["open", "{path}"] },
  ];
  assert.equal(pickRule(rules, "/a/x.pdf", "macos").app, "Preview");
  assert.equal(pickRule(rules, "/a/x.go", "macos").app, "Zed");
  assert.equal(pickRule(rules, "/a/x.md", "macos").app, "default");
});

test("a rule without a command for this platform is skipped", () => {
  const rules = [
    { match: { any: true }, app: "MacOnly", macos: ["open", "{path}"] },
    { match: { any: true }, app: "Linux", linux: ["xdg-open", "{path}"] },
  ];
  assert.equal(pickRule(rules, "/a/x", "linux").app, "Linux");
  assert.equal(pickRule([], "/a/x", "linux"), null);
});

test("{path} is substituted as one argument, even with spaces and quotes", () => {
  const path = "/a/my \"odd\" file; rm -rf ~.md";
  assert.deepEqual(argvFor(DEFAULT_RULES[0], "macos", path), ["open", "-a", "Zettlr", path]);
  assert.deepEqual(argvFor({ linux: ["app", "--file={path}"] }, "linux", "/x y"), ["app", "--file=/x y"]);
  assert.equal(argvFor({ linux: [] }, "linux", "/x"), null);
});
