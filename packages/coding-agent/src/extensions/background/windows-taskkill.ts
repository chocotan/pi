// Adapted from pi-background-tasks (ISC), Copyright (c) 2026. See docs/third-party/pi-background-tasks/LICENSE.
import { win32 } from "node:path";
import { spawnProcess, waitForChildProcess } from "../../utils/child-process.ts";

export interface TaskkillOutcome {
	exitCode: number | null;
	stderr: string;
}
export interface WindowsTaskkillOptions {
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	spawn?: typeof spawnProcess;
}

/** Use the trusted system executable rather than a command resolved from the task's PATH. */
export function resolveTaskkillPath(env: NodeJS.ProcessEnv): string {
	const lookup = (name: string) => env[Object.keys(env).find((key) => key.toLowerCase() === name) ?? ""];
	const root = lookup("systemroot") ?? lookup("windir");
	if (!root?.trim() || root.includes("\0") || !win32.isAbsolute(root))
		throw new Error("Cannot resolve taskkill.exe: SystemRoot/WINDIR must be an absolute Windows path");
	return win32.join(root, "System32", "taskkill.exe");
}

export async function runWindowsTaskkill(
	pid: number,
	phase: "terminate" | "force",
	options: WindowsTaskkillOptions = {},
): Promise<TaskkillOutcome> {
	if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid Windows taskkill PID");
	const env = options.env ?? process.env;
	const args = ["/PID", String(pid), "/T"];
	if (phase === "force") args.push("/F");
	const child = (options.spawn ?? spawnProcess)(resolveTaskkillPath(env), args, {
		env,
		shell: false,
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stderr = Buffer.alloc(0);
	child.stderr?.on("data", (data: Buffer) => {
		const remaining = 8192 - stderr.length;
		if (remaining > 0) stderr = Buffer.concat([stderr, data.subarray(0, remaining)]);
	});
	child.stdout?.resume();
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch (error) {
				reject(new Error(`Windows taskkill helper timed out; helper kill failed: ${String(error)}`));
				return;
			}
			reject(new Error("Windows taskkill helper timed out"));
		}, options.timeoutMs ?? 5000);
	});
	try {
		return { exitCode: await Promise.race([waitForChildProcess(child), timeout]), stderr: stderr.toString("utf8") };
	} finally {
		if (timer) clearTimeout(timer);
	}
}
