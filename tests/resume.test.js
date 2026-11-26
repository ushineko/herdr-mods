import { test } from "node:test";
import assert from "node:assert/strict";
import { resumeCommand } from "../lib/resume.js";

const sid = "f23aa476-fa03-44d2-8ecc-1506c20d51b1";

test("resumeCommand: the wrapper by profile, else by app home, on Linux and macOS", () => {
  assert.equal(resumeCommand(sid, { profile: "work" }), ` claude-work --resume ${sid}`);
  assert.equal(resumeCommand(sid, { profile: "max", workHome: true }), ` claude-max --resume ${sid}`);
  assert.equal(resumeCommand(sid, { workHome: true, platform: "macos" }), ` claude-work --resume ${sid}`);
  assert.equal(resumeCommand(sid, {}), ` claude-max --resume ${sid}`);
});

test("resumeCommand: plain claude on Windows, whatever the profile", () => {
  assert.equal(resumeCommand(sid, { profile: "work", platform: "windows" }), ` claude --resume ${sid}`);
});

test("resumeCommand: nothing for an id that isn't one", () => {
  assert.equal(resumeCommand("x; rm -rf ~", {}), null);
  assert.equal(resumeCommand("", {}), null);
});
