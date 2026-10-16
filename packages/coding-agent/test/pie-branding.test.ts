import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	APP_NAME,
	APP_TITLE,
	CONFIG_DIR_NAME,
	detectInstallChange,
	ENV_AGENT_DIR,
	ENV_SESSION_DIR,
	getAgentDir,
	getChangelogPath,
	VERSION,
} from "../src/config.ts";
import { pieLogoLines } from "../src/modes/interactive/components/pie-logo.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

afterEach(() => vi.unstubAllEnvs());
describe("Pie product identity", () => {
	it("uses only Pie names and root configuration", () => {
		expect([APP_NAME, APP_TITLE, CONFIG_DIR_NAME, ENV_AGENT_DIR, ENV_SESSION_DIR, VERSION]).toEqual([
			"pie",
			"pie",
			".pie",
			"PIE_CODING_AGENT_DIR",
			"PIE_CODING_AGENT_SESSION_DIR",
			"0.1.1",
		]);
		vi.stubEnv(ENV_AGENT_DIR, "");
		vi.stubEnv("PI_EXT_CODING_AGENT_DIR", "/unused-old-config");
		expect(getAgentDir()).toBe(join(homedir(), ".pie"));
		vi.stubEnv(ENV_AGENT_DIR, "/pie-custom");
		expect(getAgentDir()).toBe("/pie-custom");
	});
	it("uses its own logo and changelog", () => {
		initTheme("dark");
		expect(pieLogoLines().map(stripAnsi)).toEqual(["█▀█ ▀█▀ █▀▀", "█▀▀ ▄█▄ ██▄"]);
		expect(pieLogoLines().map(stripAnsi).join("\n")).not.toContain("▀▀█");
		expect(getChangelogPath()).toMatch(/PIE_CHANGELOG\.md$/);
	});
	it("does not mistake the SDK package version for an app update", () => {
		const directory = mkdtempSync(join(tmpdir(), "pie-version-"));
		const manifest = join(directory, "package.json");
		try {
			writeFileSync(manifest, JSON.stringify({ version: "1.2.0", piConfig: { name: "pie", version: VERSION } }));
			expect(detectInstallChange(manifest)).toBeUndefined();
			writeFileSync(manifest, JSON.stringify({ version: "1.2.0", piConfig: { name: "pie", version: "0.2.0" } }));
			expect(detectInstallChange(manifest)).toEqual({ kind: "updated", version: "0.2.0" });
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
