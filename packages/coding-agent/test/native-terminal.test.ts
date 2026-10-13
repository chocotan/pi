import { Container, CURSOR_MARKER, Text, type TUI, TuiAltScreen, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderLayoutFrame } from "../../tui/src/layout.ts";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { createChatViewport, type SidebarMode } from "../src/modes/interactive/chat-viewport.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { formatUsageLine } from "../src/modes/interactive/components/footer.ts";
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
	it("keeps token categories on one row at standard narrow widths", () => {
		for (const width of [48, 80, 120]) {
			const line = formatUsageLine(
				{ input: 332000, output: 11000, cacheRead: 3600000, cacheWrite: 123000, cost: 0 },
				99.5,
				width,
			);
			expect(line).not.toContain("\n");
			expect(line).toContain("↑");
			expect(line).toContain("↓");
			expect(line).toContain("CH99.5%");
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
	it("uses a full-height sidebar and a full-width panel on narrow screens", () => {
		let mode: SidebarMode = "auto";
		const viewport = createChatViewport({
			document: new Text("Conversation", 0, 0),
			pendingMessages: new Container(),
			status: new Container(),
			editor: new Text("Message", 0, 0),
			footer: new Text("Tokens", 0, 0),
			sidebar: new Text("Todo\nSubagents", 0, 0),
			sidebarMode: () => mode,
		});
		const wide = renderLayoutFrame(viewport.root, 120, 24, () => {});
		const side = wide.root.children.find((box) => box.component === viewport.sidebar)!;
		expect(side.rect).toMatchObject({ y: 0, height: 24, width: 30 });
		expect(side.rect.x).toBe(90);
		const narrow = renderLayoutFrame(viewport.root, 80, 24, () => {});
		expect(narrow.root.children).toHaveLength(1);
		expect(narrow.root.children[0].rect.width).toBe(80);
		mode = "panel";
		const panel = renderLayoutFrame(viewport.root, 80, 24, () => {});
		expect(panel.root.children).toHaveLength(1);
		expect(panel.root.children[0].component).toBe(viewport.sidebar);
		expect(panel.root.children[0].rect.width).toBe(80);
	});
	it("does not scroll the conversation when a contained sidebar reaches its end", async () => {
		const terminal = new VirtualTerminal(120, 12);
		const ui = new TuiAltScreen(terminal);
		const viewport = createChatViewport({
			document: new Text(Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n"), 0, 0),
			pendingMessages: new Container(),
			status: new Container(),
			editor: new Text("Message", 0, 0),
			footer: new Text("Tokens", 0, 0),
			sidebar: new Text("Todo", 0, 0),
		});
		ui.setLayoutRoot(viewport.root);
		ui.start();
		try {
			await terminal.waitForRender();
			const before = viewport.transcript.scrollTop;
			terminal.sendInput("\x1b[<64;100;3M");
			await terminal.waitForRender();
			expect(viewport.transcript.scrollTop).toBe(before);
		} finally {
			ui.stop({ preserveScreen: true });
		}
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
