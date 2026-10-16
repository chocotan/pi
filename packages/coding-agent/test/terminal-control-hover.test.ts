import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Container, Spacer, Text, type TUI, TuiAltScreen } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import type { SubagentRecord } from "../src/extensions/subagents/index.ts";
import { SubagentPanel } from "../src/extensions/subagents/panel.ts";
import { SubagentDetailView } from "../src/extensions/subagents/view.ts";
import type { TaskState } from "../src/extensions/tasks/index.ts";
import { TodoPanel } from "../src/extensions/tasks/view.ts";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { highlightHover } from "../src/modes/interactive/components/hover-style.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

async function move(terminal: VirtualTerminal, x: number, y: number): Promise<void> {
	terminal.sendInput(`\x1b[<35;${x + 1};${y + 1}M`);
	await terminal.waitForRender();
}

function tool(ui: TUI): ToolExecutionComponent {
	const component = new ToolExecutionComponent(
		"read",
		"hover-read",
		{ path: "notes.txt" },
		{},
		undefined,
		ui,
		process.cwd(),
	);
	component.setLeadingGap(false);
	component.updateResult({ content: [{ type: "text", text: "selectable output" }], isError: false });
	return component;
}

function expectHighlight(tui: TuiAltScreen, row: number, original: string): void {
	const line = tui.getScreenLines()[row];
	expect(stripAnsi(line)).toBe(stripAnsi(original));
	expect(line).not.toBe(original);
	expect(line).toContain(theme.bg("selectedBg", "X").split("X")[0]);
}

