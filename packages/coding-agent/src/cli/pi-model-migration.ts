import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expandTildePath, getAgentDir } from "../config.ts";
import type { SettingsManager } from "../core/settings-manager.ts";
import { stripBom } from "../utils/text.ts";
import { showStartupSelector } from "./startup-ui.ts";

export function findPiModelConfig(
	agentDir = getAgentDir(),
	sourceDirs = [
		...(process.env.PI_CODING_AGENT_DIR ? [expandTildePath(process.env.PI_CODING_AGENT_DIR)] : []),
		join(homedir(), ".pi", "agent"),
		join(homedir(), ".pi"),
	],
): string | undefined {
	const target = join(agentDir, "models.json");
	if (existsSync(target)) return undefined;
	return sourceDirs
		.map((directory) => join(directory, "models.json"))
		.find((path) => resolve(path) !== resolve(target) && existsSync(path));
}

/** Copy the confirmed snapshot with restrictive permissions; exclusive creation also protects against races. */
export function importPiModelConfig(source: string, agentDir = getAgentDir()): boolean {
	const target = join(agentDir, "models.json");
	if (existsSync(target)) return false;
	const content = readFileSync(source, "utf8");
	let data: unknown;
	try {
		data = JSON.parse(stripBom(content));
	} catch {
		throw new Error("Pi models.json is not valid JSON; nothing was imported.");
	}
	if (!data || typeof data !== "object" || Array.isArray(data))
		throw new Error("Pi models.json must contain an object; nothing was imported.");
	mkdirSync(dirname(target), { recursive: true });
	try {
		writeFileSync(target, content, { flag: "wx", mode: 0o600 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
	return true;
}

export async function maybeImportPiModelConfig(
	settings: SettingsManager,
	options: {
		agentDir?: string;
		sourceDirs?: string[];
		confirm?: (source: string, target: string) => Promise<boolean>;
	} = {},
): Promise<boolean> {
	const agentDir = options.agentDir ?? getAgentDir();
	const source = findPiModelConfig(agentDir, options.sourceDirs);
	if (!source) return false;
	const target = join(agentDir, "models.json");
	const confirm =
		options.confirm ??
		(async (from: string, to: string) =>
			(await showStartupSelector(
				settings,
				`Import model configuration from Pi?\nFrom: ${from}\nTo: ${to}\nOnly models.json is copied. Existing Pie files are never overwritten.`,
				[
					{ label: "Import Pi model configuration", value: true },
					{ label: "Skip and continue", value: false },
				],
			)) === true);
	if (!(await confirm(source, target))) return false;
	const copied = importPiModelConfig(source, agentDir);
	if (copied) console.log("Imported Pi model configuration into Pie.");
	return copied;
}
