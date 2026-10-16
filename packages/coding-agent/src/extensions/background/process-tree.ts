// Adapted from pi-background-tasks (ISC), Copyright (c) 2026. See docs/third-party/pi-background-tasks/LICENSE.
import type { ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { runWindowsTaskkill } from "./windows-taskkill.ts";

export interface ProcessTreeOptions {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	kill?: (pid: number, signal?: NodeJS.Signals | number) => boolean;
	graceMs?: number;
	verifyMs?: number;
	taskkill?: typeof runWindowsTaskkill;
}

/** Authority comes only from this live spawn; never accept a PID read from task metadata. */
export async function stopProcessTree(child: ChildProcess, options: ProcessTreeOptions = {}): Promise<void> {
	const pid = child.pid;
	if (!pid) return;
	if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid background child PID");
	const graceMs = options.graceMs ?? 3000;
	if ((options.platform ?? process.platform) === "win32") {
		const taskkill = options.taskkill ?? runWindowsTaskkill;
		const soft = await taskkill(pid, "terminate", { env: options.env }).catch((error: unknown) => ({
			exitCode: null,
			stderr: String(error),
		}));
		if (soft.exitCode === 0 || soft.exitCode === 128) return;
		await delay(graceMs);
		const forced = await taskkill(pid, "force", { env: options.env });
		if (forced.exitCode !== 0 && forced.exitCode !== 128)
			throw new Error(`Windows process tree ${pid} termination failed: ${forced.stderr || forced.exitCode}`);
		return;
	}
	const kill = options.kill ?? process.kill.bind(process);
	const signal = (value: NodeJS.Signals | 0): boolean => {
		try {
			if (!kill(-pid, value)) throw new Error(`Process group ${pid} signal ${value} returned false`);
			return true;
		} catch (error) {
			if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return false;
			throw error;
		}
	};
	if (!signal(0)) return;
	let forced = false;
	try {
		if (!signal("SIGTERM")) return;
	} catch {
		// A failed TERM still requires the force phase, and force errors must remain visible.
		if (!signal("SIGKILL")) return;
		forced = true;
	}
	if (!forced) {
		const graceDeadline = Date.now() + graceMs;
		while (Date.now() < graceDeadline) {
			if (!signal(0)) return;
			await delay(Math.min(20, Math.max(1, graceDeadline - Date.now())));
		}
		if (!signal("SIGKILL")) return;
	}
	const deadline = Date.now() + (options.verifyMs ?? 1500);
	while (Date.now() < deadline) {
		if (!signal(0)) return;
		await delay(10);
	}
	throw new Error(`Process group ${pid} remained present after SIGKILL; descendants may have leaked`);
}
