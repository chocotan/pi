import { theme } from "../theme/theme.ts";

/** Pie's compact wordmark fits terminals without half-block rendering. */
export function pieLogoLines(): [string, string] {
	return [theme.fg("accent", "╭─ pie ─╮"), theme.fg("accent", "╰───────╯")];
}
