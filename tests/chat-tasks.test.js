import { test } from "node:test";
import assert from "node:assert/strict";
import { launchOf, stoppedBy, parseNotification, ended, subagentProgress, stopMessage, lastLines, elapsed } from "../lib/chat-tasks.js";

test("launchOf: background agents and scripts are recognised; ordinary results are not", () => {
  assert.deepEqual(
    launchOf("Agent", "Async agent launched successfully. (This tool result is internal metadata …)\nagentId: a0ff49ba566a2ae4a (internal ID - do not mention to user.)"),
    { kind: "agent", task: "a0ff49ba566a2ae4a" });
  assert.deepEqual(
    launchOf("Bash", "Command running in background with ID: b7zawjg4h. Output is being written to: /tmp/x/tasks/b7zawjg4h.output. You will be notified when it completes."),
    { kind: "shell", task: "b7zawjg4h", output: "/tmp/x/tasks/b7zawjg4h.output" });
  assert.deepEqual(launchOf("Bash", "Command running in background with ID: b1"), { kind: "shell", task: "b1", output: null });
  assert.equal(launchOf("Agent", "Here is my report: all good."), null, "a foreground agent's report");
  assert.equal(launchOf("Bash", "total 0\nCommand running in background with ID: x"), null, "only a result that starts so");
  assert.equal(launchOf("Read", null), null);
  assert.deepEqual(
    launchOf("Bash", "Command was moved to the background (ID: b8xixj0g9) so that a message that arrived while it was running can reach you; it was not interrupted. Output is being written to: /tmp/t/b8xixj0g9.output. You will be notified."),
    { kind: "shell", task: "b8xixj0g9", output: "/tmp/t/b8xixj0g9.output" }, "a script moved to the background while it ran");
});

test("stoppedBy: a successful TaskStop or KillShell names its task; failures don't", () => {
  assert.equal(stoppedBy("TaskStop", { task_id: "b7" }, '{"message":"Successfully stopped task: b7 (…)","task_id":"b7"}', false), "b7");
  assert.equal(stoppedBy("KillShell", { shell_id: "s1" }, "Successfully killed shell: s1", false), "s1");
  assert.equal(stoppedBy("TaskStop", { task_id: "b7" }, "No task found with ID: b7", true), null);
  assert.equal(stoppedBy("Bash", { task_id: "b7" }, "Successfully stopped", false), null);
});

test("parseNotification: every field, the result unescaped; anything else is null", () => {
  const n = parseNotification([
    "<task-notification>",
    "<task-id>a1</task-id>",
    "<tool-use-id>toolu_01</tool-use-id>",
    "<output-file>/tmp/a1.output</output-file>",
    "<status>completed</status>",
    "<summary>Agent \"Review\" finished</summary>",
    "<note>may notify again</note>",
    "<result>use &lt;b&gt; &amp; &quot;x&quot;\nline 2</result>",
    "</task-notification>",
  ].join("\n"));
  assert.deepEqual(n, { task: "a1", toolUseId: "toolu_01", outputFile: "/tmp/a1.output", status: "completed",
    summary: "Agent \"Review\" finished", note: "may notify again", result: "use <b> & \"x\"\nline 2" });
  const shell = parseNotification("<task-notification>\n<task-id>b2</task-id>\n<tool-use-id>t2</tool-use-id>\n<status>stopped</status>\n<summary>didn't finish</summary>\n</task-notification>");
  assert.equal(shell.status, "stopped");
  assert.equal(shell.result, null);
  assert.equal(shell.outputFile, null);
  assert.equal(parseNotification("hello <task-notification>"), null);
  assert.equal(parseNotification(null), null);
});

test("ended: final statuses only", () => {
  for (const s of ["completed", "failed", "killed", "stopped"]) assert.ok(ended(s), s);
  assert.ok(!ended("running"));
  assert.ok(!ended(null));
});

test("subagentProgress: counts its tool calls and names the latest; bad lines are skipped", () => {
  const lines = [
    JSON.stringify({ type: "user", message: { content: "the prompt" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "looking" }, { type: "tool_use", name: "Read", input: { file_path: "/a.js" } }] } }),
    "{ not json",
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Grep", input: { pattern: "exec" } }, { type: "tool_use", name: "Bash", input: { command: "ls" } }] } },
  ];
  const sum = (i) => i.file_path ?? i.pattern ?? i.command;
  assert.deepEqual(subagentProgress(lines, sum), { tools: 3, last: { name: "Bash", summary: "ls" } });
  assert.deepEqual(subagentProgress([]), { tools: 0, last: null });
});

test("stopMessage: names the task id for TaskStop, and what it is", () => {
  assert.equal(stopMessage({ summary: "Count  lines\nin lib", bg: { kind: "agent", task: "a63e" } }),
    'Stop the background subagent "Count lines in lib" (task a63e) with TaskStop, then say so in one line.');
  assert.equal(stopMessage({ summary: "", bg: { kind: "shell", task: "bq1" } }),
    "Stop the background script (task bq1) with TaskStop, then say so in one line.");
});

test("lastLines and elapsed", () => {
  assert.deepEqual(lastLines("a\nb\r\nc\n\n", 2), ["b", "c"]);
  assert.deepEqual(lastLines("", 3), []);
  assert.equal(elapsed(8_400), "8s");
  assert.equal(elapsed(185_000), "3m");
  assert.equal(elapsed(3_900_000), "1h 5m");
  assert.equal(elapsed(-5), "0s");
});
