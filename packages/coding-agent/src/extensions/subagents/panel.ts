import {
	type Component,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { theme } from "../../modes/interactive/theme/theme.ts";
import type { SubagentRecord } from "./index.ts";

/** Floating run list, one entry per row, with direct detail and overflow entrances. */
export class SubagentPanel implements Component {
	private readonly ui: TUI;
	private readonly records: readonly SubagentRecord[];
	private readonly open: (record: SubagentRecord) => void;
	private readonly more: () => void;
	private readonly close: () => void;
	private rows: Array<SubagentRecord | undefined> = [];
	private width = 0;
	constructor(
		ui: TUI,
		records: readonly SubagentRecord[],
		open: (record: SubagentRecord) => void,
		more: () => void,
		close: () => void,
	) {
		this.ui = ui;
		this.records = records;
		this.open = open;
		this.more = more;
		this.close = close;
	}
	invalidate(): void {}
	render(width: number): string[] {
		this.width = width;
		this.rows = [];
		if (!this.records.length || width < 1) return [];
		const sorted = [...this.records].sort((a, b) => {
			const active = (record: SubagentRecord) => (["running", "queued"].includes(record.status) ? 1 : 0);
			return active(b) - active(a) || b.startedAt - a.startedAt;
		});
		const finished = (record: SubagentRecord) =>
			["completed", "error", "stopped", "interrupted"].includes(record.status);
		const active = sorted.filter((record) => !finished(record));
		const records = sorted.length > 5 ? (active.length ? active : sorted.slice(0, 1)) : sorted;
		const hidden = sorted.length - records.length;
		const title = truncateToWidth(`Subagents · ${records.length}/${sorted.length}`, Math.max(0, width - 8), "…");
		const lines = [
			`╭ ${theme.fg("accent", theme.bold(title))}${" ".repeat(Math.max(0, width - visibleWidth(title) - 7))}[x] ╮`,
		];
		const availableRows = Math.max(1, Math.floor(this.ui.terminal.rows * 0.3) - 2);
		const count = records.length > availableRows ? Math.max(1, availableRows - 1) : records.length;
		const inner = Math.max(0, width - 4);
		for (const record of records.slice(0, count)) {
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
			const end =
				record.finishedAt ??
				(record.status === "running" || record.status === "queued" ? Date.now() : record.startedAt);
			const duration = ` ${Math.max(0, Math.floor((end - record.startedAt) / 1000))}s`;
			const description = truncateToWidth(
				record.description || record.agent,
				Math.max(0, inner - duration.length - 2),
				"…",
			);
			const text = truncateToWidth(
				`${theme.fg(color, icon)} ${theme.bold(description)}${theme.fg("muted", duration)}`,
				inner,
				"",
			);
			lines.push(`│ ${text}${" ".repeat(Math.max(0, inner - visibleWidth(text)))} │`);
			this.rows.push(record);
		}
		const overflow = hidden + Math.max(0, records.length - count);
		if (overflow) {
			const text = truncateToWidth(theme.fg("muted", `+${overflow} hidden · view all`), inner, "…");
			lines.push(`│ ${text}${" ".repeat(Math.max(0, inner - visibleWidth(text)))} │`);
			this.rows.push(undefined);
		}
		lines.push(`╰${"─".repeat(Math.max(0, width - 2))}╯`);
		return lines.map((line) => truncateToWidth(line, width, ""));
	}
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.button !== "left") return undefined;
		const closing = event.y === 0 && event.x >= Math.max(0, this.width - 6);
		if (!closing && (event.y < 1 || event.y > this.rows.length)) return undefined;
		if (event.type === "press") return { handled: true, render: false };
		if (event.type !== "click") return undefined;
		if (closing) this.close();
		else {
			const record = this.rows[event.y - 1];
			if (record) this.open(record);
			else this.more();
		}
		return { handled: true };
	}
}
