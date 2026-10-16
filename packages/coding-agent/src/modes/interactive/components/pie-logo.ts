import { theme } from "../theme/theme.ts";

/** Two-row block-letter PIE logo; the version and shortcuts are laid out alongside it. */
export function pieLogoLines(): [string, string] {
	return [theme.fg("accent", "█▀█ ▀█▀ █▀▀"), theme.fg("accent", "█▀▀ ▄█▄ ██▄")];
}
