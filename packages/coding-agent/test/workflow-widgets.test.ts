import { type TUI, type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SubagentRecord } from "../src/extensions/subagents/index.ts";
import { SubagentStrip } from "../src/extensions/subagents/strip.ts";
import type { TaskState } from "../src/extensions/tasks/index.ts";
import { TodoPanel } from "../src/extensions/tasks/view.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const mouse = (x: number, y: number): TuiMouseEvent => ({
	type: "click",
	button: "left",
	x,
	y,
	screenX: x,
	screenY: y,
	width: 80,
	height: 24,
	shift: false,
	alt: false,
	ctrl: false,
	clickCount: 1,
});

describe("workflow floating and inline widgets", () => {
	beforeAll(() => initTheme("dark"));
	it("renders Todo subjects, stays bounded, updates, and closes from its own button", () => {
		let state: TaskState = {
			nextId: 2,
			tasks: [
				{
					id: "1",
					subject: "Verify title toggles",
					activeForm: "Verifying titles",
					description: "Private detailed requirements",
					status: "pending",
					blockedBy: [],
					metadata: {},
				},
			],
		};
		const close = vi.fn();
		const select = vi.fn();
		const panel = new TodoPanel(
			{ terminal: { rows: 24 }, requestRender: vi.fn() } as unknown as TUI,
			() => state,
			close,
			select,
		);
		for (const width of [10, 30, 80]) {
			const lines = panel.render(width);
			expect(lines.length).toBeLessThanOrEqual(8);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		}
		let text = stripAnsi(panel.render(80).join("\n"));
		expect(text).toContain("Verify title toggles");
		expect(text).not.toContain("Verifying titles");
		expect(text).not.toContain("Private detailed requirements");
		panel.handleMouse(mouse(3, 1));
		expect(select).toHaveBeenCalledWith(state.tasks[0]);
		state = { ...state, tasks: [{ ...state.tasks[0], status: "completed" }] };
		text = stripAnsi(panel.render(80).join("\n"));
		expect(text).toContain("Todo · 1/1");
		panel.handleMouse(mouse(76, 0));
		expect(close).toHaveBeenCalledOnce();
	});
	it("keeps subagents on one row with direct record clicks and a visible overflow entrance", () => {
		const record: SubagentRecord = {
			id: "1",
			agent: "worker",
			description: "Review tool titles",
			prompt: "Review",
			status: "completed",
			model: "faux/local",
			thinking: "off",
			startedAt: 0,
			finishedAt: 4000,
			output: "done",
		};
		const open = vi.fn();
		const more = vi.fn();
		const strip = new SubagentStrip([record], open, more);
		const line = stripAnsi(strip.render(80)[0]);
		expect(line).toContain("Review tool titles");
		expect(line).toContain("4s");
		strip.handleMouse(mouse(line.indexOf("Review"), 0));
		expect(open).toHaveBeenCalledWith(record);
		const crowded = new SubagentStrip(
			Array.from({ length: 10 }, (_, index) => ({ ...record, id: String(index) })),
			open,
			more,
		);
		for (const width of [10, 30, 80, 120]) {
			const rows = crowded.render(width);
			expect(rows).toHaveLength(1);
			expect(visibleWidth(rows[0])).toBeLessThanOrEqual(width);
		}
		const row = stripAnsi(crowded.render(80)[0]);
		expect(row).toMatch(/\+\d+/);
		crowded.handleMouse(mouse(row.indexOf("+"), 0));
		expect(more).toHaveBeenCalledOnce();
	});
});
