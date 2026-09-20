export const MAX_PROMPT_LENGTH = 12_000;
export const MAX_MESSAGE_LENGTH = 12_000;
export const MAX_TITLE_LENGTH = 160;
export const MAX_TOOL_OUTPUT_BYTES = 32 * 1024;

const THREAD_ID_PATTERN = /^thr_[a-z0-9]+$/i;

export type WorkspaceKind = "inherit" | "worktree" | "personal";

export interface SpawnOptions {
  projectId: string;
  prompt: string;
  workspace: WorkspaceKind;
  title?: string;
}

export function isThreadId(value: unknown): value is string {
  return typeof value === "string" && THREAD_ID_PATTERN.test(value);
}

export function isBbThreadContext(threadId: unknown, projectId: unknown): boolean {
  return isThreadId(threadId) && typeof projectId === "string" && projectId.trim().length > 0;
}

export function assertThreadId(value: unknown, label = "threadId"): asserts value is string {
  if (!isThreadId(value)) {
    throw new Error(`${label} must be a BB thread ID such as thr_abc123.`);
  }
}

export function assertNonEmptyText(value: unknown, label: string, maxLength: number): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  if (value.length > maxLength) {
    throw new Error(`${label} exceeds its ${maxLength.toLocaleString()} character limit.`);
  }
}

export function assertWorkspace(value: unknown): asserts value is WorkspaceKind {
  if (value !== "inherit" && value !== "worktree" && value !== "personal") {
    throw new Error("workspace must be inherit, worktree, or personal.");
  }
}

export function buildSpawnArgs(options: SpawnOptions): string[] {
  assertNonEmptyText(options.projectId, "BB_PROJECT_ID", 128);
  assertNonEmptyText(options.prompt, "prompt", MAX_PROMPT_LENGTH);
  assertWorkspace(options.workspace);
  if (options.title !== undefined) assertNonEmptyText(options.title, "title", MAX_TITLE_LENGTH);

  const args = [
    "thread",
    "spawn",
    "--project",
    options.projectId,
    "--parent-self",
    "--prompt",
    options.prompt,
    "--visibility",
    "hidden",
  ];

  if (options.workspace !== "inherit") args.push("--new-environment", options.workspace);
  if (options.title) args.push("--title", options.title);
  args.push("--json");
  return args;
}

export function findThreadId(value: unknown): string | undefined {
  if (isThreadId(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findThreadId(item);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = findThreadId(item);
      if (found) return found;
    }
  }
  return undefined;
}

export function truncateUtf8(value: string, maxBytes = MAX_TOOL_OUTPUT_BYTES): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) return value;

  const suffix = `\n\n[Output truncated: ${encoded.byteLength - maxBytes} UTF-8 bytes omitted.]`;
  const suffixBytes = new TextEncoder().encode(suffix).byteLength;
  const budget = Math.max(0, maxBytes - suffixBytes);
  let end = 0;
  let used = 0;

  for (const character of value) {
    const bytes = new TextEncoder().encode(character).byteLength;
    if (used + bytes > budget) break;
    used += bytes;
    end += character.length;
  }

  return value.slice(0, end) + suffix;
}
