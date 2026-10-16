// Adapted from @dietrichgebert/ponytail 5.1.0 (MIT, Copyright 2026 DietrichGebert).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "../../config.ts";

export const DEFAULT_MODE = "full";
export const RUNTIME_MODES = ["off", "lite", "full", "ultra"] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];
export type PonytailMode = RuntimeMode | "review";

export function normalizeMode(mode: unknown): RuntimeMode | undefined {
	if (typeof mode !== "string") return undefined;
	const normalized = mode.trim().toLowerCase();
	return RUNTIME_MODES.find((candidate) => candidate === normalized);
}

export function normalizePersistedMode(mode: unknown): PonytailMode | undefined {
	return (
		normalizeMode(mode) ?? (typeof mode === "string" && mode.trim().toLowerCase() === "review" ? "review" : undefined)
	);
}

export function isDeactivationCommand(text: string): boolean {
	const normalized = text
		.trim()
		.toLowerCase()
		.replace(/[.!?\s]+$/, "");
	return normalized === "stop ponytail" || normalized === "normal mode";
}

export function getConfigPath(): string {
	return join(getAgentDir(), "ponytail", "config.json");
}

function readConfig(): Record<string, unknown> {
	try {
		const config: unknown = JSON.parse(readFileSync(getConfigPath(), "utf8").replace(/^\uFEFF/, ""));
		return config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export function getDefaultMode(): RuntimeMode {
	return normalizeMode(process.env.PONYTAIL_DEFAULT_MODE) ?? normalizeMode(readConfig().defaultMode) ?? DEFAULT_MODE;
}

function getBooleanSetting(env: string | undefined, field: "quietStartup" | "hideStatus"): boolean {
	if (env !== undefined) return !["", "0", "false", "no"].includes(env.trim().toLowerCase());
	return readConfig()[field] === true;
}

export function getQuietStartup(): boolean {
	return getBooleanSetting(process.env.PONYTAIL_QUIET_STARTUP, "quietStartup");
}

export function getHideStatus(): boolean {
	return getBooleanSetting(process.env.PONYTAIL_HIDE_STATUS, "hideStatus");
}

export function writeDefaultMode(mode: unknown): RuntimeMode | undefined {
	const normalized = normalizeMode(mode);
	if (!normalized) return undefined;
	const configPath = getConfigPath();
	mkdirSync(dirname(configPath), { recursive: true });
	writeFileSync(configPath, JSON.stringify({ ...readConfig(), defaultMode: normalized }, null, 2), "utf8");
	return normalized;
}
