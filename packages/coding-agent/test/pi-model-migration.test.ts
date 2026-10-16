import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPiModelConfig, importPiModelConfig, maybeImportPiModelConfig } from "../src/cli/pi-model-migration.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

let root: string;
let pie: string;
let pi: string;
const content = '\uFEFF{"providers":{"local":{"apiKey":"fixture-secret","models":[{"id":"local"}]}}}';
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pie-model-import-"));
	pie = join(root, ".pie");
	pi = join(root, ".pi", "agent");
	mkdirSync(pi, { recursive: true });
	writeFileSync(join(pi, "models.json"), content);
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});
describe("confirmed Pi model import", () => {
	it("asks before copying and preserves the source and exact file contents", async () => {
		const confirm = vi.fn(async () => {
			expect(existsSync(join(pie, "models.json"))).toBe(false);
			return true;
		});
		const output = vi.spyOn(console, "log").mockImplementation(() => {});
		expect(
			await maybeImportPiModelConfig(SettingsManager.inMemory(), { agentDir: pie, sourceDirs: [pi], confirm }),
		).toBe(true);
		expect(confirm).toHaveBeenCalledWith(join(pi, "models.json"), join(pie, "models.json"));
		expect(readFileSync(join(pie, "models.json"), "utf8")).toBe(content);
		expect(readFileSync(join(pi, "models.json"), "utf8")).toBe(content);
		if (process.platform !== "win32") expect(statSync(join(pie, "models.json")).mode & 0o777).toBe(0o600);
		expect(output.mock.calls.flat().join(" ")).not.toContain("fixture-secret");
	});
	it("does not copy when declined or cancelled", async () => {
		expect(
			await maybeImportPiModelConfig(SettingsManager.inMemory(), {
				agentDir: pie,
				sourceDirs: [pi],
				confirm: async () => false,
			}),
		).toBe(false);
		expect(existsSync(pie)).toBe(false);
	});
	it("does not ask when Pie already has models or Pi has no source file", async () => {
		const confirm = vi.fn(async () => true);
		mkdirSync(pie);
		writeFileSync(join(pie, "models.json"), "{}");
		expect(
			await maybeImportPiModelConfig(SettingsManager.inMemory(), { agentDir: pie, sourceDirs: [pi], confirm }),
		).toBe(false);
		rmSync(join(pie, "models.json"));
		expect(
			await maybeImportPiModelConfig(SettingsManager.inMemory(), {
				agentDir: pie,
				sourceDirs: [join(root, "missing")],
				confirm,
			}),
		).toBe(false);
		expect(confirm).not.toHaveBeenCalled();
	});
	it("does not overwrite a file created while the prompt was open", async () => {
		expect(
			await maybeImportPiModelConfig(SettingsManager.inMemory(), {
				agentDir: pie,
				sourceDirs: [pi],
				confirm: async () => {
					mkdirSync(pie);
					writeFileSync(join(pie, "models.json"), '{"providers":{}}');
					return true;
				},
			}),
		).toBe(false);
		expect(readFileSync(join(pie, "models.json"), "utf8")).toBe('{"providers":{}}');
	});
	it("supports both Pi directory layouts through ordered source discovery", () => {
		expect(findPiModelConfig(pie, [join(root, ".pi"), pi])).toBe(join(pi, "models.json"));
		writeFileSync(join(root, ".pi", "models.json"), "{}");
		expect(findPiModelConfig(pie, [join(root, ".pi"), pi])).toBe(join(root, ".pi", "models.json"));
	});
	it("rejects invalid source data without leaking its contents or creating a target", () => {
		writeFileSync(join(pi, "models.json"), "fixture-secret invalid JSON");
		expect(() => importPiModelConfig(join(pi, "models.json"), pie)).toThrow("not valid JSON");
		try {
			importPiModelConfig(join(pi, "models.json"), pie);
		} catch (error) {
			expect(String(error)).not.toContain("fixture-secret");
		}
		expect(existsSync(join(pie, "models.json"))).toBe(false);
		writeFileSync(join(pi, "models.json"), "[]");
		expect(() => importPiModelConfig(join(pi, "models.json"), pie)).toThrow("must contain an object");
	});
});
