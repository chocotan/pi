import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createSubagentsExtension, SUBAGENT_ENTRY, type SubagentRecord } from "../../src/extensions/subagents/index.ts";
import { ToolExecutionComponent } from "../../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness } from "./harness.ts";

const ui = { requestRender: vi.fn() } as unknown as TUI;
describe("subagent call titles", () => {
	beforeAll(() => initTheme("dark"));
	it("shows the description in Agent and result headers while retaining all parameters on expansion", async () => {
		const harness = await createHarness({ extensionFactories: [createSubagentsExtension()] });
		try {
			await harness.session.bindExtensions({});
			harness.setResponses([fauxAssistantMessage("Child finished")]);
			const args = {
				prompt: "Private complete instructions",
				description: "Check current directory",
				subagent_type: "worker",
				max_turns: 3,
				inherit_context: false,
				run_in_background: false,
			};
			const agent = harness.session.getToolDefinition("Agent")!;
			const output = await agent.execute(
				"run",
				args,
				undefined,
				undefined,
				harness.session.extensionRunner.createToolContext("run", undefined),
			);
			const record = output.details as SubagentRecord;
			for (const [name, input] of [
				["Agent", args],
				["get_subagent_result", { agent_id: record.id, wait: true }],
			] as const) {
				const component = new ToolExecutionComponent(
					name,
					name,
					input,
					{},
					harness.session.getToolDefinition(name),
					ui,
					"/tmp",
				);
				component.updateResult({ ...output, isError: false });
				const collapsed = stripAnsi(component.render(120).join("\n"));
				expect(collapsed).toContain(`${name} Check current directory`);
				expect(collapsed).not.toContain("Private complete instructions");
				expect(collapsed).not.toContain("inherit_context");
				expect(collapsed).not.toContain("agent_id");
				component.setExpanded(true);
				const expanded = stripAnsi(component.render(120).join("\n"));
				if (name === "Agent") expect(expanded).toContain(args.prompt);
				else expect(expanded).toContain(record.id);
				component.dispose();
			}
		} finally {
			harness.cleanup();
		}
	});
	it("resolves result descriptions from saved records", async () => {
		const manager = SessionManager.inMemory("/tmp");
		manager.appendCustomEntry(SUBAGENT_ENTRY, {
			id: "saved-child",
			agent: "worker",
			description: "Saved disk analysis",
			prompt: "Original prompt",
			status: "completed",
			model: "faux/local",
			thinking: "off",
			startedAt: 1,
			finishedAt: 2,
			output: "Done",
		} satisfies SubagentRecord);
		const harness = await createHarness({
			sessionManager: manager,
			extensionFactories: [createSubagentsExtension()],
		});
		try {
			await harness.session.bindExtensions({});
			const component = new ToolExecutionComponent(
				"get_subagent_result",
				"saved",
				{ agent_id: "saved-child", wait: true },
				{},
				harness.session.getToolDefinition("get_subagent_result"),
				ui,
				"/tmp",
			);
			component.updateResult({ content: [], isError: false });
			const text = stripAnsi(component.render(120).join("\n"));
			expect(text).toContain("Saved disk analysis");
			expect(text).not.toContain("agent_id=");
			component.dispose();
		} finally {
			harness.cleanup();
		}
	});
});
