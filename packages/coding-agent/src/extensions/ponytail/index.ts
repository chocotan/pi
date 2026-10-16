// Adapted from @dietrichgebert/ponytail 5.1.0 (MIT, Copyright 2026 DietrichGebert).
import { join } from "node:path";
import { getPackageDir } from "../../config.ts";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import type { SessionEntry } from "../../core/session-manager.ts";
import {
	DEFAULT_MODE,
	getDefaultMode,
	getHideStatus,
	getQuietStartup,
	isDeactivationCommand,
	normalizeMode,
	normalizePersistedMode,
	type PonytailMode,
	RUNTIME_MODES,
	type RuntimeMode,
	writeDefaultMode,
} from "./config.ts";
import { getPonytailInstructions } from "./instructions.ts";

export function resolveSessionMode(
	entries: readonly SessionEntry[],
	fallbackMode: PonytailMode = DEFAULT_MODE,
): PonytailMode {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== "ponytail-mode") continue;
		const data: unknown = entry.data;
		const mode = normalizePersistedMode(data && typeof data === "object" && "mode" in data ? data.mode : undefined);
		if (mode) return mode;
	}
	return fallbackMode;
}

type PonytailCommand =
	| { type: "status" }
	| { type: "set-mode"; mode: RuntimeMode }
	| { type: "set-default"; mode: RuntimeMode }
	| { type: "invalid" };

export function parsePonytailCommand(
	text: string,
	defaultMode: RuntimeMode = DEFAULT_MODE,
	currentMode?: PonytailMode,
): PonytailCommand {
	const normalized = text.trim().toLowerCase();
	if (!normalized) {
		if (currentMode && currentMode !== "off") return { type: "status" };
		return { type: "set-mode", mode: defaultMode === "off" ? "full" : defaultMode };
	}
	const [primary, secondary] = normalized.split(/\s+/);
	if (primary === "status") return { type: "status" };
	const mode = normalizeMode(primary === "default" ? secondary : primary);
	return mode ? { type: primary === "default" ? "set-default" : "set-mode", mode } : { type: "invalid" };
}

export default function ponytailExtension(pi: ExtensionAPI): void {
	let configuredDefaultMode = getDefaultMode();
	let currentMode: PonytailMode = configuredDefaultMode;
	let hideStatus = getHideStatus();
	let isActive = false;

	function syncStatus(ctx: ExtensionContext): void {
		if (hideStatus || currentMode === "off") {
			ctx.ui.setStatus("ponytail", undefined);
			return;
		}
		// Web hosts can expose a theme proxy before their theme is initialized.
		try {
			const theme = ctx.ui.theme;
			if (!theme?.fg) return;
			const indicator = isActive ? theme.fg("accent", "●") : theme.fg("dim", "○");
			ctx.ui.setStatus(
				"ponytail",
				`${indicator} ${theme.fg("muted", "ponytail: ")}${theme.fg("text", currentMode.toUpperCase())}`,
			);
		} catch {
			return;
		}
	}

	function setMode(mode: PonytailMode, ctx: ExtensionContext): void {
		currentMode = mode;
		pi.appendEntry("ponytail-mode", { mode });
		syncStatus(ctx);
		ctx.ui.notify(`Ponytail mode set to ${mode}.`, "info");
	}

	pi.on("resources_discover", () => ({ skillPaths: [join(getPackageDir(), "skills")] }));

	pi.registerCommand("ponytail", {
		description: `Set mode: ${RUNTIME_MODES.join("|")}. Commands: status, default <mode>`,
		async handler(args, ctx) {
			const parsed = parsePonytailCommand(args, configuredDefaultMode, currentMode);
			switch (parsed.type) {
				case "status":
					ctx.ui.notify(`Ponytail: current ${currentMode} \u2022 default ${configuredDefaultMode}`, "info");
					return;
				case "set-default":
					try {
						const written = writeDefaultMode(parsed.mode);
						configuredDefaultMode = getDefaultMode();
						ctx.ui.notify(
							configuredDefaultMode === written
								? `Default Ponytail mode set to ${written}.`
								: `Saved default ${written}, but env override keeps default at ${configuredDefaultMode}.`,
							"info",
						);
					} catch (error) {
						ctx.ui.notify(
							`Failed to save default mode: ${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
					}
					return;
				case "set-mode":
					setMode(parsed.mode, ctx);
					return;
				case "invalid":
					ctx.ui.notify("Unknown or unsupported /ponytail mode.", "warning");
			}
		},
	});

	for (const alias of ["review", "audit", "gain", "debt", "help"]) {
		const skillName = `/skill:ponytail-${alias}`;
		pi.registerCommand(`ponytail-${alias}`, {
			description: `Run ${skillName}`,
			async handler(args, ctx) {
				const message = args.trim() ? `${skillName} ${args.trim()}` : skillName;
				if (!ctx.isIdle()) {
					pi.sendUserMessage(message, { expandPromptTemplates: true, deliverAs: "followUp" });
					ctx.ui.notify(`${skillName} queued as follow-up.`, "info");
				} else {
					pi.sendUserMessage(message, { expandPromptTemplates: true });
				}
			},
		});
	}

	pi.on("input", (event, ctx) => {
		if (event.source !== "extension" && currentMode !== "off" && isDeactivationCommand(event.text))
			setMode("off", ctx);
	});

	function restoreSessionMode(ctx: ExtensionContext): void {
		currentMode = resolveSessionMode(ctx.sessionManager.getBranch(), configuredDefaultMode);
		syncStatus(ctx);
	}

	pi.on("session_start", (_event, ctx) => {
		configuredDefaultMode = getDefaultMode();
		hideStatus = getHideStatus();
		isActive = false;
		restoreSessionMode(ctx);
		if (!getQuietStartup()) ctx.ui.notify(`Ponytail loaded: ${currentMode}`, "info");
	});
	pi.on("session_tree", (_event, ctx) => restoreSessionMode(ctx));
	pi.on("agent_start", (_event, ctx) => {
		isActive = true;
		syncStatus(ctx);
	});
	pi.on("agent_end", (_event, ctx) => {
		isActive = false;
		syncStatus(ctx);
	});
	pi.on("before_agent_start", (event) => {
		if (currentMode === "off") delete event.systemPromptOptions.sections.ponytail;
		else event.systemPromptOptions.sections.ponytail = getPonytailInstructions(currentMode);
	});
	pi.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus("ponytail", undefined));
}
