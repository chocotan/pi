import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { stopProcessTree } from "../src/extensions/background/process-tree.ts";
import { resolveTaskkillPath, runWindowsTaskkill } from "../src/extensions/background/windows-taskkill.ts";
import type { spawnProcess } from "../src/utils/child-process.ts";

// These IDs belong only to fakes. Every signal and helper spawn in this file is injected.
const child = { pid: 424242 } as ChildProcess;
const missing = () => Object.assign(new Error("No such process group"), { code: "ESRCH" });
describe("background process-tree cleanup", () => {
	it("keeps the force phase when TERM exits the leader but descendants remain", async () => {
		let exists = true;
		const signals: Array<NodeJS.Signals | number | undefined> = [];
		const kill = vi.fn((pid: number, signal?: NodeJS.Signals | number) => {
			expect(pid).toBe(-424242);
			signals.push(signal);
			if (!exists) throw missing();
			if (signal === "SIGKILL") exists = false;
			return true;
		});
		await stopProcessTree(child, { kill, platform: "linux", graceMs: 1 });
		expect(signals.filter((signal) => signal === "SIGTERM")).toHaveLength(1);
		expect(signals.filter((signal) => signal === "SIGKILL")).toHaveLength(1);
	});
	it("does not signal a disappeared group and reports unverified or denied cleanup", async () => {
		const gone = vi.fn(() => {
			throw missing();
		});
		await stopProcessTree(child, { kill: gone, platform: "linux" });
		expect(gone).toHaveBeenCalledExactlyOnceWith(-424242, 0);
		await expect(
			stopProcessTree(child, { kill: vi.fn(() => true), platform: "linux", graceMs: 1, verifyMs: 1 }),
		).rejects.toThrow("descendants may have leaked");
		await expect(
			stopProcessTree(child, {
				platform: "linux",
				kill: () => {
					throw Object.assign(new Error("denied"), { code: "EPERM" });
				},
			}),
		).rejects.toThrow("denied");
	});
	it("uses Windows tree termination, escalates failure, and preserves force errors", async () => {
		const taskkill = vi
			.fn<typeof runWindowsTaskkill>()
			.mockResolvedValueOnce({ exitCode: 1, stderr: "soft refused" })
			.mockResolvedValueOnce({ exitCode: 0, stderr: "" });
		await stopProcessTree(child, {
			platform: "win32",
			taskkill,
			graceMs: 5,
			env: { SystemRoot: "C:\\Windows" },
		});
		expect(taskkill.mock.calls.map((call) => call[1])).toEqual(["terminate", "force"]);
		const failed = stopProcessTree(child, {
			platform: "win32",
			graceMs: 1,
			taskkill: vi.fn().mockResolvedValue({ exitCode: 5, stderr: "denied" }),
		});
		await expect(failed).rejects.toThrow("denied");
	});
	it("forces a POSIX group only once if the graceful signal fails", async () => {
		let gone = false;
		const kill = vi.fn<typeof process.kill>((_pid, signal) => {
			if (gone) throw missing();
			if (signal === "SIGTERM") throw new Error("TERM failed");
			if (signal === "SIGKILL") gone = true;
			return true;
		});
		await stopProcessTree(child, { platform: "linux", kill, graceMs: 1 });
		expect(kill.mock.calls.filter((call) => call[1] === "SIGKILL")).toHaveLength(1);
	});
	it("escalates a rejected Windows soft helper", async () => {
		const taskkill = vi
			.fn<typeof runWindowsTaskkill>()
			.mockRejectedValueOnce(new Error("soft helper timeout"))
			.mockResolvedValueOnce({ exitCode: 0, stderr: "" });
		await stopProcessTree(child, { platform: "win32", taskkill, graceMs: 1 });
		expect(taskkill.mock.calls.map((call) => call[1])).toEqual(["terminate", "force"]);
	});
	it("bounds Windows helper diagnostics and constructs trusted tree-kill arguments", async () => {
		const fake = Object.assign(new EventEmitter(), {
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			kill: vi.fn(() => true),
		});
		const spawn = vi.fn(() => fake as unknown as ChildProcess) as unknown as typeof spawnProcess;
		const pending = runWindowsTaskkill(424242, "force", { spawn, env: { SystemRoot: "C:\\Windows" } });
		fake.stderr.write("x".repeat(12000));
		fake.stdout.end();
		fake.stderr.end();
		fake.emit("close", 0, null);
		const outcome = await pending;
		expect(outcome.stderr).toHaveLength(8192);
		expect(spawn).toHaveBeenCalledWith(
			"C:\\Windows\\System32\\taskkill.exe",
			["/PID", "424242", "/T", "/F"],
			expect.objectContaining({ shell: false, windowsHide: true }),
		);
	});
	it("reports a timed-out Windows helper even if killing that helper throws", async () => {
		const fake = Object.assign(new EventEmitter(), {
			stdout: new PassThrough(),
			stderr: new PassThrough(),
			kill: vi.fn(() => {
				throw new Error("fixture helper kill failed");
			}),
		});
		const spawn = vi.fn(() => fake as unknown as ChildProcess) as unknown as typeof spawnProcess;
		await expect(
			runWindowsTaskkill(424242, "force", { spawn, env: { SystemRoot: "C:\\Windows" }, timeoutMs: 1 }),
		).rejects.toThrow("helper kill failed");
		expect(fake.kill).toHaveBeenCalledWith("SIGKILL");
	});
	it("validates trusted Windows helper paths rather than using task PATH", () => {
		expect(resolveTaskkillPath({ systemroot: "D:\\Win", PATH: "untrusted" })).toBe("D:\\Win\\System32\\taskkill.exe");
		expect(resolveTaskkillPath({ WINDIR: "C:\\Windows" })).toBe("C:\\Windows\\System32\\taskkill.exe");
		for (const root of [undefined, "", "relative", "C:\\Win\0bad"])
			expect(() => resolveTaskkillPath({ SystemRoot: root })).toThrow("absolute Windows path");
	});
});
