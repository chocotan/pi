import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { type Rec, SessionScanner } from "../src/extensions/usage/stats.ts";
import { parseView, UsageComponent, type View } from "../src/extensions/usage/view.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const fixtures = (): Rec[] =>
	Array.from({ length: 30 }, (_, i) => ({
		p: "provider",
		m: `model-${String(i).padStart(2, "0")}`,
		ts: new Date(2026, 0, 15).getTime(),
		i: 100,
		o: 20,
		cr: 10,
		cw: 5,
		rs: 2,
		t: 1000 - i,
		c: 0,
	}));

describe("usage native overlay", () => {
	const components: UsageComponent[] = [];
	beforeEach(() => {
		initTheme("dark");
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 0, 15, 12));
	});
	afterEach(() => {
		for (const component of components.splice(0)) component.dispose();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	function setup(view: View = "day", keys = new KeybindingsManager(), records = fixtures()) {
		const requestRender = vi.fn();
		const done = vi.fn();
		const scanner = new SessionScanner();
		const scan = vi.spyOn(scanner, "scan").mockResolvedValue(records);
		const controller = new AbortController();
		const component = new UsageComponent(
			{ terminal: { rows: 20 }, requestRender } as unknown as TUI,
			theme,
			keys,
			done,
			view,
			scanner,
			"unused-fixture-path",
			controller,
		);
		components.push(component);
		return { component, scanner, scan, controller, requestRender, done };
	}
	const text = (component: UsageComponent, width = 150) => stripAnsi(component.render(width).join("\n"));

	it("preserves command arguments and defaults unknown views to today", () => {
		for (const view of ["day", "week", "month", "total", "cal"] as const)
			expect(parseView(` ${view.toUpperCase()} `)).toBe(view);
		for (const arg of [undefined, "", "unsupported"]) expect(parseView(arg)).toBe("day");
	});

	it("switches all views, navigates periods, and prevents future travel", async () => {
		const { component } = setup();
		await vi.waitFor(() => expect(text(component)).toContain("model-00"));
		component.handleInput("\x1b[C");
		expect(text(component)).toContain("2026-01-15");
		component.handleInput("\x1b[D");
		expect(text(component)).toContain("2026-01-14");
		expect(text(component)).toContain("No usage recorded");
		component.handleInput("\x1b[C");
		expect(text(component)).toContain("model-00");
		component.handleInput("w");
		expect(text(component)).toContain("2026-W03");
		component.handleInput("m");
		expect(text(component)).toContain("2026-01");
		component.handleInput("t");
		expect(text(component)).toContain("all time");
		component.handleInput("\x1b[D");
		expect(text(component)).toContain("all time");
		component.handleInput("c");
		expect(text(component)).toContain("less ·░▒▓█ more");
		component.handleInput("\x1b[D");
		expect(text(component)).toContain("2025-12-21");
		component.handleInput("\x1b[C");
		expect(text(component)).toContain("2026-01-15");
		component.handleInput("d");
		expect(text(component)).toContain("model-00");
	});

	it("scrolls rows, clamps the end, bounds narrow layouts, and honors remapped shortcuts", async () => {
		const keys = new KeybindingsManager({
			"app.usage.close": "ctrl+q",
			"app.usage.calendar": "x",
		});
		const { component, done, controller } = setup("total", keys);
		await vi.waitFor(() => expect(text(component)).toContain("model-00"));
		component.handleInput("j");
		expect(text(component)).not.toContain("model-00");
		component.handleInput("k");
		expect(text(component)).toContain("model-00");
		for (let i = 0; i < 40; i++) component.handleInput("j");
		expect(text(component)).toContain("model-29");
		expect(text(component)).toContain("25-30 of 30");
		for (const width of [1, 2, 10, 40, 150])
			expect(component.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
		component.handleInput("x");
		expect(text(component)).toContain("less ·░▒▓█ more");
		expect(text(component)).toContain("ctrl+q quit");
		component.handleInput("q");
		expect(done).not.toHaveBeenCalled();
		component.handleInput("\x11");
		expect(done).toHaveBeenCalledExactlyOnceWith(null);
		expect(controller.signal.aborted).toBe(true);
		component.handleInput("\x11");
		expect(done).toHaveBeenCalledOnce();
	});

	it("does not overlap rescans and suppresses late progress/results after close", async () => {
		const { component, scan, controller, requestRender, done } = setup();
		await vi.waitFor(() => expect(text(component)).toContain("model-00"));
		const deferred = Promise.withResolvers<Rec[]>();
		scan.mockImplementation((_dir, progress) => {
			progress?.(16, 32);
			return deferred.promise;
		});
		component.handleInput("r");
		expect(text(component)).toContain("Scanning sessions… 16/32");
		component.handleInput("r");
		expect(scan).toHaveBeenCalledTimes(2);
		component.handleInput("\x1b");
		expect(controller.signal.aborted).toBe(true);
		expect(done).toHaveBeenCalledOnce();
		const rendered = requestRender.mock.calls.length;
		scan.mock.calls.at(-1)?.[1]?.(32, 32);
		deferred.resolve(fixtures());
		await deferred.promise;
		await Promise.resolve();
		await Promise.resolve();
		expect(requestRender).toHaveBeenCalledTimes(rendered);
	});

	it("reports scan failure and allows a subsequent successful retry", async () => {
		const { component, scan } = setup();
		await vi.waitFor(() => expect(text(component)).toContain("model-00"));
		scan.mockRejectedValueOnce(new Error("synthetic failure"));
		component.handleInput("r");
		await vi.waitFor(() => expect(text(component)).toContain("Could not scan session history"));
		component.handleInput("r");
		await vi.waitFor(() => expect(text(component)).toContain("model-00"));
		expect(text(component)).not.toContain("Could not scan");
	});
});
