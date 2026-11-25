import { test } from "node:test";
import assert from "node:assert/strict";
import { SpaceLocks } from "../lib/space-locks.js";

test("a new space follows; the locked space gets its lock back", () => {
  const s = new SpaceLocks("work");
  assert.equal(s.enter("work", { path: "/w" }), undefined, "same space: nothing changes");
  assert.equal(s.enter("mods", { path: "/w" }), null, "a space never locked follows");
  assert.deepEqual(s.enter("work", null), { path: "/w" }, "back: the lock set there");
});

test("following when leaving a space clears its old lock", () => {
  const s = new SpaceLocks("a");
  s.enter("b", { path: "/a" });
  s.enter("a", null);
  assert.deepEqual(s.enter("b", null), null);
  assert.equal(s.enter("a", null), null, "a's lock was let go while a was shown");
});

test("a lock set for another space waits there; null lets it follow", () => {
  const s = new SpaceLocks("a");
  s.set("b", { path: "/agent" });
  assert.deepEqual(s.enter("b", null), { path: "/agent" });
  s.set("c", { path: "/x" });
  s.set("c", null);
  assert.equal(s.enter("c", null), null);
});
