# pi-ext built-in plugins

pi-ext ships task tracking, subagents, and structured user questions as built-in plugins. The terminal provides a round composer and dismissible Todo/Subagents panels stacked at the top right.

## Configuration directory

Global configuration and runtime data live directly under `~/.pi-ext`:

- `auth.json`, `models.json`, `settings.json`, `keybindings.json`
- `extensions/`, `skills/`, `prompts/`, `themes/`, `agents/`
- `sessions/` and `subagents/`

Project configuration lives in `<cwd>/.pi-ext`. The workspace remains the session's current directory. Existing `~/.pi/agent` data is not automatically copied or loaded.

Override the directory with `PI_EXT_CODING_AGENT_DIR`; override session storage with `PI_EXT_CODING_AGENT_SESSION_DIR`. Upstream documentation examples using `~/.pi/agent`, `.pi`, and `PI_CODING_AGENT_DIR` refer to these corresponding pi-ext locations and names in this fork.

Run from source:

```sh
./pi-test.sh
```

The package supplies `pi-ext` and the existing `pi` executable entrypoint.

## Enable, disable, or replace plugins

Built-ins load by default in the CLI:

- `builtin:tasks`
- `builtin:subagents`
- `builtin:ask-user-question`

Disable individual plugins in `~/.pi-ext/settings.json`:

```json
{
  "extensions": ["-builtin:subagents", "-builtin:ask-user-question"]
}
```

`--no-extensions` disables built-in plugins as well. `-e builtin:tasks` explicitly loads a built-in. A file or package plugin registering a conflicting tool or command replaces the corresponding replaceable built-in, using the existing resource loader diagnostics.

The SDK follows the existing built-in extension pattern: add the factories explicitly to a `DefaultResourceLoader`, then bind extensions before running. Exports include `tasksExtension`, `createSubagentsExtension`, and `createAskUserExtension`.

## Todo

Tools: `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`.

Tasks start as `pending`; use `in_progress` during work and `completed` only once the work is complete. `status: "deleted"` deletes a task. Dependencies must exist and cannot form a cycle. A blocked task cannot enter progress or complete. Metadata merges; a null value deletes that metadata key.

State is stored as session custom entries and reconstructed from the active branch. Tree navigation restores the tasks belonging to that point; compaction does not erase the task state. In-memory sessions remain in memory.

`/tasks` and `/todos` open the floating Todo panel in the TUI and show task details in other modes. The panel appears at the top right when tasks exist without taking keyboard focus. An empty list stays hidden; deleting the last task closes the panel. Lists longer than five hide completed or failed items without deleting them. It shows task subjects; click a task for its saved requirements or `[x]` to close. Task updates do not reopen a dismissed panel; `/tasks` reopens it.

## Subagents

Tools:

- `Agent`: start a bounded delegated run, defaulting to `worker`.
- `list_subagents`: available definitions and session runs.
- `get_subagent_result`: retrieve a run, optionally joining it.
- `steer_subagent`: guide a running agent at a tool boundary.
- `stop_subagent`: stop queued or running work.
- `TaskExecute`, `TaskOutput`, `TaskStop`: connect a task with an `agentType` to a delegated run.

TUI and RPC sessions default to background execution and receive completion notifications. Print and JSON invocations default to foreground execution; they cannot leave a child running after their process exits. Set `run_in_background: false` explicitly to join an Agent run. Four runs execute concurrently; additional runs queue. The default turn limit is 30. Errors, cancellation, or truncated output do not complete linked tasks.

`TaskOutput` defaults to waiting up to 30,000ms. Its `timeout` is in milliseconds, up to 600,000; `block: false` or `timeout: 0` returns current state immediately.

Each subagent uses its own `AgentSession`, inherits the parent's selected model and reasoning level, and can only use parent-provided coding tools. Child tool execution goes through the parent's tool hooks, preserving tool restrictions and sandbox replacements. This is a tool and context boundary, not an operating-system sandbox. Researcher/reviewer instructions prohibit edits, but shell access itself is not an enforced read-only filesystem boundary.

Runs are session-owned. Quit, reload, session replacement, and tree navigation stop active work; unfinished restored runs are marked interrupted. Saved child sessions can be continued with `Agent.resume`; in-memory runs cannot be resumed after disposal. Results stored in parent records are bounded to 32KiB; saved child sessions retain the complete transcript. `inherit_context` passes at most 50KiB of text history and omits image attachments.

Provider-reported child usage is recorded through `pi.appendUsage()` once. Reading the result again does not add usage.

