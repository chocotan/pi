# pi-background-tasks shell adaptation

Source: https://github.com/ismailsaleekh/pi-background-tasks

Revision: `799182ff65d7040732aea23b2001ea860b688531`. License: ISC, retained verbatim in [LICENSE](./LICENSE).

`packages/coding-agent/src/extensions/background/registry.ts`, `process-tree.ts`, and `windows-taskkill.ts` adapt the shell registry, bounded log reads, process-group termination and Windows taskkill behavior from upstream `src/core/registry.ts`, `common.ts`, and `windows-taskkill.ts`. Pie's extension registration and floating/detail views are new integration code.

The replaceable `background` built-in registers `bg_run`, `bg_status`, `bg_logs`, `bg_kill`, and `/jobs`. Task IDs and live ownership belong to one session activation. Logs and terminal metadata live under `getAgentDir()/tasks/<hashed-session>/shell-<activation>/`, normally `~/.pie/tasks`. No legacy project `.pi/tasks` path is consulted. Restart/reload does not recover or signal saved PIDs.

Commands run with Pie's existing Bash resolver (`shellPath`, command prefix, command-over-stdin where required), or the explicit `shell: "powershell"` resolver. They inherit ordinary local execution permissions and environment; this feature does not sandbox commands. The custom tools use the standard extension tool validation and hooks. Output combines stdout and stderr in arrival order, caps persisted bytes at 20MiB, applies stream backpressure, and stops on output errors or cap overflow. `bg_logs` reads at most 50KiB from disk. Completion is sent only after output closure, process-tree cleanup, and attempted atomic terminal metadata persistence; persistence/cleanup failures appear as failures. Ordinary log writes are not fsynced.

The floating `pie.background` widget uses order 30 in the existing upper-right manager. It does not capture keyboard focus. Its fixed heading, close control, description-first task rows, five-row maximum, active-first ordering, and overflow selector follow the existing panels. Clicking a task or `/jobs <id>` opens a `ctx.ui.custom` detail overlay with bounded logs and the shared transcript layout. Closing restores the editor through the normal UI overlay lifecycle.

Shutdown, session replacement, and reload close admissions, stop children, flush logs, and suppress late completion notifications. POSIX termination targets only groups captured from live detached spawns, sends TERM, then KILL after a grace period, and reports a failure if group disappearance cannot be verified. The shared child waiter handles inherited pipes after the leader exits. Windows uses trusted System32 `taskkill /T`, force escalation, bounded helper output, and helper deadlines.

## Integration boundary

Shell replacements registered by extensions or SDK custom tools are rejected before spawning, including replacement of the other shell tool. An active, callable local shell tool is required. Existing shell-specific `tool_call` handlers must also cover `bg_run`: its permission event is named `bg_run`, not `bash`. There is no background adapter for remote/sandbox shell replacements.

SDK `baseToolsOverride` can currently label a custom Bash backend as `builtin:bash`; extension metadata cannot distinguish that backend from the ordinary local tool. Hosts using that low-level override must disable this built-in until they provide an explicit background execution adapter. This unresolved parent-Bash override concern requires SDK metadata/capability work outside this port's owned paths.

As with the source implementation, a command that deliberately creates a new session/process group can escape ordinary process-tree ownership; Windows cannot reconstruct descendants after a root has already disappeared. This is process cleanup, not a security boundary. Kill permission errors and unverified termination are reported rather than silently treated as successful cleanup.

Fusion, delegates, telemetry wrappers, attestation, auth rewriting, reload survival, the footer dock, and upstream `/tasks` are excluded. No dependencies were added.
