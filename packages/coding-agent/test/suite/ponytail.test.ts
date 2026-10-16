import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fauxAssistantMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV_AGENT_DIR, getPackageDir } from "../../src/config.ts";
import type { ExtensionFactory } from "../../src/core/extensions/types.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { loadSkillsFromDir } from "../../src/core/skills.ts";
import {
	getConfigPath,
	getDefaultMode,
	getHideStatus,
	getQuietStartup,
	isDeactivationCommand,
	writeDefaultMode,
} from "../../src/extensions/ponytail/config.ts";
import ponytailExtension, { parsePonytailCommand, resolveSessionMode } from "../../src/extensions/ponytail/index.ts";
import { filterSkillBodyForMode, getPonytailInstructions } from "../../src/extensions/ponytail/instructions.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, createTestUiContext, getUserTexts, type Harness } from "./harness.ts";

describe("bundled Ponytail", () => {
	let agentDir: string;
	const harnesses: Harness[] = [];

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "pie-ponytail-"));
		vi.stubEnv(ENV_AGENT_DIR, agentDir);
		vi.stubEnv("PONYTAIL_DEFAULT_MODE", undefined);
		vi.stubEnv("PONYTAIL_HIDE_STATUS", undefined);
		vi.stubEnv("PONYTAIL_QUIET_STARTUP", undefined);
		initTheme("dark");
	});

	afterEach(() => {
		for (const harness of harnesses.splice(0)) harness.cleanup();
		vi.unstubAllEnvs();
		rmSync(agentDir, { recursive: true, force: true });
	});

	async function setup(sessionManager?: SessionManager, before?: ExtensionFactory) {
		const extensionsResult = await createTestExtensionsResult([...(before ? [before] : []), ponytailExtension]);
		const resourceLoader = createTestResourceLoader({ extensionsResult });
		resourceLoader.getSkills = () => loadSkillsFromDir({ dir: join(getPackageDir(), "skills"), source: "builtin" });
		const harness = await createHarness({ resourceLoader, sessionManager });
		harnesses.push(harness);
		const notify = vi.fn();
		const setStatus = vi.fn();
		await harness.session.bindExtensions({ mode: "tui", uiContext: createTestUiContext({ notify, setStatus }) });
		return { harness, notify, setStatus };
	}

	it("keeps config under the application directory, preserves fields, and honors environment overrides", () => {
		expect(getConfigPath()).toBe(join(agentDir, "ponytail", "config.json"));
		expect(getDefaultMode()).toBe("full");
		mkdirSync(dirname(getConfigPath()), { recursive: true });
		writeFileSync(getConfigPath(), '\uFEFF{"defaultMode":" LITE ","quietStartup":true,"hideStatus":true,"other":42}');
		expect(getDefaultMode()).toBe("lite");
		expect(getQuietStartup()).toBe(true);
		expect(getHideStatus()).toBe(true);
		expect(writeDefaultMode("review")).toBeUndefined();
		expect(writeDefaultMode(" ULTRA ")).toBe("ultra");
		expect(JSON.parse(readFileSync(getConfigPath(), "utf8"))).toEqual({
			defaultMode: "ultra",
			quietStartup: true,
			hideStatus: true,
			other: 42,
		});
		vi.stubEnv("PONYTAIL_DEFAULT_MODE", " off ");
		vi.stubEnv("PONYTAIL_QUIET_STARTUP", "no");
		vi.stubEnv("PONYTAIL_HIDE_STATUS", "FALSE");
		expect(getDefaultMode()).toBe("off");
		expect(getQuietStartup()).toBe(false);
		expect(getHideStatus()).toBe(false);
		vi.stubEnv("PONYTAIL_DEFAULT_MODE", "review");
		expect(getDefaultMode()).toBe("ultra");
		writeFileSync(getConfigPath(), "null");
		expect(getDefaultMode()).toBe("full");
		writeFileSync(getConfigPath(), "invalid JSON");
		expect(writeDefaultMode("lite")).toBe("lite");
	});

	it("parses modes and limits natural-language deactivation to standalone commands", () => {
		expect(parsePonytailCommand("", "off", "off")).toEqual({ type: "set-mode", mode: "full" });
		expect(parsePonytailCommand("", "ultra", "off")).toEqual({ type: "set-mode", mode: "ultra" });
		expect(parsePonytailCommand("", "full", "lite")).toEqual({ type: "status" });
		expect(parsePonytailCommand(" DEFAULT ULTRA ")).toEqual({ type: "set-default", mode: "ultra" });
		expect(parsePonytailCommand("review")).toEqual({ type: "invalid" });
		expect(parsePonytailCommand("default review")).toEqual({ type: "invalid" });
		for (const text of ["STOP PONYTAIL!", " Normal mode. "]) expect(isDeactivationCommand(text)).toBe(true);
		for (const text of ["add a normal mode toggle", "please stop ponytail later", "stop ponytail-review"])
			expect(isDeactivationCommand(text)).toBe(false);
	});

	it("filters only mode rows/examples and retains ordinary rules and fallback instructions", () => {
		const body =
			'---\nname: test\n---\n| **lite** | L |\n| **full** | F |\n- lite: "example"\n- full: "example"\n- Full: ordinary prose\n- No unrequested abstractions: keep';
		const result = filterSkillBodyForMode(body, "full");
		expect(result).not.toContain("name: test");
		expect(result).not.toContain("**lite**");
		expect(result).not.toContain('- lite: "example"');
		expect(result).toContain("- Full: ordinary prose");
		expect(result).toContain("No unrequested abstractions");
		for (const mode of ["lite", "full", "ultra"] as const) {
			const instructions = getPonytailInstructions(mode);
			expect(instructions).toContain(`| **${mode}** |`);
			expect(instructions).toContain("Never cut: validation");
		}
		vi.stubEnv("PI_PACKAGE_DIR", agentDir);
		expect(getPonytailInstructions("ultra")).toContain("PONYTAIL MODE ACTIVE — level: ultra");
		expect(getPonytailInstructions("full")).toContain("Never cut: validation");
		expect(getPonytailInstructions("review")).toContain("Behavior defined by /ponytail-review skill");
	});

	it("injects structured rules, switches levels, and clears the section when off", async () => {
		const { harness, setStatus } = await setup(undefined, (pi) => {
			pi.on("before_agent_start", (event) => {
				event.systemPromptOptions.sections.ponytail = "STALE";
			});
		});
		const prompts: string[] = [];
		harness.setResponses(
			Array.from({ length: 4 }, () => (context) => {
				prompts.push(getCurrentSystemPrompt(context.messages));
				return fauxAssistantMessage("done");
			}),
		);
		await harness.session.prompt("work");
		await harness.session.prompt("/ponytail lite");
		await harness.session.prompt("add a normal mode toggle");
		await harness.session.prompt("Normal mode!");
		await harness.session.prompt("/ponytail");
		await harness.session.prompt("work again");
		expect(prompts[0]).toContain("PONYTAIL MODE ACTIVE — level: full");
		expect(prompts[1]).toContain("PONYTAIL MODE ACTIVE — level: lite");
		expect(prompts[1]).not.toContain("| **ultra** |");
		expect(prompts[2]).not.toContain("PONYTAIL MODE ACTIVE");
		expect(prompts[2]).not.toContain("STALE");
		expect(prompts[3]).toContain("PONYTAIL MODE ACTIVE — level: full");
		expect(setStatus.mock.calls.some((call) => String(call[1]).includes("\u25CF"))).toBe(true);
		expect(setStatus.mock.calls.some((call) => call[1] === undefined)).toBe(true);
	});

	it("restores the current branch on navigation and resume, ignoring malformed state", async () => {
		const manager = SessionManager.inMemory();
		const root = manager.appendCustomEntry("root", {});
		const { harness, notify } = await setup(manager);
		await harness.session.prompt("/ponytail lite");
		const lite = manager.getLeafId()!;
		await harness.session.prompt("/ponytail off");
		manager.branch(lite);
		await harness.session.extensionRunner.emit({ type: "session_tree", newLeafId: lite, oldLeafId: null });
		await harness.session.prompt("/ponytail status");
		expect(notify).toHaveBeenLastCalledWith("Ponytail: current lite \u2022 default full", "info");
		manager.appendCustomEntry("ponytail-mode", { mode: "invalid" });
		expect(resolveSessionMode(manager.getBranch())).toBe("lite");
		const resumed = await setup(manager);
		expect(resumed.notify).toHaveBeenCalledWith("Ponytail loaded: lite", "info");
		manager.branch(root);
		await harness.session.extensionRunner.emit({ type: "session_tree", newLeafId: root, oldLeafId: lite });
		await harness.session.prompt("/ponytail status");
		expect(notify).toHaveBeenLastCalledWith("Ponytail: current full \u2022 default full", "info");
	});

	it("changes the default independently and reports environment overrides and write errors", async () => {
		vi.stubEnv("PONYTAIL_DEFAULT_MODE", "lite");
		const { harness, notify } = await setup();
		await harness.session.prompt("/ponytail default ultra");
		expect(notify).toHaveBeenLastCalledWith("Saved default ultra, but env override keeps default at lite.", "info");
		expect(JSON.parse(readFileSync(getConfigPath(), "utf8")).defaultMode).toBe("ultra");
		await harness.session.prompt("/ponytail status");
		expect(notify).toHaveBeenLastCalledWith("Ponytail: current lite \u2022 default lite", "info");
		rmSync(dirname(getConfigPath()), { recursive: true });
		writeFileSync(dirname(getConfigPath()), "blocked");
		await harness.session.prompt("/ponytail default full");
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("Failed to save default mode:"), "error");
	});

	it("hides startup and status without disabling prompt rules", async () => {
		vi.stubEnv("PONYTAIL_QUIET_STARTUP", "1");
		vi.stubEnv("PONYTAIL_HIDE_STATUS", "1");
		const { harness, notify, setStatus } = await setup();
		expect(notify).not.toHaveBeenCalled();
		harness.setResponses([
			(context) => {
				expect(getCurrentSystemPrompt(context.messages)).toContain("PONYTAIL MODE ACTIVE");
				return fauxAssistantMessage("done");
			},
		]);
		await harness.session.prompt("work");
		expect(setStatus.mock.calls.every((call) => call[1] === undefined)).toBe(true);
	});

	it("expands every alias into the bundled skill and preserves arguments", async () => {
		const skills = loadSkillsFromDir({ dir: join(getPackageDir(), "skills"), source: "builtin" });
		expect(skills.diagnostics).toEqual([]);
		expect(skills.skills).toHaveLength(6);
		const { harness } = await setup();
		for (const alias of ["review", "audit", "debt", "gain", "help"]) {
			harness.setResponses([fauxAssistantMessage("done")]);
			await harness.session.prompt(`/ponytail-${alias} target`);
			await vi.waitFor(() => expect(getUserTexts(harness).at(-1)).toContain(`<skill name="ponytail-${alias}"`));
			await harness.session.waitForIdle();
			const text = getUserTexts(harness).at(-1)!;
			expect(text).toContain(`<skill name="ponytail-${alias}"`);
			expect(text).toContain("target");
			expect(text.length).toBeGreaterThan(600);
		}
	});

	it("queues an expanded alias as follow-up while busy", async () => {
		const { harness, notify } = await setup();
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		harness.setResponses([
			async () => {
				entered.resolve();
				await release.promise;
				return fauxAssistantMessage("first");
			},
			fauxAssistantMessage("reviewed"),
		]);
		const running = harness.session.prompt("work");
		try {
			await entered.promise;
			await harness.session.prompt("/ponytail-review staged");
			await vi.waitFor(() =>
				expect(harness.session.getFollowUpMessages()[0]).toContain('<skill name="ponytail-review"'),
			);
			expect(harness.session.getSteeringMessages()).toEqual([]);
			expect(notify).toHaveBeenCalledWith("/skill:ponytail-review queued as follow-up.", "info");
		} finally {
			release.resolve();
			await running;
		}
		expect(getUserTexts(harness).at(-1)).toContain("staged");
		expect(harness.getPendingResponseCount()).toBe(0);
	});
});