The Subagents panel title shows the active run's description. Subagents float at the top right below Todo, with each run on its own row showing a description, status icon, and elapsed time. When Todo is absent or closed, Subagents move up. Empty run lists stay hidden. Each panel has a close button. Tool calls stay on separate rows. Click an entry to open its own conversation, including instructions, Thinking, tool calls, and answers; close or press Escape to return to the parent. Extra runs have an explicit `+N` entrance. `/agents` retains result, stop, and steering actions.

### Agent definitions

Built-in profiles: `worker`, `researcher`, `reviewer`.

User definitions: `~/.pi-ext/agents/*.md`. Trusted project definitions: `.pi-ext/agents/*.md`. Project definitions override user and built-in names only in a trusted project.

```markdown
---
name: docs-reviewer
description: Review documentation for technical errors
tools: [read, bash]
model: openai/gpt-6.1-sol
thinking: high
---
Review the delegated documentation without changing files.
Return actionable findings with file references.
```

`model` and `thinking` are optional. Tools are coding-tool names; the parent loadout remains the upper bound. An empty tools list creates a text-only agent. Orchestration tools are excluded to prevent recursive delegation.

## Ask user

Tool: `ask_user_question`. Use a `questions` array even for one question:

```json
{
  "questions": [
    {
      "header": "Approach",
      "question": "Which implementation should we use?",
      "options": [
        { "label": "Small patch (Recommended)", "description": "Reuse existing components" },
        { "label": "Refactor", "description": "Replace the underlying structure" }
      ]
    }
  ]
}
```

Supports 1–4 questions with 2–4 options each, multi-select, a built-in `Type something.` row, cancellation, and single-select Markdown previews. Do not author `Other`, `Type something.`, or `Next` options. Header limit: 16 characters. Label limit: 60 characters.

Wide TUI questionnaires place options and previews side by side; narrow views stack them. Free-text input uses the native input component and preserves the host's cursor and keybindings. RPC uses select/input dialogs. Non-interactive modes leave the tool inactive; a direct call without UI returns an error stating that the user never saw the questions. Cancellation is not approval.

The schema, validation, normalization, response format, and RPC behavior are adapted from [rpiv-ask-user-question](https://github.com/juicesharp/rpiv-mono/tree/2d88b79c08ce19ffeecbe85d5ee1071046b708c0/packages/rpiv-ask-user-question). The view is adapted to this fork's native components and keybindings. The [MIT notice](third-party/rpiv-ask-user-question-LICENSE) is included. No rpiv-config or internationalization dependency is required.

## Terminal behavior

- The conversation uses the full terminal width. There is no application sidebar.
- Todo and Subagents are non-capturing floating panels at the top right. Todo is above Subagents; both hide when empty. Closing Todo removes its space. Subagents use one row per run.
- Rounded input borders show current run status/time on the left.
- Token and context statistics use the original Pi footer, including input/output, cache reads/writes, cache hit rate, cost, and right-aligned model/thinking. Directories outside Git repositories have no branch placeholder.
- Active Thinking content expands while it streams and collapses when the next phase starts. Explicit manual and global visibility choices are respected. Thinking and tool headers remain visible in both states; click again to collapse.
- Tool states use icons: muted `◌` for waiting, a spinner while running, green `✓` for success, and red `✗` for failure. Durations appear once in the title, use milliseconds below one second, and hide zero. Expanded output follows its title directly. Consecutive visible tool calls have no blank rows between them; the first tool after text keeps one leading blank row. This layout applies to both the parent transcript and subagent details. A single tool expansion shortcut follows the transcript.
- User messages keep the theme's default user background.

Plugins can add composer widgets independently:

```ts
pi.on("session_start", (_event, ctx) => {
  ctx.ui.setWidget("my-plugin.jobs", ["Jobs", "No running jobs"], { placement: "aboveEditor" });
});
```

Clear the widget with `ctx.ui.setWidget("my-plugin.jobs", undefined)`. Components can implement mouse handling. Floating widgets use `{ placement: "floating", order: 10 }`; lower order values appear first and updates do not reorder them. These widgets share a non-capturing overlay without tying plugins to each other. Temporary detail views use `ctx.ui.custom()` with overlay options.

## Related migration assessment

The shell-only portion of [pi-background-tasks](https://github.com/ismailsaleekh/pi-background-tasks) is complementary to these features. It was evaluated separately; it is not included in this implementation. See the repository's `docs/design/pi-background-tasks-assessment.md` for scope and lifecycle considerations.
