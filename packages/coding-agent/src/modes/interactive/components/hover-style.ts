import { theme } from "../theme/theme.ts";

/** System themes may use a transparent selection background until the terminal reports its colors. */
export function highlightHover(text: string): string {
	return theme.getBgAnsi("selectedBg") === "\x1b[49m"
		? theme.style(text, { bg: "selectedBg", underline: true })
		: theme.bg("selectedBg", text);
}
