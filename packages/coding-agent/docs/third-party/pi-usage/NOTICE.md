# pi-usage attribution

Vendored from **@chocotan/pi-usage 0.2.0**, by **chocotan**,
https://github.com/chocotan/pi-usage, revision
`cd5e1dd3c40fedb0d8c27f78927988d3165be131`.

Copyright (c) 2026 chocotan. Distributed under the [MIT license](LICENSE).

This Pie port in `src/extensions/usage/` preserves `/usage
[day|week|month|total|cal]`, the native custom overlay, keyboard navigation,
per-provider/model recorded token and cost statistics, local day/ISO-week/month
buckets, all-time totals, calendar shades and period navigation, cached batched
session scans, progress, and stderr tables/calendar in non-TUI modes. It does
not contact providers or report subscription limits.

Port adaptations:

- Register replaceable `builtin:usage`, enabled by default. The ordinary
  `extensions` exclusion `-builtin:usage` disables it; another extension that
  registers `/usage` replaces it.
- Resolve history with the application's `getSessionsDir()` and explicit session
  override, respecting Pie's `~/.pie` root. Scan flat session directories as well
  as encoded project folders.
- Use current internal extension/theme types and existing
  `@earendil-works/pi-tui` APIs, with no new dependencies or install scripts.
- Keep the original keys in Pie's application keybinding defaults, honor
  `keybindings.json` overrides, and display the effective bindings in help.
- Scope the parse cache to the extension instance; replace changed-file
  snapshots and deduplicate copied entries on each scan. This avoids duplicate
  anonymous entries and stale data after truncation/deletion while preserving
  cached unchanged files. Include provider/model/timestamp with entry IDs so
  unrelated short-ID collisions are not discarded.
- Accept ordinary JSON whitespace, skip malformed/incomplete/unreadable
  records, validate finite nonnegative metrics without signed 32-bit overflow,
  and strip terminal/control sequences from untrusted provider/model names.
- Cancel reads on close/disposal/shutdown, prevent overlapping rescans, and
  handle asynchronous scan failures without late rendering after close.
- Bound rendered lines at narrow widths and reserve table viewport room for
  borders, totals, and scrolling indicators.

The original README and demo are not bundled: the demo scans real user history.
Dedicated offline tests use synthetic session files and a fake extension host.
No user history, credentials, external APIs, or paid model quota are used by
those tests.

No new configuration file, footer, sidebar or runtime dependency is required.
The existing application keybinding registry provides shortcut discovery and
schema completion for the named `app.usage.*` actions.
