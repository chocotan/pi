// Adapted from pi-usage 0.2.0 (MIT, Copyright 2026 chocotan).
/** Native usage dashboard. Reads local session history; never calls a provider. */

import {
	type Component,
	type KeybindingsManager,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import {
	type Agg,
	aggregate,
	bucketOf,
	dayTotals,
	fmtCost,
	fmtNum,
	type Gran,
	type Rec,
	renderCalendar,
	type SessionScanner,
	shiftCursor,
	totals,
} from "./stats.ts";

export type View = Gran | "cal";
const VIEWS: View[] = ["day", "week", "month", "total", "cal"];

const padRight = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - visibleWidth(s)));
const padLeft = (s: string, w: number): string => " ".repeat(Math.max(0, w - visibleWidth(s))) + s;

export class UsageComponent implements Component {
	private tui: TUI;
	private theme: Theme;
	private done: (v: null) => void;
	private keybindings: KeybindingsManager;
	private scanner: SessionScanner;
	private sessionsDir: string;
	private controller: AbortController;
	private error?: string;
	private recs: Rec[] = [];
	private dayMap = new Map<string, number>();
	private scanning = false;
	private scanDone = 0;
	private scanTotal = 0;
	private view: View;
	private cursor: Date = new Date();
	private calEnd: Date = new Date();
	private scroll = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		done: (v: null) => void,
		view: View,
		scanner: SessionScanner,
		sessionsDir: string,
		controller: AbortController,
	) {
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.done = done;
		this.view = view;
		this.scanner = scanner;
		this.sessionsDir = sessionsDir;
		this.controller = controller;
		this.rescan();
	}

	private rescan(): void {
		if (this.scanning || this.controller.signal.aborted) return;
		this.scanning = true;
		this.scanDone = 0;
		this.scanTotal = 0;
		this.error = undefined;
		this.invalidate();
		this.tui.requestRender();
		void this.scanner
			.scan(
				this.sessionsDir,
				(done, total) => {
					if (this.controller.signal.aborted) return;
					this.scanDone = done;
					this.scanTotal = total;
					this.invalidate();
					this.tui.requestRender();
				},
				this.controller.signal,
			)
			.then((recs) => {
				if (this.controller.signal.aborted) return;
				this.recs = recs;
				this.dayMap = dayTotals(recs);
			})
			.catch(() => {
				if (!this.controller.signal.aborted) this.error = "Could not scan session history. Press rescan to retry.";
			})
			.finally(() => {
				if (this.controller.signal.aborted) return;
				this.scanning = false;
				this.invalidate();
				this.tui.requestRender();
			});
	}

	dispose(): void {
		this.controller.abort();
	}

	private setView(v: View): void {
		if (v === this.view) return;
		this.view = v;
		this.cursor = new Date();
		this.calEnd = new Date();
		this.scroll = 0;
		this.invalidate();
	}

	private move(dir: number): void {
		if (this.view === "total") return;
		if (this.view === "cal") {
			const next = new Date(this.calEnd);
			next.setDate(next.getDate() + 28 * dir); // jump 4 weeks
			if (next.getTime() > Date.now()) return; // no future travel
			this.calEnd = next;
		} else {
			const next = shiftCursor(this.cursor, this.view, dir);
			if (next.getTime() > Date.now()) return;
			this.cursor = next;
		}
		this.scroll = 0;
		this.invalidate();
	}

	handleInput(data: string): void {
		if (this.controller.signal.aborted) return;
		const kb = this.keybindings;
		if (kb.matches(data, "app.usage.close")) {
			this.dispose();
			this.done(null);
			return;
		}
		if (kb.matches(data, "app.usage.day")) this.setView("day");
		else if (kb.matches(data, "app.usage.week")) this.setView("week");
		else if (kb.matches(data, "app.usage.month")) this.setView("month");
		else if (kb.matches(data, "app.usage.total")) this.setView("total");
		else if (kb.matches(data, "app.usage.calendar")) this.setView("cal");
		else if (kb.matches(data, "app.usage.previous")) this.move(-1);
		else if (kb.matches(data, "app.usage.next")) this.move(1);
		else if (kb.matches(data, "app.usage.up")) {
			if (this.scroll > 0) {
				this.scroll--;
				this.invalidate();
			}
		} else if (kb.matches(data, "app.usage.down")) {
			this.scroll++;
			this.invalidate();
		} else if (kb.matches(data, "app.usage.rescan")) {
			this.rescan();
		}
		this.tui.requestRender();
	}

	private periodLabel(): string {
		if (this.view === "total") return "all time";
		if (this.view === "cal") {
			const cols = this.calCols();
			const c = renderCalendar(this.dayMap, this.calEnd, cols);
			return `${c.start} … ${c.end}`;
		}
		return bucketOf(this.cursor.getTime(), this.view);
	}

	private calCols(): number {
		const innerW = Math.max(0, (this.cachedWidth ?? 120) - 2);
		return Math.min(53, Math.max(4, Math.floor((innerW - 4) / 2)));
	}

	/** colorize the plain calendar grid: dim for empty, accent gradient for heat */
	private colorizeCalendar(plain: string[]): string[] {
		const th = this.theme;
		return plain.map((l) =>
			l
				.replace(/·/g, th.fg("dim", "·"))
				.replace(/░/g, th.fg("muted", "░"))
				.replace(/▒/g, th.fg("text", "▒"))
				.replace(/▓/g, th.fg("accent", "▓"))
				.replace(/█/g, th.fg("accent", th.bold("█"))),
		);
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		this.cachedWidth = width;
		const th = this.theme;
		const innerW = Math.max(0, width - 2);

		const tabs = VIEWS.map((v) =>
			v === this.view ? th.fg("accent", th.bold(` ${v} `)) : th.fg("muted", ` ${v} `),
		).join(th.fg("dim", "·"));

		const lines: string[] = [];
		if (this.view === "cal") {
			const c = renderCalendar(this.dayMap, this.calEnd, this.calCols());
			lines.push(
				th.fg("muted", "view ") + tabs + th.fg("muted", "  period ") + th.fg("accent", `${c.start} … ${c.end}`),
				th.fg("dim", "─".repeat(innerW)),
			);
			if (this.scanning) {
				lines.push(th.fg("muted", this.scanLabel()));
			} else if (this.error) {
				lines.push(th.fg("error", this.error));
			} else {
				lines.push(...this.colorizeCalendar(c.lines));
			}
		} else {
			lines.push(...this.renderTable(innerW, tabs));
		}
		const help = [
			`${this.keybindings.getKeys("app.usage.day").join("/")}/${this.keybindings.getKeys("app.usage.week").join("/")}/${this.keybindings.getKeys("app.usage.month").join("/")}/${this.keybindings.getKeys("app.usage.total").join("/")}/${this.keybindings.getKeys("app.usage.calendar").join("/")} view`,
			`${this.keybindings.getKeys("app.usage.previous").join("/")}/${this.keybindings.getKeys("app.usage.next").join("/")} period`,
			`${this.keybindings.getKeys("app.usage.up").join("/")}/${this.keybindings.getKeys("app.usage.down").join("/")} scroll`,
			`${this.keybindings.getKeys("app.usage.rescan").join("/")} rescan`,
			`${this.keybindings.getKeys("app.usage.close").join("/")} quit`,
		];
		lines.push(th.fg("dim", help.join(" · ")));

		// box it: full-width padded lines so the overlay composites opaquely
		const boxed = [
			th.fg("border", `╭${"─".repeat(innerW)}╮`),
			...lines.map((l) => th.fg("border", "│") + padRight(l, innerW) + th.fg("border", "│")),
			th.fg("border", `╰${"─".repeat(innerW)}╯`),
		];

		this.cachedLines = boxed.map((l) => truncateToWidth(l, width));
		this.cachedWidth = width;
		return this.cachedLines;
	}

	private scanLabel(): string {
		return this.scanTotal > 0 ? `Scanning sessions… ${this.scanDone}/${this.scanTotal}` : "Scanning sessions…";
	}

	private renderTable(innerW: number, tabs: string): string[] {
		const th = this.theme;
		const bucket = this.view === "total" ? null : bucketOf(this.cursor.getTime(), this.view as Gran);
		const rows = aggregate(this.recs, this.view as Gran, bucket);
		const sum = totals(rows);

		// column widths
		const pw = Math.min(
			18,
			rows.reduce((width, row) => Math.max(width, visibleWidth(row.p)), 8),
		);
		const mw = Math.min(
			26,
			rows.reduce((width, row) => Math.max(width, visibleWidth(row.m)), 5),
		);
		const numW = 8;
		const callsW = 6;
		const costW = 8;

		const header =
			padRight("Provider", pw) +
			" " +
			padRight("Model", mw) +
			" " +
			padLeft("Calls", callsW) +
			" " +
			padLeft("Input", numW) +
			" " +
			padLeft("Output", numW) +
			" " +
			padLeft("CacheR", numW) +
			" " +
			padLeft("CacheW", numW) +
			" " +
			padLeft("Total", numW) +
			" " +
			padLeft("Cost", costW);

		const fmtRow = (a: Agg): string =>
			padRight(truncateToWidth(a.p, pw, ""), pw) +
			" " +
			padRight(truncateToWidth(a.m, mw, ""), mw) +
			" " +
			padLeft(String(a.calls), callsW) +
			" " +
			padLeft(fmtNum(a.i), numW) +
			" " +
			padLeft(fmtNum(a.o), numW) +
			" " +
			padLeft(fmtNum(a.cr), numW) +
			" " +
			padLeft(fmtNum(a.cw), numW) +
			" " +
			padLeft(fmtNum(a.t), numW) +
			" " +
			padLeft(fmtCost(a.c), costW);

		// viewport: overlay maxHeight is 80% of terminal; keep chrome lines
		const maxLines = Math.max(1, Math.floor(this.tui.terminal.rows * 0.8) - 10);
		const maxScroll = Math.max(0, rows.length - maxLines);
		if (this.scroll > maxScroll) this.scroll = maxScroll;
		const visible = rows.slice(this.scroll, this.scroll + maxLines);

		const lines: string[] = [
			th.fg("muted", "view ") + tabs + th.fg("muted", "  period ") + th.fg("accent", this.periodLabel()),
			th.fg("dim", "─".repeat(innerW)),
			th.bold(header),
		];

		if (this.scanning) {
			lines.push(th.fg("muted", this.scanLabel()));
		} else if (this.error) {
			lines.push(th.fg("error", this.error));
		} else if (rows.length === 0) {
			lines.push(th.fg("muted", "No usage recorded for this period."));
		} else {
			for (const r of visible) lines.push(fmtRow(r));
			lines.push(th.fg("dim", "─".repeat(innerW)));
			lines.push(th.bold(fmtRow({ ...sum, p: "TOTAL", m: `${rows.length} models` })));
			if (maxScroll > 0) {
				lines.push(th.fg("dim", `${this.scroll + 1}-${this.scroll + visible.length} of ${rows.length}`));
			}
		}
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

export function parseView(args: string | undefined): View {
	const a = (args ?? "").trim().toLowerCase();
	return (VIEWS as string[]).includes(a) ? (a as View) : "day";
}
