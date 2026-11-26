import { test } from "node:test";
import assert from "node:assert/strict";
import { controlInput, controlAnswers, projectFolder, sessionTitle, parseSessions } from "../lib/chat-sdk.js";

test("controlInput: one control request a line, numbered", () => {
  const text = controlInput([{ subtype: "initialize" }, { subtype: "get_settings" }]);
  assert.deepEqual(text.trim().split("\n").map((l) => JSON.parse(l)), [
    { type: "control_request", request_id: "r0", request: { subtype: "initialize" } },
    { type: "control_request", request_id: "r1", request: { subtype: "get_settings" } },
  ]);
  assert.ok(text.endsWith("\n"));
});

test("controlAnswers: answers by request id, errors, the newest command list; CRLF lines", () => {
  const lines = [
    JSON.stringify({ type: "system", subtype: "commands_changed", commands: [{ name: "a" }] }),
    "not json",
    JSON.stringify({ type: "control_response", response: { request_id: "r1", subtype: "error", error: "nope" } }),
    JSON.stringify({ type: "control_response", response: { request_id: "r0", subtype: "success", response: { ok: 1 } } }),
    JSON.stringify({ type: "system", subtype: "commands_changed", commands: [{ name: "b" }] }),
  ].join("\r\n");
  assert.deepEqual(controlAnswers(lines, 3), { out: [{ ok: 1 }, { error: "nope" }, { error: "no answer" }], commands: [{ name: "b" }] });
  assert.deepEqual(controlAnswers("", 1, "timed out"), { out: [{ error: "timed out" }], commands: null });
});

test("projectFolder: Claude Code's folder name for a Windows or POSIX path", () => {
  assert.equal(projectFolder("C:\\Users\\nvere\\git\\sysadmin"), "C--Users-nvere-git-sysadmin");
  assert.equal(projectFolder("/home/me/git/herdr-mods"), "-home-me-git-herdr-mods");
});

test("sessionTitle: a custom or AI title wins; else the first real user message", () => {
  const user = (content, extra = {}) => JSON.stringify({ type: "user", message: { content }, ...extra });
  assert.equal(sessionTitle([user("<command-name>x</command-name>"), user("meta", { isMeta: true }), user("fix the tab bar\nmore")]), "fix the tab bar");
  assert.equal(sessionTitle([user("first"), JSON.stringify({ aiTitle: "AI one" }), JSON.stringify({ customTitle: "Mine" })]), "Mine");
  assert.equal(sessionTitle(["garbage"]), null);
});

test("parseSessions: records newest first, untitled ones left out", () => {
  const rec = (id, at, ...lines) => `\x1e${id}\t${at}\r\n${lines.join("\r\n")}\r\n`;
  const text = rec("aaa", 100, JSON.stringify({ aiTitle: "Older" })) + rec("bbb", 200, JSON.stringify({ aiTitle: "Newer" })) + rec("ccc", 300);
  assert.deepEqual(parseSessions(text), [{ id: "bbb", title: "Newer", at: 200 }, { id: "aaa", title: "Older", at: 100 }]);
});
