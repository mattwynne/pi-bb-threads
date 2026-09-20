# pi-bb-threads

A [Pi](https://pi.dev) extension that delegates through durable [BB](https://getbb.app) child threads instead of Pi's process-local subagents.

It gives Pi four native tools:

- `bb_spawn_child` — creates a hidden child thread with `bb thread spawn --parent-self`.
- `bb_wait_child` — waits for a child to become idle or error.
- `bb_child_output` — reads a settled child's final output.
- `bb_tell_child` — steers or queues a follow-up for a child.

The extension adds a delegation policy to Pi's prompt: when a user asks for a subagent, use `bb_spawn_child`, not Pi's built-in `Agent` tool.

## Why

Pi's built-in subagent examples run separate Pi processes. They get independent context windows, but BB cannot show, parent, steer, or retain them as child threads.

This package uses BB's child-thread mechanism instead. A spawned child is visible in BB, has a durable event history, follows the parent's permission ceiling, and can be inspected or steered later.

## Install

Requirements:

- Pi 0.85 or later
- The `bb` CLI on `PATH`
- A Pi session running as a BB thread (so `BB_THREAD_ID` and `BB_PROJECT_ID` are set)
- A Git project with BB's Worktree environment provider enabled for the default mode

Install from GitHub:

```sh
pi install git:github.com/mattwynne/pi-bb-threads@v0.1.0
```

Restart Pi or run `/reload` in an existing session.

To develop it locally:

```sh
pi install /absolute/path/to/pi-bb-threads
```

## Usage

Ask normally:

> Dispatch a subagent to investigate the failing test. Do not change code.

Pi should call `bb_spawn_child`. In a Git-backed BB project, the default is `workspace: "worktree"`, which gives a code-changing task a dedicated Git worktree. In BB's personal project the default is `workspace: "personal"`; Pi can also select that explicitly for non-code research.

A typical parent flow is:

1. `bb_spawn_child`
2. `bb_wait_child`
3. `bb_child_output`
4. optionally `bb_tell_child` to request a correction or follow-up

Each non-spawn operation verifies that the target is a direct child of the current BB thread. Tool output is UTF-8-safe and bounded to 32 KiB before it reaches the parent model.

## Safety and limitations

- The extension never passes user text through a shell: it invokes `bb` with an argument array.
- Children are always hidden by default to keep the sidebar tidy, but remain visible under their parent and addressable by ID.
- BB posts child-completion notices to the parent. This is useful for a small number of children, but can add context noise in large fan-outs.
- A worktree cannot be created for a personal/non-Git BB project. Use `workspace: "personal"` only for non-code work, or run the parent in a Git-backed project.
- This package steers Pi away from its `Agent` tool but does not disable it globally. That preserves Pi-native delegation for cases where BB is unavailable.

## Development

```sh
npm install
npm test
npm run typecheck
```

## License

MIT
