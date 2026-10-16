# Ponytail 5 published benchmark figures

Source: `@dietrichgebert/ponytail` 5.1.0 README, by Dietrich Gebert (MIT).
These are upstream claims, not measurements performed by Pie.

The README describes headless Claude Code with Opus 5.5, default effort, on
39 tasks, with five runs per task. It reports geometric means of per-task
medians against the same agent without the skill. Eighteen tasks have hidden
correctness and safety checks.

| Measure | Ponytail share of baseline | Reduction |
|---------|----------------------------|-----------|
| Lines of code | 47% | 53% |
| Output tokens | 55% | 45% |
| Cost | 74% | 26% |
| Time | 59% | 41% |

The README also reports hidden checks passed at 97% (baseline 96%), and risky
logic accompanied by tests at 98% (baseline 68%). These figures describe the
published benchmark, not the current repository.

The installed npm package did not include the full report, its raw data,
or the referenced chart images. See the [upstream report](https://github.com/DietrichGebert/ponytail/blob/main/benchmarks/results/2026-10-07-agentic.md)
for the claimed methodology and limits, and the [upstream README](https://github.com/DietrichGebert/ponytail).
