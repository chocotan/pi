import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getKeybindings, setKeybindings, type TUI, type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { BackgroundTask } from "../src/extensions/background/registry.ts";
import { BackgroundDetailView, BackgroundPanel } from "../src/extensions/background/view.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const previousKeys = getKeybindings();
const ui = () => ({ terminal: { rows: 30 }, requestRender: vi.fn() }) as unknown as TUI;
const task = (id: number, status: BackgroundTask["status"] = "completed"): BackgroundTask => ({
	id: `b${id}`,
	name: "Raw task name",
	description: `Task description ${id}`,
	command: "fixture command",
	cwd: "/fixture",
	shell: "bash",
	status,
	startedAt: id * 1000,
	finishedAt: status === "running" ? undefined : id * 1000 + 500,
	outputPath: "",
	bytesWritten: 0,
	notifyOnCompletion: true,
	triggerOnCompletion: true,
});
const mouse = (x: number, y: number): TuiMouseEvent => ({
	type: "click",
	button: "left",
	x,
	y,
	screenX: x,
	screenY: y,
	width: 60,
	height: 30,
	shift: false,
	alt: false,
	ctrl: false,
	clickCount: 1,
});
let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "pie-background-view-"));
	initTheme("dark");
	setKeybindings(new KeybindingsManager());
});
afterEach(async () => {
	setKeybindings(previousKeys);
	vi.useRealTimers();
	await rm(directory, { recursive: true, force: true });
});
describe("background floating UI", () => {
	it("keeps a fixed heading, five description-first rows, active-first sorting and overflow", () => {
		const records = [task(1, "running"), ...Array.from({ length: 7 }, (_, index) => task(index + 2))];
		const open = vi.fn(),
			more = vi.fn(),
			close = vi.fn();
		const panel = new BackgroundPanel(ui(), () => records, open, more, close);
		for (const width of [1, 2, 10, 60])
			expect(panel.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
		const lines = panel.render(60).map(stripAnsi);
		expect(lines[0]).toContain("Background");
		expect(lines[1]).toContain("Task description 1");
		expect(lines.filter((line) => line.includes("Task description"))).toHaveLength(5);
		expect(lines.join("\n")).not.toContain("Raw task name");
		expect(lines[6]).toContain("+3 hidden");
		panel.handleMouse(mouse(4, 1));
		expect(open).toHaveBeenCalledWith(records[0]);
		panel.handleMouse(mouse(4, 6));
		expect(more).toHaveBeenCalledOnce();
		panel.handleMouse(mouse(57, 0));
		expect(close).toHaveBeenCalledOnce();
		expect("handleInput" in panel).toBe(false);
		panel.dispose();
	});
	it("still caps the panel at five when every task has finished", () => {
		const records = Array.from({ length: 8 }, (_, index) => task(index + 1));
		const panel = new BackgroundPanel(ui(), () => records, vi.fn(), vi.fn(), vi.fn());
		const lines = panel.render(60).map(stripAnsi);
		expect(lines.filter((line) => line.includes("Task description"))).toHaveLength(5);
		expect(lines[1]).toContain("Task description 8");
		expect(lines[6]).toContain("+3 hidden");
		panel.dispose();
	});
	it("disposes the shared activity animation when the panel closes or settles", () => {
		vi.useFakeTimers();
		const records = [task(1, "running")];
		const panel = new BackgroundPanel(ui(), () => records, vi.fn(), vi.fn(), vi.fn());
		panel.render(60);
		expect(vi.getTimerCount()).toBe(1);
		records[0].status = "completed";
		panel.render(60);
		expect(vi.getTimerCount()).toBe(0);
		records[0].status = "running";
		panel.render(60);
		panel.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("bounds detail rendering, uses remapped close keys and releases timers", async () => {
		const record = task(1);
		record.outputPath = join(directory, "fixture.output");
		await writeFile(record.outputPath, `fixture stdout\nfixture stderr\n${"many rows\n".repeat(100)}`);
		setKeybindings(new KeybindingsManager({ "tui.select.cancel": "ctrl+q" }));
		const done = vi.fn();
		const view = new BackgroundDetailView(ui(), () => record, done);
		for (const width of [1, 2, 10, 60]) {
			const lines = view.render(width);
			expect(lines).toHaveLength(30);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		}
		expect(stripAnsi(view.render(60).join("\n"))).toContain("Task description 1");
		expect(stripAnsi(view.render(60).at(-1)!)).toContain("ctrl+q back");
		view.handleInput("\x11");
		expect(done).toHaveBeenCalledOnce();
		view.handleMouse(mouse(57, 1));
		expect(done).toHaveBeenCalledTimes(2);
		view.dispose();
	});
});
