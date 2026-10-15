import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

/** Clock time for a message. Same-day messages omit the date. */
export function formatMessageTime(timestamp: number, now = Date.now()): string {
	const date = new Date(timestamp);
	const today = new Date(now);
	const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
	if (date.toDateString() === today.toDateString()) return time;
	const month = date.toLocaleString([], { month: "short" });
	return `${month} ${date.getDate()} ${time}`;
}

export function appendMessageTime(lines: string[], width: number, timestamp: number | undefined): string[] {
	if (!timestamp || lines.length === 0) return lines;
	const label = theme.fg("muted", formatMessageTime(timestamp));
	const gap = Math.max(2, width - visibleWidth(lines[lines.length - 1]) - visibleWidth(label));
	lines[lines.length - 1] += " ".repeat(gap) + label;
	lines[lines.length - 1] = truncateToWidth(lines[lines.length - 1], width, "");
	return lines;
}
