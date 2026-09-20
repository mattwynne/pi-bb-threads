import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  MAX_MESSAGE_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_TITLE_LENGTH,
  assertNonEmptyText,
  assertThreadId,
  buildSpawnArgs,
  findThreadId,
  isBbThreadContext,
  truncateUtf8,
  type WorkspaceKind,
} from "../src/core.js";

const BB_THREAD_ID = process.env.BB_THREAD_ID;
const BB_PROJECT_ID = process.env.BB_PROJECT_ID;
const MAX_WAIT_SECONDS = 1_200;

interface BbResult {
  stdout: string;
  stderr: string;
}

interface ChildThreadRecord {
  thread?: {
    id?: unknown;
    parentThreadId?: unknown;
  };
}

function requireBbContext() {
  assertThreadId(BB_THREAD_ID, "BB_THREAD_ID");
  assertNonEmptyText(BB_PROJECT_ID, "BB_PROJECT_ID", 128);
  return { threadId: BB_THREAD_ID, projectId: BB_PROJECT_ID };
}

function parseJson(text: string, command: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${command} returned invalid JSON: ${truncateUtf8(text, 2_000)}`);
  }
}

function renderResult(result: BbResult): string {
  const parts = [result.stdout.trim(), result.stderr.trim()].filter(Boolean);
  return truncateUtf8(parts.join(result.stdout && result.stderr ? "\n\n[stderr]\n" : "\n")) || "(no output)";
}

async function runBb(args: string[], signal?: AbortSignal): Promise<BbResult> {
  if (signal?.aborted) throw new Error("Cancelled before BB command started.");

  return new Promise((resolve, reject) => {
    const child = spawn("bb", args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let spawnError: Error | undefined;

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      spawnError = error;
    });

    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });

    child.on("close", (code, terminationSignal) => {
      signal?.removeEventListener("abort", abort);
      if (spawnError) {
        reject(new Error(`Could not run bb: ${spawnError.message}`));
        return;
      }

      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (signal?.aborted) {
        reject(new Error("BB command cancelled."));
      } else if (code !== 0) {
        reject(new Error(`bb ${args.join(" ")} failed${terminationSignal ? ` (${terminationSignal})` : ""}:\n${renderResult(result)}`));
      } else {
        resolve(result);
      }
    });
  });
}

async function assertChildThread(threadId: string, signal?: AbortSignal) {
  const { threadId: parentId } = requireBbContext();
  assertThreadId(threadId);
  const result = await runBb(["thread", "show", threadId, "--json"], signal);
  const record = parseJson(result.stdout, "bb thread show") as ChildThreadRecord;
  if (record.thread?.id !== threadId || record.thread.parentThreadId !== parentId) {
    throw new Error(`${threadId} is not a child of this BB thread.`);
  }
}

function childLink(threadId: string) {
  return `[${threadId}](bb://thread/${threadId})`;
}

export default function (pi: ExtensionAPI) {
  // A globally installed Pi package is available to every Pi process. Only BB
  // supplies both variables, so outside BB this extension deliberately has no
  // tools, policy, or interception behavior.
  if (!isBbThreadContext(BB_THREAD_ID, BB_PROJECT_ID)) return;

  pi.on("tool_call", (event) => {
    if (event.toolName === "Agent") {
      return {
        block: true,
        reason: "This Pi session runs inside BB. Use spawn_child for a BB-managed child thread instead of Agent.",
      };
    }
  });

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n## BB child-thread delegation\nWhen the user asks to dispatch, delegate to, or use a subagent, use the spawn_child tool rather than Pi's Agent tool. BB children are visible and controllable in BB. Child parenting and workspace selection are independent: inherit the parent workspace unless isolation is requested; use workspace=worktree for any code-changing task; use personal only for explicitly non-code work. Use wait_for_child before get_child_output, and use tell_child to steer a child.`,
  }));

  pi.registerTool({
    name: "spawn_child",
    label: "Spawn BB Child",
    description: "Spawn a hidden BB child thread parented to this thread. By default it inherits the parent workspace.",
    promptSnippet: "Spawn a BB-managed child thread for delegated work",
    promptGuidelines: [
      "Use spawn_child, not Pi's Agent tool, when the user asks for a subagent or delegation.",
      "Use spawn_child with workspace=worktree for any task that can change code or files; otherwise let it inherit the parent workspace.",
    ],
    parameters: Type.Object({
      prompt: Type.String({ minLength: 1, maxLength: MAX_PROMPT_LENGTH, description: "Complete delegated task and success criteria." }),
      title: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_TITLE_LENGTH, description: "Short child-thread title." })),
      workspace: Type.Optional(StringEnum(["inherit", "worktree", "personal"] as const, { description: "inherit (default) reuses the parent workspace; worktree isolates code changes; personal is only for non-code work." })),
    }),
    async execute(_toolCallId, params, signal) {
      const { projectId } = requireBbContext();
      const workspace: WorkspaceKind = params.workspace ?? "inherit";
      const result = await runBb(buildSpawnArgs({ projectId, prompt: params.prompt, title: params.title, workspace }), signal);
      const threadId = findThreadId(parseJson(result.stdout, "bb thread spawn"));
      if (!threadId) throw new Error(`bb thread spawn succeeded but returned no thread ID: ${truncateUtf8(result.stdout, 2_000)}`);

      return {
        content: [{ type: "text", text: `Spawned BB child ${childLink(threadId)} in a ${workspace} environment.` }],
        details: { threadId, workspace },
      };
    },
  });

  pi.registerTool({
    name: "wait_for_child",
    label: "Wait for BB Child",
    description: "Wait for one of this thread's BB children to become idle or error.",
    parameters: Type.Object({
      threadId: Type.String({ minLength: 5, maxLength: 80 }),
      status: Type.Optional(StringEnum(["idle", "error"] as const)),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_WAIT_SECONDS })),
    }),
    async execute(_toolCallId, params, signal) {
      assertThreadId(params.threadId);
      await assertChildThread(params.threadId, signal);
      const status = params.status ?? "idle";
      const timeoutSeconds = params.timeoutSeconds ?? MAX_WAIT_SECONDS;
      const result = await runBb(["thread", "wait", params.threadId, "--status", status, "--timeout", String(timeoutSeconds), "--json"], signal);
      return {
        content: [{ type: "text", text: `Child ${childLink(params.threadId)} reached ${status}.\n\n${renderResult(result)}` }],
        details: { threadId: params.threadId, status },
      };
    },
  });

  pi.registerTool({
    name: "get_child_output",
    label: "Get BB Child Output",
    description: "Retrieve final output from one of this thread's BB children after it settles.",
    parameters: Type.Object({ threadId: Type.String({ minLength: 5, maxLength: 80 }) }),
    async execute(_toolCallId, params, signal) {
      assertThreadId(params.threadId);
      await assertChildThread(params.threadId, signal);
      const result = await runBb(["thread", "output", params.threadId], signal);
      return {
        content: [{ type: "text", text: `Output from ${childLink(params.threadId)}:\n\n${truncateUtf8(result.stdout) || "(no final output yet)"}` }],
        details: { threadId: params.threadId },
      };
    },
  });

  pi.registerTool({
    name: "tell_child",
    label: "Tell BB Child",
    description: "Steer or queue a follow-up message for one of this thread's BB children.",
    parameters: Type.Object({
      threadId: Type.String({ minLength: 5, maxLength: 80 }),
      message: Type.String({ minLength: 1, maxLength: MAX_MESSAGE_LENGTH }),
      mode: Type.Optional(StringEnum(["steer", "queue", "auto"] as const)),
    }),
    async execute(_toolCallId, params, signal) {
      assertThreadId(params.threadId);
      assertNonEmptyText(params.message, "message", MAX_MESSAGE_LENGTH);
      await assertChildThread(params.threadId, signal);
      const result = await runBb(["thread", "tell", params.threadId, params.message, "--mode", params.mode ?? "steer", "--json"], signal);
      return {
        content: [{ type: "text", text: `Sent follow-up to ${childLink(params.threadId)}.\n\n${renderResult(result)}` }],
        details: { threadId: params.threadId, mode: params.mode ?? "steer" },
      };
    },
  });
}
