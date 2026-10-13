# pi-ext verification

## Passed checks

- `npm run check`: formatting, linting, pinned/runtime dependencies, TypeScript import checks, entry graph budgets, coding-agent install lock, TypeScript, and browser compatibility. The final commit hook runs the same check again.
- Isolated scoped regression run: **39 files passed, 539 tests passed**; one real-RPC e2e file and 18 tests skipped because API credentials were deliberately absent.
- Native one-column grapheme regression: `node --test test/editor-word-wrap-small.test.ts` passed.
- HTML prototype: 504 display combinations, exact 120 / 80 / 48 columns, light/dark themes, thinking-level and state changes, narrow panels, and unknown metrics passed in Chromium.
- Real source CLI in an isolated tmux session with a local faux provider passed:
  - 120-column full-height sidebar;
  - Todo creation and delegated child completion;
  - default compact thinking/tool display;
  - model and reasoning level;
  - token/context rows;
  - 80-column reflow and switchable sidebar panel;
  - mouse click into agent detail actions;
  - native ask-user preview and answer delivery.

No real model calls or paid provider tokens were used for these runtime tests.

## Independent review corrections

The review identified and verified four lifecycle/UI edge cases. Dedicated regressions now cover:

1. Delegation is still allowed after a tree navigation is cancelled.
2. A superseded agent owner cannot complete another owner's task.
3. Restoring an interrupted history node leaves its owned task pending and retryable.
4. Long descriptions cannot push the free-text input out of an 80×24 questionnaire viewport.

The branch task update protocol follows the current owner. Queued runs claim tasks once rather than reclaiming them when they later start.

## Repository-wide baseline limitations

`./test.sh` was run with an empty API environment and an isolated HOME. It also exercises other workspace packages and contracts requiring compiled distribution artifacts.

Its first run exposed legacy coding-agent fixtures using `pi`, `.pi`, and old directory/method expectations. Those fixtures were migrated without weakening semantic assertions; all changed and directly affected coding-agent tests were included in the successful 539-test run.

The repository-wide run was not fully green: other packages report missing `dist` entrypoints in this source-only checkout, and two AI metadata assertions differ from the pinned model-catalog snapshot. These are not claimed as passing. No unrelated implementation or AI assertion was downgraded, and no `npm run build` was run.

Provider data required for source-mode tests was hydrated using the repository's official hydration script after verifying the Nix-pinned catalog SHA256. The ignored data files were not staged, and `models.generated.ts` was not edited.

## Not covered

Actual OS input-method integration, every terminal image protocol, native Windows behavior, and release/publish binaries were not tested. Cursor preservation, Unicode widths, native input behavior, and image renderer parity are covered by the selected automated tests. The `pi-background-tasks` package was evaluated separately and is not included in this implementation.
