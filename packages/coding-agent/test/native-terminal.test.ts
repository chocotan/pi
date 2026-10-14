import { Container, CURSOR_MARKER, Text, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderLayoutFrame } from "../../tui/src/layout.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { createChatViewport } from "../src/modes/interactive/chat-viewport.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";
import { TurnClock } from "../src/modes/interactive/turn-clock.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("native terminal layout", () => {
	beforeAll(() => initTheme("dark", false));
	afterEach(() => vi.useRealTimers());
	it("renders round editor borders without losing the cursor or thinking level", () => {
		const tui = { terminal: { rows: 24 }, requestRender: vi.fn() } as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), new KeybindingsManager(), {
			getChrome: () => ({ model: "a-long-model-name-".repeat(4), thinking: "high", status: "Running 12.4s" }),
		});
		editor.focused = true;
		editor.setText("你好\nsecond line");
		for (const width of [1, 2, 4, 10, 48, 80, 120]) {
			const lines = editor.render(width);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			expect(lines.join("\n")).toContain(CURSOR_MARKER);
			if (width >= 48) {
				expect(stripAnsi(lines[0])).toContain("high");
				expect(stripAnsi(lines[0])).toContain("Running 12.4s");
				expect(stripAnsi(lines[0]).startsWith("╭")).toBe(true);
				expect(stripAnsi(lines.at(-1)!).endsWith("╯")).toBe(true);
			}
		}
	});
	it.each(["Ready", "Running 12.4s", "Done 12.4s", "Stopped 12.4s", "Failed 12.4s"])(
		"left-aligns %s without overflowing narrow borders",
		(status) => {
			const tui = { terminal: { rows: 12 }, requestRender: vi.fn() } as unknown as TUI;
			const editor = new CustomEditor(tui, getEditorTheme(), new KeybindingsManager(), {
				getChrome: () => ({ model: "", status }),
			});
			for (const width of [1, 2, 4, 10, 20, 48, 120]) {
				const line = editor.render(width)[0];
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				if (width >= 20) expect(stripAnsi(line).startsWith(`╭─ ${status}`)).toBe(true);
			}
		},
	);
	it.each([40, 80, 120, 180])("uses the full %s-column width for the conversation and input dock", (width) => {
		const viewport = createChatViewport({
			document: new Text("Conversation", 0, 0),
			pendingMessages: new Container(),
			status: new Container(),
			widgetsAbove: new Text("Subagents 2", 0, 0),
			editor: new Text("Message", 0, 0),
			footer: new Text("Tokens", 0, 0),
		});
		const frame = renderLayoutFrame(viewport.root, width, 24, () => {});
		expect(frame.root.children).toHaveLength(2);
		expect(frame.root.children.every((box) => box.rect.x === 0 && box.rect.width === width)).toBe(true);
	});
	it("keeps one elapsed clock through retries and clears its timer", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1000);
		const clock = new TurnClock();
		const render = vi.fn();
		clock.start(render);
		vi.advanceTimersByTime(2500);
		clock.start(render);
		expect(clock.label).toBe("Running 2.5s");
		clock.finish("Done");
		vi.advanceTimersByTime(5000);
		expect(clock.label).toBe("Done 2.5s");
		expect(render).toHaveBeenCalledTimes(2);
		clock.reset();
		expect(clock.label).toBe("Ready");
	});
});