describe("terminal control hover", () => {
	beforeEach(() => initTheme("dark"));

	it("keeps hover visible when the selection background is transparent", () => {
		initTheme("system");
		expect(theme.getBgAnsi("selectedBg")).toBe("\x1b[49m");
		const styled = highlightHover("Clickable title");
		expect(stripAnsi(styled)).toBe("Clickable title");
		expect(styled).toContain("\x1b[4m");
	});

	it("highlights tool and thought headers, clears on leave and focus loss, and preserves keyboard focus", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui = new TuiAltScreen(terminal);
		const read = tool(tui);
		const thought = new AssistantMessageComponent(
			fauxAssistantMessage([
				{ type: "thinking", thinking: "Detailed reasoning" },
				{ type: "text", text: "Answer" },
			]),
		);
		tui.addChild(read);
		tui.addChild(thought);
		const focus = { render: () => ["editor"], invalidate() {}, handleInput: vi.fn() };
		tui.addChild(focus);
		tui.setFocus(focus);
		tui.start();
		try {
			await terminal.waitForRender();
			const baseline = tui.getScreenLines();
			const toolRow = baseline.findIndex((line) => stripAnsi(line).includes("notes.txt"));
			const thoughtRow = baseline.findIndex((line) => stripAnsi(line).includes("Thought"));
			expect(toolRow).toBeGreaterThanOrEqual(0);
			expect(thoughtRow).toBeGreaterThan(toolRow);
			await move(terminal, 3, toolRow);
			expectHighlight(tui, toolRow, baseline[toolRow]);
			expect(tui.getFocusedComponent()).toBe(focus);
			await move(terminal, 4, toolRow);
			expectHighlight(tui, toolRow, baseline[toolRow]);
			await move(terminal, 3, thoughtRow);
			expect(tui.getScreenLines()[toolRow]).toBe(baseline[toolRow]);
			expectHighlight(tui, thoughtRow, baseline[thoughtRow]);
			await move(terminal, 3, 20);
			expect(tui.getScreenLines()[thoughtRow]).toBe(baseline[thoughtRow]);
			await move(terminal, 3, thoughtRow);
			terminal.sendInput("\x1b[O");
			await terminal.waitForRender();
			expect(tui.getScreenLines()[thoughtRow]).toBe(baseline[thoughtRow]);
			terminal.sendInput("x");
			expect(focus.handleInput).toHaveBeenCalledWith("x");
			// Hover must not claim the next click or prevent expansion.
			await move(terminal, 3, toolRow);
			terminal.sendInput(`\x1b[<0;4;${toolRow + 1}M`);
			terminal.sendInput(`\x1b[<0;4;${toolRow + 1}m`);
			await terminal.waitForRender();
			expect(terminal.getViewport().join("\n")).toContain("selectable output");
		} finally {
			tui.stop();
			read.dispose();
		}
	});

	it("keeps transcript selection and cancelled header drags intact after hovering", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const copied = vi.fn(async (_text: string) => true);
		const tui = new TuiAltScreen(terminal, undefined, undefined, { copySelection: copied });
		const read = tool(tui);
		tui.addChild(new Text("select from here", 0, 0));
		tui.addChild(read);
		tui.start();
		try {
			await terminal.waitForRender();
			await move(terminal, 3, 1);
			terminal.sendInput("\x1b[<0;1;1M");
			terminal.sendInput("\x1b[<32;10;2M");
			terminal.sendInput("\x1b[<0;10;2m");
			await terminal.waitForRender();
			expect(copied).toHaveBeenCalledOnce();
			expect(copied.mock.calls[0][0]).toContain("select from here");
			expect(tui.hasActiveSelection()).toBe(true);
			expect(terminal.getViewport().join("\n")).not.toContain("selectable output");
			await move(terminal, 3, 1);
			terminal.sendInput("\x1b[<0;4;2M");
			terminal.sendInput("\x1b[<32;15;3M");
			terminal.sendInput("\x1b[<0;15;3m");
			await terminal.waitForRender();
			expect(terminal.getViewport().join("\n")).not.toContain("selectable output");
			expect(copied).toHaveBeenCalledOnce();
		} finally {
			tui.stop();
			read.dispose();
		}
	});

	it("clears hover for wheel, programmatic scroll, follow-output, and resizing", async () => {
		const terminal = new VirtualTerminal(80, 6);
		const tui = new TuiAltScreen(terminal);
		const read = tool(tui);
		tui.addChild(new Text("one\ntwo\nthree\nfour\nfive\nsix", 0, 0));
		tui.addChild(read);
		tui.start();
		try {
			await terminal.waitForRender();
			const baseline = read.render(80)[0];
			await move(terminal, 3, 5);
			expect(read.render(80)[0]).not.toBe(baseline);
			terminal.sendInput("\x1b[<64;4;6M");
			await terminal.waitForRender();
			expect(read.render(80)[0]).toBe(baseline);
			tui.scrollToBottom();
			await terminal.waitForRender();
			await move(terminal, 3, 5);
			tui.scrollBy(-1);
			await terminal.waitForRender();
			expect(read.render(80)[0]).toBe(baseline);
			tui.scrollToBottom();
			await terminal.waitForRender();
			await move(terminal, 3, 5);
			tui.addChild(new Text("new output", 0, 0));
			tui.requestRender();
			await terminal.waitForRender();
			expect(read.render(80)[0]).toBe(baseline);
			await move(terminal, 3, 4);
			terminal.resize(100, 8);
			await terminal.waitForRender();
			expect(read.render(80)[0]).toBe(baseline);
		} finally {
			tui.stop();
			read.dispose();
		}
	});

	it.each([false, true])(
		"clears a child hover when content reflows without pointer motion (overlay=%s)",
		async (overlay) => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TuiAltScreen(terminal);
			const root = new Container();
			const before = new Spacer(1);
			const after = new Spacer(6);
			const read = tool(tui);
			root.addChild(before);
			root.addChild(read);
			root.addChild(after);
			if (overlay) tui.showOverlay(root, { width: 40 });
			else tui.setLayoutRoot(root);
			tui.start();
			try {
				await terminal.waitForRender();
				const row = tui.getScreenLines().findIndex((line) => stripAnsi(line).includes("notes.txt"));
				const baseline = read.render(overlay ? 40 : 80)[0];
				await move(terminal, overlay ? 23 : 3, row);
				expect(read.render(overlay ? 40 : 80)[0]).not.toBe(baseline);
				before.setLines(3);
				if (!overlay) after.setLines(4);
				tui.requestRender();
				await terminal.waitForRender();
				expect(read.render(overlay ? 40 : 80)[0]).toBe(baseline);
			} finally {
				tui.stop();
				read.dispose();
			}
		},
	);

	it("highlights wrapped Todo items and its close button independently, clearing across overlay transitions", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui = new TuiAltScreen(terminal);
		const read = tool(tui);
		tui.addChild(read);
		const state: TaskState = {
			nextId: 3,
			tasks: Array.from({ length: 2 }, (_, index) => ({
				id: String(index + 1),
				subject: "A task subject long enough to wrap into multiple panel rows",
				description: "Private detail",
				status: "pending",
				blockedBy: [],
				metadata: {},
			})),
		};
		const close = vi.fn();
		const select = vi.fn();
		const panel = new TodoPanel(tui, () => state, close, select, vi.fn());
		tui.start();
		try {
			await terminal.waitForRender();
			await move(terminal, 3, 0);
			const handle = tui.showOverlay(panel, { row: 2, col: 10, width: 32, nonCapturing: true });
			await terminal.waitForRender();
			expect(read.render(80)[0]).not.toContain(theme.bg("selectedBg", "X").split("X")[0]);
			const baseline = tui.getScreenLines();
			await move(terminal, 14, 3);
			expectHighlight(tui, 3, baseline[3]);
			expectHighlight(tui, 4, baseline[4]);
			expect(select).not.toHaveBeenCalled();
			await move(terminal, 38, 2);
			expect(tui.getScreenLines()[3]).toBe(baseline[3]);
			expectHighlight(tui, 2, baseline[2]);
			expect(close).not.toHaveBeenCalled();
			handle.setHidden(true);
			await terminal.waitForRender();
			handle.setHidden(false);
			await terminal.waitForRender();
			expect(tui.getScreenLines()[2]).toBe(baseline[2]);
			await move(terminal, 14, 3);
			terminal.sendInput("\x1b[<65;15;4M");
			await terminal.waitForRender();
			expect(panel.render(32).join("\n")).not.toContain(theme.bg("selectedBg", "X").split("X")[0]);
			await move(terminal, 38, 2);
			handle.hide();
			await terminal.waitForRender();
			expect(panel.render(32).join("\n")).not.toContain(theme.bg("selectedBg", "X").split("X")[0]);
		} finally {
			tui.stop();
			read.dispose();
		}
	});

	it("moves directly from detail close to a tool title in one pointer event", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui = new TuiAltScreen(terminal);
		const detail = new SubagentDetailView(
			tui,
			() => ({
				agent: "worker",
				description: "Child hover",
				status: "completed",
				model: "faux/local",
				thinking: "off",
				startedAt: 0,
				finishedAt: 1,
				messages: [
					fauxAssistantMessage(fauxToolCall("bash", { command: "df -h" }, { id: "disk" })),
					{
						role: "toolResult",
						toolCallId: "disk",
						toolName: "bash",
						content: [{ type: "text", text: "Child output" }],
						isError: false,
						timestamp: 1,
					},
				],
			}),
			vi.fn(),
		);
		tui.showOverlay(detail, { row: 0, col: 0, width: 80 });
		tui.start();
		try {
			await terminal.waitForRender();
			const baseline = tui.getScreenLines();
			const row = baseline.findIndex((line) => stripAnsi(line).includes("$ df -h"));
			expect(row).toBeGreaterThan(3);
			await move(terminal, 77, 1);
			expectHighlight(tui, 1, baseline[1]);
			await move(terminal, 3, row);
			expect(tui.getScreenLines()[1]).toBe(baseline[1]);
			expectHighlight(tui, row, baseline[row]);
			await move(terminal, 3, 23);
			expect(tui.getScreenLines()[row]).toBe(baseline[row]);
		} finally {
			tui.stop();
			detail.dispose();
		}
	});

	it("highlights Subagent rows, overflow, panel close, and detail close without activating them", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui = new TuiAltScreen(terminal);
		const records: SubagentRecord[] = Array.from({ length: 10 }, (_, index) => ({
			id: String(index),
			agent: "worker",
			description: `Work ${index}`,
			prompt: "Work",
			status: "completed",
			model: "faux/local",
			thinking: "off",
			startedAt: 0,
			finishedAt: 4000,
			output: "",
		}));
		const open = vi.fn();
		const more = vi.fn();
		const close = vi.fn();
		const panel = new SubagentPanel(tui, records, open, more, close);
		const handle = tui.showOverlay(panel, { row: 0, col: 0, width: 40 });
		tui.start();
		try {
			await terminal.waitForRender();
			let baseline = tui.getScreenLines();
			await move(terminal, 3, 1);
			expectHighlight(tui, 1, baseline[1]);
			const overflow = terminal.getViewport().findIndex((line) => line.includes("view all"));
			expect(overflow).toBeGreaterThan(1);
			await move(terminal, 3, overflow);
			expect(tui.getScreenLines()[1]).toBe(baseline[1]);
			expectHighlight(tui, overflow, baseline[overflow]);
			await move(terminal, 36, 0);
			expectHighlight(tui, 0, baseline[0]);
			expect(open).not.toHaveBeenCalled();
			expect(more).not.toHaveBeenCalled();
			expect(close).not.toHaveBeenCalled();
			handle.hide();
			const done = vi.fn();
			const detail = new SubagentDetailView(
				tui,
				() => ({
					agent: "worker",
					description: "Inspect result",
					status: "completed",
					model: "faux/local",
					thinking: "off",
					startedAt: 0,
					finishedAt: 0,
					messages: [],
				}),
				done,
			);
			const detailHandle = tui.showOverlay(detail, { row: 0, col: 0, width: 80 });
			await terminal.waitForRender();
			baseline = tui.getScreenLines();
			await move(terminal, 77, 1);
			expectHighlight(tui, 1, baseline[1]);
			expect(done).not.toHaveBeenCalled();
			await move(terminal, 4, 2);
			expect(tui.getScreenLines()[1]).toBe(baseline[1]);
			await move(terminal, 77, 1);
			detailHandle.hide();
			await terminal.waitForRender();
			expect(detail.render(80)[1]).not.toContain(theme.bg("selectedBg", "X").split("X")[0]);
			detail.dispose();
		} finally {
			tui.stop();
		}
	});
});
