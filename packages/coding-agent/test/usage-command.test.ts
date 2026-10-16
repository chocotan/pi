import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "../src/core/extensions/types.ts";
import usageExtension from "../src/extensions/usage/index.ts";
import { type Rec, SessionScanner } from "../src/extensions/usage/stats.ts";

const record: Rec = {
	p: "fixture-provider",
	m: "fixture-model",
	ts: new Date(2026, 0, 15).getTime(),
	i: 100,
	o: 20,
	cr: 20,
	cw: 10,
	rs: 5,
	t: 150,
	c: 0.25,
};
function setup() {
	let command: Parameters<ExtensionAPI["registerCommand"]>[1] | undefined;
	let shutdown: (() => void) | undefined;
	const registerCommand = vi.fn((name: string, options: Parameters<ExtensionAPI["registerCommand"]>[1]) => {
		expect(name).toBe("usage");
		command = options;
	});
	usageExtension({
		registerCommand,
		on: (name: string, handler: () => void) => {
			expect(name).toBe("session_shutdown");
			shutdown = handler;
			return () => {};
		},
	} as unknown as ExtensionAPI);
	if (!command || !shutdown) throw new Error("Missing usage registration");
	return { command, shutdown, registerCommand };
}

describe("usage command with a fake host", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		vi.useRealTimers();
	});

	it("registers without I/O and writes the original table/calendar to stderr outside TUI mode", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 0, 15, 12));
		vi.stubEnv(ENV_AGENT_DIR, "/synthetic-pie-agent");
		const scan = vi.spyOn(SessionScanner.prototype, "scan").mockResolvedValue([record]);
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		const { command, registerCommand } = setup();
		expect(registerCommand).toHaveBeenCalledOnce();
		expect(scan).not.toHaveBeenCalled();
		for (const mode of ["print", "json", "rpc"] as const) {
			await command.handler("total", { mode } as ExtensionCommandContext);
			expect(stderr.mock.calls.at(-1)?.[0]).toContain("pie-usage · total · all time");
			expect(stderr.mock.calls.at(-1)?.[0]).toContain("fixture-provider");
			expect(stderr.mock.calls.at(-1)?.[0]).toContain("TOTAL");
		}
		expect(scan).toHaveBeenCalledWith(join("/synthetic-pie-agent", "sessions"), undefined, expect.any(AbortSignal));
		await command.handler("cal", { mode: "print" } as ExtensionCommandContext);
		expect(stderr.mock.calls.at(-1)?.[0]).toContain("pie-usage · cal");
		expect(stderr.mock.calls.at(-1)?.[0]).toContain("window 150");
	});

	it("opens the source-sized custom overlay in TUI mode without a sidebar or provider calls", async () => {
		const custom = vi.fn().mockResolvedValue(null);
		const scan = vi.spyOn(SessionScanner.prototype, "scan").mockResolvedValue([]);
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		const { command } = setup();
		await command.handler("week", { mode: "tui", ui: { custom } } as unknown as ExtensionCommandContext);
		expect(custom).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
			overlay: true,
			overlayOptions: { width: "92%", maxHeight: "80%" },
		});
		expect(scan).not.toHaveBeenCalled();
		expect(stderr).not.toHaveBeenCalled();
	});

	it("cancels pending scans on shutdown without reporting cancellation as a command failure", async () => {
		const deferred = Promise.withResolvers<Rec[]>();
		const scan = vi.spyOn(SessionScanner.prototype, "scan").mockImplementation((_dir, _progress, signal) => {
			signal?.addEventListener("abort", () => deferred.reject(signal.reason), { once: true });
			return deferred.promise;
		});
		const { command, shutdown } = setup();
		const running = command.handler("total", { mode: "print" } as ExtensionCommandContext);
		expect(scan).toHaveBeenCalledOnce();
		shutdown();
		await expect(running).resolves.toBeUndefined();
		expect(scan.mock.calls[0][2]?.aborted).toBe(true);
	});
});
