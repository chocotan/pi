import { type TUI, type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SubagentRecord } from "../src/extensions/subagents/index.ts";
import { SubagentPanel } from "../src/extensions/subagents/panel.ts";
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
		state = {
			nextId: 8,
			tasks: [
				...Array.from({ length: 4 }, (_, index) => ({
					...state.tasks[0],
					id: String(index + 1),
					subject: `Done ${index}`,
					status: "completed" as const,
				})),
				...Array.from({ length: 3 }, (_, index) => ({
					...state.tasks[0],
					id: String(index + 5),
					subject: `Open ${index}`,
					status: "pending" as const,
				})),
			],
		};
		text = stripAnsi(panel.render(80).join("\n"));
		expect(text).toContain("4 done hidden");
		expect(text).not.toContain("Done 0");
		expect(text).toContain("Open 0");
		panel.handleMouse(mouse(76, 0));
		expect(close).toHaveBeenCalledOnce();
	});
	it("renders subagents on separate rows with direct clicks and a visible overflow entrance", () => {
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
		const ui = { terminal: { rows: 24 }, requestRender: vi.fn() } as unknown as TUI;
		const close = vi.fn();
		const panel = new SubagentPanel(
			ui,
			[record, { ...record, id: "2", description: "Verify terminal layout", startedAt: 1 }],
			open,
			more,
			close,
		);
		const rows = panel.render(80).map(stripAnsi);
		expect(rows[1]).toContain("Verify terminal layout");
		expect(rows[2]).toContain("Review tool titles");
		expect(rows[2]).toContain("4s");
		panel.handleMouse(mouse(3, 2));
		expect(open).toHaveBeenCalledWith(record);
		panel.handleMouse(mouse(76, 0));
		expect(close).toHaveBeenCalledOnce();
		const mixed = new SubagentPanel(
			ui,
			[
				...Array.from({ length: 4 }, (_, index) => ({
					...record,
					id: `done-${index}`,
					description: `Done ${index}`,
				})),
				...Array.from({ length: 3 }, (_, index) => ({
					...record,
					id: `run-${index}`,
					description: `Running ${index}`,
					status: "running" as const,
					finishedAt: undefined,
				})),
			],
			open,
			more,
			close,
		);
		const mixedText = stripAnsi(mixed.render(80).join("\n"));
		expect(mixedText).toContain("Subagents · 3/7");
		expect(mixedText).not.toContain("Done 0");
		expect(mixedText).toContain("Running 0");
		const crowded = new SubagentPanel(
			ui,
			Array.from({ length: 10 }, (_, index) => ({ ...record, id: String(index) })),
			open,
			more,
			close,
		);
		for (const width of [10, 30, 80, 120]) {
			const lines = crowded.render(width);
			expect(lines.length).toBeGreaterThan(1);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		}
		const lines = crowded.render(80).map(stripAnsi);
		const moreRow = lines.findIndex((line) => line.includes("view all"));
		expect(moreRow).toBeGreaterThan(0);
		crowded.handleMouse(mouse(3, moreRow));
		expect(more).toHaveBeenCalledOnce();
	});
});
