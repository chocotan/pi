import {
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { theme } from "../../modes/interactive/theme/theme.ts";
import type { SubagentRecord } from "./index.ts";

/** One-line list above the composer, with direct entry targets and an explicit overflow entry. */
export class SubagentStrip implements Component {
	private readonly records: readonly SubagentRecord[];
	private readonly open: (record: SubagentRecord) => void;
	private readonly more: () => void;
	private positions: Array<{ from: number; to: number; record?: SubagentRecord }> = [];
	constructor(records: readonly SubagentRecord[], open: (record: SubagentRecord) => void, more: () => void) {
		this.records = records;
		this.open = open;
		this.more = more;
	}
	invalidate(): void {}
	render(width: number): string[] {
		this.positions = [];
		if (!this.records.length || width < 1) return [];
		const records = [...this.records].sort((a, b) => {
			const active = (record: SubagentRecord) => (["running", "queued"].includes(record.status) ? 1 : 0);
			return active(b) - active(a) || b.startedAt - a.startedAt;
		});
		const prefix = `Subagents ${records.length} `;
		const count = Math.min(records.length, Math.max(1, Math.floor((width - prefix.length - 9) / 22)));
		const overflow = records.length > count ? ` +${records.length - count}` : "";
		const budget = Math.max(1, Math.floor((width - prefix.length - overflow.length - (count - 1) * 3) / count));
		let line = theme.fg("muted", prefix);
		this.positions.push({ from: 0, to: Math.min(width, prefix.length) });
		for (const [index, record] of records.slice(0, count).entries()) {
			if (index > 0) line += theme.fg("borderMuted", " │ ");
			const from = visibleWidth(line);
			const color =
				record.status === "completed"
					? "success"
					: record.status === "error"
						? "error"
						: ["running", "queued"].includes(record.status)
							? "accent"
							: "muted";
			const icon =
				record.status === "completed"
					? "✓"
					: record.status === "error"
						? "✗"
						: record.status === "running"
							? "⠋"
							: "◌";
			const duration = ` ${Math.max(0, Math.floor(((record.finishedAt ?? Date.now()) - record.startedAt) / 1000))}s`;
			const description = truncateToWidth(
				record.description || record.agent,
				Math.max(0, budget - duration.length - 2),
				"…",
			);
			const text = truncateToWidth(
				`${theme.fg(color, icon)} ${theme.bold(description)}${theme.fg("muted", duration)}`,
				budget,
				"…",
			);
			line += text;
			this.positions.push({ from, to: visibleWidth(line), record });
		}
		if (overflow) {
			const from = visibleWidth(line);
			line += theme.fg("accent", overflow);
			this.positions.push({ from, to: visibleWidth(line) });
		}
		return [truncateToWidth(line, width, "")];
	}
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.button !== "left" || event.y !== 0) return undefined;
		const position = this.positions.find((item) => event.x >= item.from && event.x < item.to);
		if (!position) return undefined;
		if (event.type === "press") return { handled: true, render: false };
		if (event.type !== "click") return undefined;
		if (position.record) this.open(position.record);
		else this.more();
		return { handled: true };
	}
}
