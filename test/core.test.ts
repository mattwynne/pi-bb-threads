import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNonEmptyText,
  assertThreadId,
  buildSpawnArgs,
  findThreadId,
  isThreadId,
  truncateUtf8,
} from "../src/core.js";

test("recognizes only BB thread identifiers", () => {
  assert.equal(isThreadId("thr_abc123"), true);
  assert.equal(isThreadId("proj_abc123"), false);
  assert.equal(isThreadId("thr_bad-id"), false);
  assert.throws(() => assertThreadId("not-a-thread"), /BB thread ID/);
});

test("builds a hidden worktree child spawn argv", () => {
  assert.deepEqual(buildSpawnArgs({
    projectId: "proj_example",
    prompt: "Audit the auth flow.",
    title: "Auth audit",
    workspace: "worktree",
  }), [
    "thread", "spawn", "--project", "proj_example", "--parent-self",
    "--prompt", "Audit the auth flow.", "--visibility", "hidden",
    "--new-environment", "worktree", "--title", "Auth audit", "--json", 
  ]);
});

test("rejects unsafe spawn inputs", () => {
  assert.throws(() => buildSpawnArgs({
    projectId: "",
    prompt: "task",
    workspace: "worktree",
  }), /BB_PROJECT_ID/);
  assert.throws(() => assertNonEmptyText("   ", "message", 12), /must not be empty/);
});

test("finds a thread ID in BB JSON without relying on a fixed response shape", () => {
  assert.equal(findThreadId({ data: { thread: { id: "thr_child42" } } }), "thr_child42");
  assert.equal(findThreadId({ thread: { id: "proj_not_child" } }), undefined);
});

test("truncates at UTF-8 boundaries and reports omitted data", () => {
  const text = "😀".repeat(100);
  const truncated = truncateUtf8(text, 120);
  assert.ok(Buffer.byteLength(truncated, "utf8") > 0);
  assert.match(truncated, /Output truncated/);
  assert.doesNotThrow(() => new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(truncated)));
});
