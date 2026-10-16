# Ponytail attribution

Vendored from `@dietrichgebert/ponytail` version **5.1.0**, by **Dietrich Gebert**
(`DietrichGebert`), https://github.com/DietrichGebert/ponytail.

Copyright (c) 2026 DietrichGebert. Distributed under the [MIT license](LICENSE).

This direct Pie port includes the Pi adapter and its configuration and
instruction-building behavior in `src/extensions/ponytail/`, and the six skills
in `skills/ponytail*`. It does not include adapters for other hosts.

Port changes: erasable TypeScript with top-level imports; current structured
prompt sections; package assets resolved through `getPackageDir()`; global
configuration at `getAgentDir()/ponytail/config.json`; built-in replacement
support; status cleanup when hidden or unloaded. Runtime modes, environment
overrides, one-shot aliases, branch-local state and fallback instructions are
preserved. The help skill documents Pie's configuration and update flow.

The gain skill retains the published figures. Its benchmark citation now points
to the upstream report and a bundled transcription of the installed README's
figures at `skills/ponytail-gain/benchmark.md`, because the installed package
contained neither the report nor chart assets. Pie has not verified those
benchmark claims. Other skill instructions are unchanged.
