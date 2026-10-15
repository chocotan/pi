import { join } from "node:path";
import { Check } from "typebox/value";
import { describe, expect, it, vi } from "vitest";
import { type BashOperations, createBashTool, createBashToolDefinition } from "../src/core/tools/bash.ts";
import { createEditTool, createEditToolDefinition } from "../src/core/tools/edit.ts";
import { createFindToolDefinition } from "../src/core/tools/find.ts";
import { createGrepToolDefinition } from "../src/core/tools/grep.ts";
import { createLsToolDefinition } from "../src/core/tools/ls.ts";
import { createPowerShellTool, createPowerShellToolDefinition } from "../src/core/tools/powershell.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { createWriteTool } from "../src/core/tools/write.ts";

const cwd = process.cwd();
const description = "Inspect the current changes";

const schemaCases = [
	{ tool: createBashToolDefinition(cwd), args: { command: "git diff" } },
	{ tool: createPowerShellToolDefinition(cwd), args: { command: "Get-Content file.txt" } },
	{ tool: createReadToolDefinition(cwd), args: { path: "file.txt" } },
	{
		tool: createEditToolDefinition(cwd),
		args: { path: "file.txt", edits: [{ oldText: "before", newText: "after" }] },
	},
	{ tool: createWriteTool(cwd), args: { path: "file.txt", content: "after" } },
	{ tool: createGrepToolDefinition(cwd), args: { pattern: "before" } },
	{ tool: createFindToolDefinition(cwd), args: { pattern: "*.ts" } },
	{ tool: createLsToolDefinition(cwd), args: {} },
];

describe("built-in tool invocation descriptions", () => {
	it.each(schemaCases)("accepts an optional string description for $tool.name", ({ tool, args }) => {
		expect(tool.parameters.properties.description).toMatchObject({ type: "string" });
		expect(Check(tool.parameters, args)).toBe(true);
		expect(Check(tool.parameters, { ...args, description })).toBe(true);
		expect(Check(tool.parameters, { ...args, description: 123 })).toBe(false);
	});

	it("shares the bash parameter schema with PowerShell", () => {
		expect(createPowerShellToolDefinition(cwd).parameters).toBe(createBashToolDefinition(cwd).parameters);
	});

	it.each([
		{ name: "bash", create: createBashTool },
		{ name: "powershell", create: createPowerShellTool },
	])("passes the exact command to $name operations with and without a description", async ({ create }) => {
		const exec = vi.fn<BashOperations["exec"]>(async () => ({ exitCode: 0 }));
		const tool = create(cwd, { operations: { exec } });
		const command = "printf '%s\\n' \"$HOME\"\n# Preserve quotes, spaces, and newlines";

		await tool.execute("described", { command, timeout: 7, description });
		await tool.execute("undescribed", { command, timeout: 7 });

		expect(exec).toHaveBeenCalledTimes(2);
		for (const call of exec.mock.calls) {
			expect(call).toEqual([command, cwd, expect.objectContaining({ timeout: 7 })]);
			expect(call[2]).not.toHaveProperty("description");
		}
	});

	it.each([
		{ edits: [{ oldText: "before", newText: "after" }] },
		{ edits: JSON.stringify([{ oldText: "before", newText: "after" }]) },
		{ edits: { oldText: "before", newText: "after" } },
		{ oldText: "before", newText: "after" },
	])("preserves description through edit argument preparation: %j", async (replacement) => {
		const writeFile = vi.fn(async (_path: string, _content: string) => {});
		const tool = createEditTool(cwd, {
			operations: {
				access: async () => {},
				readFile: async () => Buffer.from("\uFEFFbefore\r\n"),
				writeFile,
			},
		});
		const prepared = tool.prepareArguments!({ path: "file.txt", description, ...replacement });
		expect(prepared).toEqual({
			path: "file.txt",
			description,
			edits: [{ oldText: "before", newText: "after" }],
		});
		expect(Check(tool.parameters, prepared)).toBe(true);

		await tool.execute("edit", prepared);

		expect(writeFile).toHaveBeenCalledExactlyOnceWith(join(cwd, "file.txt"), "\uFEFFafter\r\n");
	});

	it("keeps description out of written paths and content", async () => {
		const mkdir = vi.fn(async (_path: string) => {});
		const writeFile = vi.fn(async (_path: string, _content: string) => {});
		const tool = createWriteTool(cwd, { operations: { mkdir, writeFile } });

		await tool.execute("write", { path: "file.txt", content: "exact content\r\n", description });

		expect(mkdir).toHaveBeenCalledExactlyOnceWith(cwd);
		expect(writeFile).toHaveBeenCalledExactlyOnceWith(join(cwd, "file.txt"), "exact content\r\n");
	});
});
