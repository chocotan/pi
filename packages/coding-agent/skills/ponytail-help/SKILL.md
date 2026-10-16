---
name: ponytail-help
description: >
  Quick reference for ponytail levels, skills and commands. One-shot display.
  Use for /ponytail-help, "ponytail help", "how do I use ponytail".
---

# Ponytail Help

Display this reference card when invoked. One-shot, do NOT change mode,
write flag files, or persist anything.

## Levels

| Level | Trigger | What change |
|-------|---------|-------------|
| **Lite** | `/ponytail lite` | Build what was asked, name the smaller option in one line. |
| **Full** | `/ponytail` | The smallest complete change, a check where the logic needs one, and a reply that names what was skipped and any risk. Default. |
| **Ultra** | `/ponytail ultra` | Also questions the request and pushes back before building. |

Level sticks until changed or session end.

## Skills

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **ponytail** | `/ponytail` | Lazy mode itself: least new code, clear replies that name skipped work and risks. |
| **ponytail-review** | `/ponytail-review` | Quality review of a diff: bugs, security, load, missing tests, speed, what to cut. Each finding says what goes wrong and how to fix it. |
| **ponytail-audit** | `/ponytail-audit` | The same quality review for the whole repo, ranked. |
| **ponytail-debt** | `/ponytail-debt` | Harvest `shortcut:` comments into a tracked ledger. |
| **ponytail-gain** | `/ponytail-gain` | Measured-impact scoreboard: less code, less cost, more speed. |
| **ponytail-help** | `/ponytail-help` | This card. |

In Pie, all six skills are available as `/skill:ponytail`,
`/skill:ponytail-review`, and so on. The aliases above expand the same instructions.

## Deactivate

Say "stop ponytail" or "normal mode". Resume anytime with `/ponytail`.
`/ponytail off` also works.

## Configure Default Mode

Default mode = `full`, auto-active every session. Change it:

**Environment variable** (highest priority):
```bash
export PONYTAIL_DEFAULT_MODE=ultra
```

**Config file** (`~/.pie/ponytail/config.json`, or
`$PIE_CODING_AGENT_DIR/ponytail/config.json` when that override is set):
```json
{ "defaultMode": "lite" }
```

Set `"off"` to disable auto-activation on session start, activate manually
with `/ponytail` when wanted.

Resolution: env var > config file > `full`.

Save the default from Pie with `/ponytail default lite|full|ultra|off`.
This changes future sessions, while `/ponytail lite|full|ultra|off` changes the
current session branch. An environment override still takes precedence.

Set `PONYTAIL_QUIET_STARTUP=1` or `"quietStartup": true` to hide the startup
notice. Set `PONYTAIL_HIDE_STATUS=1` or `"hideStatus": true` to hide the status
indicator while keeping Ponytail active. Environment values `0`, `false`,
`no`, or an empty value disable either setting.

## Update

Ponytail is bundled with Pie and updates with the application. This port is
based on Ponytail 5.1.0, by Dietrich Gebert, under the MIT license.

## More

Full docs + examples: https://github.com/DietrichGebert/ponytail
