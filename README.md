# pi-bb-threads

A [Pi](https://pi.dev) extension that delegates through durable [BB](https://getbb.app) child threads instead of Pi's process-local subagents.

It gives Pi four native tools:

- `spawn_child` — creates a visible child thread with `bb thread spawn --parent-self`.
- `wait_for_child` — waits for a child to become idle or error.
- `get_child_output` — reads a settled child's final output.
- `tell_child` — steers or queues a follow-up for a child.

The extension adds a delegation policy to Pi's prompt: when a user asks for a subagent, use `spawn_child`, not Pi's built-in `Agent` tool.

## Why

Pi's built-in subagent examples run separate Pi processes. They get independent context windows, but BB cannot show, parent, steer, or retain them as child threads.

This package uses BB's child-thread mechanism instead. A spawned child is visible in BB, has a durable event history, follows the parent's permission ceiling, and can be inspected or steered later.

## Install

Requirements:

- Pi 0.85 or later
- The `bb` CLI on `PATH`
- A Pi session running as a BB thread (so `BB_THREAD_ID` and `BB_PROJECT_ID` are set)
- BB's Worktree environment provider enabled when you want an isolated code-changing child

Install from GitHub:

```sh
pi install git:github.com/mattwynne/pi-bb-threads@v0.1.0
```

Restart Pi or run `/reload` in an existing session. The package is inert unless Pi is running in a BB thread with both `BB_THREAD_ID` and `BB_PROJECT_ID`; outside BB it registers no tools or policy.

To develop it locally:

```sh
pi install /absolute/path/to/pi-bb-threads
```

## Usage

Ask normally:

> Dispatch a subagent to investigate the failing test. Do not change code.

Pi should call `spawn_child`. It defaults to `workspace: "inherit"`, so the child runs in the same workspace as its parent. Parent/child ownership and workspace selection are independent. For a code-changing task, Pi must explicitly select `workspace: "worktree"` to give the child a dedicated Git worktree. For explicitly non-code research, it can select `workspace: "personal"`.

A typical parent flow is:

1. `spawn_child`
2. `wait_for_child`
3. `get_child_output`
4. optionally `tell_child` to request a correction or follow-up

Each non-spawn operation verifies that the target is a direct child of the current BB thread. Tool output is UTF-8-safe and bounded to 32 KiB before it reaches the parent model.

## Safety and limitations

- The extension never passes user text through a shell: it invokes `bb` with an argument array.
- Children are visible beneath their parent in the BB sidebar and are addressable by ID.
- BB posts child-completion notices to the parent. This is useful for a small number of children, but can add context noise in large fan-outs.
- A worktree cannot be created for a personal/non-Git BB project. Use `workspace: "personal"` only for non-code work, or run the parent in a Git-backed project. Inherited workspaces should not be used concurrently by children that can edit the same files.
- Inside a BB thread, the extension blocks Pi's `Agent` tool so delegated work uses a BB child thread. Outside BB, the extension is inert and does not affect Pi-native delegation.

## Development

```sh
npm install
npm test
npm run typecheck
```

## License

MIT
