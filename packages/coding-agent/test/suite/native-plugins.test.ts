import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type FauxResponseFactory,
	fauxAssistantMessage,
	fauxToolCall,
	getSystemMessageText,
} from "@earendil-works/pi-ai";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { EventBus } from "../../src/core/event-bus.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createSubagentsExtension, type SubagentRecord } from "../../src/extensions/subagents/index.ts";
import tasksPlugin, {
	readTaskState,
	TASK_STATE_ENTRY,
	type TaskRecord,
	type TaskState,
	updateTask,
} from "../../src/extensions/tasks/index.ts";
import { initTheme, theme } from "../../src/modes/interactive/theme/theme.ts";
import { raceWithAbortSignal } from "../../src/utils/abort.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness, createTestUiContext, getToolResult } from "./harness.ts";

const task = (id: string, status: TaskRecord["status"] = "pending"): TaskRecord => ({
	id,
	subject: `Task ${id}`,
	description: "Verify the result",
	status,
	metadata: {},
	blockedBy: [],
});
const subagents = () => createSubagentsExtension({ agentDir: join(tmpdir(), `pi-ext-test-${randomUUID()}`) });

describe("native tasks plugin", () => {
	it("restores only the active branch and returns detached state", () => {
		const manager = SessionManager.inMemory();
		const first = manager.appendCustomEntry(TASK_STATE_ENTRY, { nextId: 2, tasks: [task("1")] });
		manager.appendCustomEntry(TASK_STATE_ENTRY, { nextId: 3, tasks: [task("1"), task("2")] });
		manager.branch(first);
		const state = readTaskState(manager);
		expect(state.tasks.map((item) => item.id)).toEqual(["1"]);
		state.tasks[0].subject = "Changed";
		expect(readTaskState(manager).tasks[0].subject).toBe("Task 1");
	});
	it("rejects dependency cycles atomically and blocks progress until dependencies complete", () => {
		const original: TaskState = { nextId: 3, tasks: [task("1"), task("2")] };
		const linked = updateTask(original, { taskId: "2", addBlockedBy: ["1"] });
		expect(() => updateTask(linked, { taskId: "1", addBlockedBy: ["2"] })).toThrow("cycle");
		expect(() => updateTask(linked, { taskId: "2", status: "in_progress" })).toThrow("blocked");
		expect(original.tasks[1].blockedBy).toEqual([]);
		const unblocked = updateTask(linked, { taskId: "1", status: "completed" });
		expect(updateTask(unblocked, { taskId: "2", status: "in_progress" }).tasks[1].status).toBe("in_progress");
	});
	it("merges metadata, removes null keys, and removes deleted dependencies", () => {
		const original: TaskState = {
			nextId: 3,
			tasks: [
				{ ...task("1"), metadata: { old: 1 } },
				{ ...task("2"), blockedBy: ["1"] },
			],
		};
		const updated = updateTask(original, { taskId: "1", metadata: { old: null, new: 2 } });
		expect(updated.tasks[0].metadata).toEqual({ new: 2 });
		expect(updateTask(updated, { taskId: "1", status: "deleted" }).tasks).toEqual([task("2")]);
		expect(() => updateTask(original, { taskId: "missing" })).toThrow("Unknown task");
	});
	it("ignores a terminal result from a superseded task owner", async () => {
		let events!: EventBus;
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					events = pi.events;
					tasksPlugin(pi);
				},
			],
		});
		try {
			await harness.session.bindExtensions({});
			harness.sessionManager.appendCustomEntry(TASK_STATE_ENTRY, {
				nextId: 2,
				tasks: [{ ...task("1", "in_progress"), owner: "new-run" }],
			});
			events.emit("pi-ext.task-run", { taskId: "1", status: "completed", owner: "old-run" });
			expect(readTaskState(harness.sessionManager).tasks[0]).toMatchObject({
				status: "in_progress",
				owner: "new-run",
			});
			events.emit("pi-ext.task-run", { taskId: "1", status: "completed", owner: "new-run" });
			expect(readTaskState(harness.sessionManager).tasks[0].status).toBe("completed");
		} finally {
			harness.cleanup();
		}
	});

	it("registers usable CRUD tools without duplicating Todo in composer widgets", async () => {
		const harness = await createHarness({ extensionFactories: [tasksPlugin] });
		const setWidget = vi.fn();
		try {
			await harness.session.bindExtensions({ uiContext: createTestUiContext({ setWidget }) });
			harness.setResponses([
				fauxAssistantMessage(
					fauxToolCall("TaskCreate", {
						subject: "Add tests",
						description: "Test a real state transition",
						activeForm: "Adding tests",
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(fauxToolCall("TaskUpdate", { taskId: "1", status: "in_progress" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage(fauxToolCall("TaskGet", { taskId: "1" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("Track the work");
			expect(getToolResult(harness, "TaskGet").isError).toBe(false);
			expect(readTaskState(harness.sessionManager).tasks[0].status).toBe("in_progress");
			expect(setWidget).not.toHaveBeenCalled();
			expect(readTaskState(harness.sessionManager).tasks[0].subject).toBe("Add tests");
		} finally {
			harness.cleanup();
		}
	});
});

describe("native subagents plugin", () => {
	it("allows a new delegation after tree navigation is cancelled", async () => {
		const harness = await createHarness({
			extensionFactories: [
				subagents(),
				(pi) => {
					pi.on("session_before_tree", () => ({ cancel: true }));
				},
			],
		});
		try {
			await harness.session.bindExtensions({});
			const result = await harness.session.extensionRunner.emit({
				type: "session_before_tree",
				preparation: {
					targetId: "target",
					oldLeafId: null,
					commonAncestorId: null,
					entriesToSummarize: [],
					userWantsSummary: false,
				},
				signal: new AbortController().signal,
			});
			expect(result?.cancel).toBe(true);
			harness.setResponses([fauxAssistantMessage("child after cancelled navigation")]);
			const tool = harness.session.getToolDefinition("Agent")!;
			const output = await tool.execute(
				"after-tree",
				{ prompt: "Return a result", run_in_background: false },
				undefined,
				undefined,
				harness.session.extensionRunner.createToolContext("after-tree", undefined),
			);
			expect((output.details as SubagentRecord).status).toBe("completed");
		} finally {
			harness.cleanup();
		}
	});
	it("restores an interrupted branch task to pending", async () => {
		const harness = await createHarness({ extensionFactories: [tasksPlugin, subagents()] });
		try {
			await harness.session.bindExtensions({});
			harness.sessionManager.appendCustomEntry(TASK_STATE_ENTRY, {
				nextId: 2,
				tasks: [{ ...task("1", "in_progress"), owner: "old-run", agentType: "worker" }],
			});
			harness.sessionManager.appendCustomEntry("pi-ext.subagent", {
				id: "old-run",
				agent: "worker",
				prompt: "Old task",
				description: "Old task",
				status: "running",
				model: "faux/faux-1",
				thinking: "off",
				startedAt: 1,
				output: "",
				taskId: "1",
			});
			await harness.session.extensionRunner.emit({
				type: "session_tree",
				newLeafId: harness.sessionManager.getLeafId(),
				oldLeafId: null,
			});
			expect(readTaskState(harness.sessionManager).tasks[0].status).toBe("pending");
			const entry = harness.sessionManager
				.getBranch()
				.findLast((item) => item.type === "custom" && item.customType === "pi-ext.subagent");
			expect(entry?.type === "custom" ? entry.data : undefined).toMatchObject({
				status: "interrupted",
				taskId: "1",
			});
		} finally {
			harness.cleanup();
		}
	});
	it("uses an isolated foreground session and accounts usage once", async () => {
		const harness = await createHarness({ extensionFactories: [subagents()] });
		const setWidget = vi.fn();
		try {
			await harness.session.bindExtensions({ uiContext: createTestUiContext({ setWidget }) });
			harness.setResponses([
				fauxAssistantMessage(
					fauxToolCall("Agent", {
						prompt: "Return a bounded result",
						description: "Inspect auth flow",
						run_in_background: false,
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("child result"),
				fauxAssistantMessage("parent done"),
			]);
			await harness.session.prompt("Delegate");
			const result = getToolResult(harness, "Agent");
			const record = result.details as SubagentRecord;
			expect(result.isError).toBe(false);
			expect(record.status).toBe("completed");
			expect(record.output).toBe("child result");
			initTheme("dark");
			const factory = setWidget.mock.calls.at(-1)![1];
			const rows = factory({ requestRender: vi.fn() } as unknown as TUI, theme)
				.render(80)
				.map(stripAnsi);
			expect(rows.join("\n")).toContain("Inspect auth flow");
			expect(rows[0]).toContain("Subagents");
			expect(record.model).toBe(`${harness.getModel().provider}/${harness.getModel().id}`);
			expect(harness.session.getSessionStats().assistantMessages).toBe(2);
			expect(
				harness.sessionManager.getEntries().filter((entry) => entry.type === "usage" && entry.kind === "subagent"),
			).toHaveLength(1);
		} finally {
			harness.cleanup();
		}
	});
	it("rejects unknown agents before starting work", async () => {
		const harness = await createHarness({ extensionFactories: [subagents()] });
		try {
			await harness.session.bindExtensions({});
			harness.setResponses([
				fauxAssistantMessage(
					fauxToolCall("Agent", { prompt: "Do work", subagent_type: "missing", run_in_background: false }),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("Delegate");
			expect(getToolResult(harness, "Agent").isError).toBe(true);
			expect(
				harness.sessionManager
					.getEntries()
					.filter((entry) => entry.type === "custom" && entry.customType === "pi-ext.subagent"),
			).toHaveLength(0);
		} finally {
			harness.cleanup();
		}
	});
	it("stops a delegated background task without completing the todo", async () => {
		const harness = await createHarness({
			extensionFactories: [tasksPlugin, subagents()],
			settings: { retry: { enabled: false } },
		});
		let started!: () => void;
		const childStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const never = new Promise<ReturnType<typeof fauxAssistantMessage>>(() => {});
		const response: FauxResponseFactory = async (context, options) => {
			const system = context.messages.find((message) => message.role === "system");
			if (
				system?.role === "system" &&
				getSystemMessageText(system).includes("You are an isolated worker subagent")
			) {
				started();
				return raceWithAbortSignal(never, options?.signal);
			}
			return fauxAssistantMessage("parent done");
		};
		try {
			await harness.session.bindExtensions({ mode: "rpc", uiContext: createTestUiContext() });
			harness.sessionManager.appendCustomEntry(TASK_STATE_ENTRY, {
				nextId: 2,
				tasks: [{ ...task("1"), agentType: "worker" }],
			});
			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("TaskExecute", { task_ids: ["1"] }), { stopReason: "toolUse" }),
				response,
				response,
				response,
			]);
			await harness.session.prompt("Execute task");
			await childStarted;
			const ctx = harness.session.extensionRunner.createToolContext("stop-test", undefined);
			const stop = harness.session.getToolDefinition("TaskStop")!;
			const result = await stop.execute("stop", { task_id: "1" }, undefined, undefined, ctx);
			expect((result.details as SubagentRecord).status).toBe("stopped");
			expect((result.details as SubagentRecord).description).toBe("Task 1");
			expect(readTaskState(harness.sessionManager).tasks[0].status).toBe("pending");
			await harness.session.waitForIdle();
		} finally {
			harness.cleanup();
		}
	});
});
