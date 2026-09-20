import assert from "node:assert/strict";
import test from "node:test";

interface CapturedTool {
  name: string;
  execute: (...args: unknown[]) => Promise<unknown>;
}

test("registers the four BB child-thread tools and delegation guidance", async () => {
  const registeredTools: CapturedTool[] = [];
  let beforeAgentStart: ((event: { systemPrompt: string }) => { systemPrompt: string }) | undefined;
  const extension = (await import("../extensions/bb-threads.ts")).default;

  extension({
    on(event: string, handler: typeof beforeAgentStart) {
      if (event === "before_agent_start") beforeAgentStart = handler;
    },
    registerTool(tool: CapturedTool) {
      registeredTools.push(tool);
    },
  } as never);

  assert.deepEqual(registeredTools.map((tool) => tool.name), [
    "spawn_child",
    "wait_for_child",
    "get_child_output",
    "tell_child",
  ]);
  assert.match(beforeAgentStart?.({ systemPrompt: "base" }).systemPrompt ?? "", /spawn_child/);
  assert.equal(typeof registeredTools[0].execute, "function");
});
