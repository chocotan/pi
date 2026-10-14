import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { TUI } from "@earendil-works/pi-tui";
import { type Component, Container, Text } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { createInteractiveTui, InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme, type Theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const thinkingMessage: AssistantMessage = {
	role: "assistant",
	content: [{ type: "thinking", thinking: "hidden content" }],
	api: "openai-responses",
	provider: "test",
	model: "test",
	timestamp: 0,
	stopReason: "stop",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
};

describe("native UI regressions", () => {
	beforeAll(() => initTheme("dark"));
	it.each(["read", "fallback", "self", "thought"])("keeps the %s header clickable after expansion", async (kind) => {
		const terminal = new VirtualTerminal(80, 24);
		const ui = createInteractiveTui({
			tuiMode: "fullscreen",
			terminal,
			showHardwareCursor: false,
			logDirectory: "/tmp",
		});
		const component =
			kind === "thought"
				? new AssistantMessageComponent(thinkingMessage)
				: new ToolExecutionComponent(
						kind,
						"call",
						{ path: "notes.txt" },
						{},
						kind === "read"
							? createReadToolDefinition("/tmp")
							: kind === "self"
								? {
										renderShell: "self",
										renderCall: () => new Text("self call", 0, 0),
										renderResult: () => new Text("hidden content", 0, 0),
									}
								: undefined,
						ui,
						"/tmp",
					);
		if (component instanceof ToolExecutionComponent)
			component.updateResult({
				content: [{ type: "text", text: "hidden content" }],
				isError: false,
				durationMs: 4200,
			});
		ui.setLayoutRoot(component);
		ui.start();
		try {
			await terminal.waitForRender();
			for (const expanded of [true, false, true, false]) {
				const row = terminal.getViewport().findIndex((line) => line.includes(expanded ? "▸" : "▾"));
				expect(row).toBeGreaterThanOrEqual(0);
				terminal.sendInput(`\x1b[<0;3;${row + 1}M`);
				terminal.sendInput(`\x1b[<0;3;${row + 1}m`);
				await terminal.waitForRender();
				const screen = terminal.getViewport().join("\n");
				expect(screen).toContain(expanded ? "▾" : "▸");
				expect(screen.includes("hidden content")).toBe(expanded);
			}
		} finally {
			ui.stop();
		}
	});

	it("renders one shared expansion hint for multiple tool calls", () => {
		const ui = createInteractiveTui({
			tuiMode: "fullscreen",
			terminal: new VirtualTerminal(),
			showHardwareCursor: false,
			logDirectory: "/tmp",
		});
		const chatContainer = new Container();
		for (const id of ["one", "two"]) {
			chatContainer.addChild(
				new ToolExecutionComponent(
					"read",
					id,
					{ path: "AGENTS.md" },
					{},
					createReadToolDefinition("/tmp"),
					ui,
					"/tmp",
				),
			);
		}
		const context = { chatContainer, toolOutputExpanded: false, outputPad: 1 };
		const prototype = InteractiveMode.prototype as unknown as {
			renderToolExpansionHint(this: typeof context, width: number): string[];
		};
		const text = stripAnsi(
			[...chatContainer.render(80), ...prototype.renderToolExpansionHint.call(context, 80)].join("\n"),
		);
		expect(text.match(/to expand/g)).toHaveLength(1);
		expect(text.trimEnd().endsWith("to expand")).toBe(true);
		context.toolOutputExpanded = true;
		expect(prototype.renderToolExpansionHint.call(context, 80)).toEqual([]);
		context.toolOutputExpanded = false;
		chatContainer.clear();
		expect(prototype.renderToolExpansionHint.call(context, 80)).toEqual([]);
	});

	it("closing a lower non-capturing overlay does not close the detail above it", async () => {
		const hideTodo = vi.fn();
		const hideDetail = vi.fn();
		const ui = {
			showOverlay: vi.fn().mockReturnValueOnce({ hide: hideTodo }).mockReturnValueOnce({ hide: hideDetail }),
			requestRender: vi.fn(),
			hideOverlay: vi.fn(),
		};
		const context = {
			editor: { getText: () => "draft", setText: vi.fn() },
			editorContainer: new Container(),
			ui: ui as unknown as TUI,
			keybindings: new KeybindingsManager(),
		};
		const prototype = InteractiveMode.prototype as unknown as {
			showExtensionCustom(
				this: typeof context,
				factory: (ui: TUI, theme: Theme, keys: KeybindingsManager, done: () => void) => Component,
				options: { overlay: true },
			): Promise<void>;
		};
		let doneTodo!: () => void;
		let doneDetail!: () => void;
		const todo = prototype.showExtensionCustom.call(
			context,
			(_ui, _theme, _keys, done) => {
				doneTodo = done;
				return new Text("Todo", 0, 0);
			},
			{ overlay: true },
		);
		await Promise.resolve();
		const detail = prototype.showExtensionCustom.call(
			context,
			(_ui, _theme, _keys, done) => {
				doneDetail = done;
				return new Text("Detail", 0, 0);
			},
			{ overlay: true },
		);
		await Promise.resolve();
		doneTodo();
		await todo;
		expect(hideTodo).toHaveBeenCalledOnce();
		expect(hideDetail).not.toHaveBeenCalled();
		doneDetail();
		await detail;
		expect(hideDetail).toHaveBeenCalledOnce();
		expect(ui.hideOverlay).not.toHaveBeenCalled();
		expect(context.editor.setText).not.toHaveBeenCalled();
	});
});
