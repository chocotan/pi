# Pie changelog

## [0.1.1]

### Added

- Interactive startup offers to import Pi's `models.json` when Pie has none; importing requires confirmation and never overwrites an existing file.

### Fixed

- Startup now uses a two-row block-letter PIE logo.
- Todo and Subagents retain up to five visible entries and hide only overflow, including when all work has finished.

## [0.1.0]

### Added

- Replaceable built-in Todo, Subagent and structured user-question plugins.
- Floating task and subagent panels with independent child conversation views.
- Purpose-based tool titles, animated loading dots and colored completion dots.
- Clickable tool titles and hover feedback, including a transparent-theme fallback.

### Changed

- Pie uses the `pie` command and `.pie` global/project configuration directories.
- Pie has its own version, startup wordmark and update source.
- Tool output stays selectable; full commands and arguments remain available on expansion.

Pie is based on Pi by Mario Zechner. Upstream SDK packages and their release history retain their original authorship and versions.
