import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ContextUsage } from "../src/core/extensions/types.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent, formatCwdForFooter } from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type AssistantUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
};

function createSession(options: {
	sessionName: string;
	cwd?: string;
	modelId?: string;
	provider?: string;
	reasoning?: boolean;
	thinkingLevel?: string;
	usage?: AssistantUsage;
	branchUsage?: AssistantUsage;
	compactionUsage?: AssistantUsage;
	toolUsage?: AssistantUsage;
	usingSubscription?: boolean;
	contextUsage?: ContextUsage;
	routedModel?: { model: { id: string }; thinkingLevel?: string };
}): AgentSession {
	const usage = options.usage;
	const entries: Array<Record<string, unknown>> = [];

	if (usage !== undefined) {
		entries.push({
			type: "message",
			message: {
				role: "assistant",
				usage,
			},
		});
	}

	if (options.branchUsage !== undefined) {
		entries.push({
			type: "branch_summary",
			usage: options.branchUsage,
		});
	}

	if (options.compactionUsage !== undefined) {
		entries.push({
			type: "compaction",
			usage: options.compactionUsage,
		});
	}

	if (options.toolUsage !== undefined) {
		entries.push({
			type: "message",
			message: {
				role: "toolResult",
				usage: options.toolUsage,
			},
		});
	}

	const session = {
		state: {
			model: {
				id: options.modelId ?? "test-model",
				provider: options.provider ?? "test",
				contextWindow: 200_000,
				reasoning: options.reasoning ?? false,
			},
			thinkingLevel: options.thinkingLevel ?? "off",
		},
		sessionManager: {
			getEntries: () => entries,
			getEntryCount: () => entries.length,
			getSessionId: () => "test-session",
			getLeafId: () => null,
			getSessionName: () => options.sessionName,
			getCwd: () => options.cwd ?? "/tmp/project",
		},
		getContextUsage: () => options.contextUsage ?? { tokens: 24_600, contextWindow: 200_000, percent: 12.3 },
		routedModel: options.routedModel,
		modelRuntime: {
			isUsingSubscription: () => options.usingSubscription ?? false,
		},
	};

	return session as unknown as AgentSession;
}

function createFooterData(providerCount: number): ReadonlyFooterDataProvider {
	const provider = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => providerCount,
		onBranchChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
	};

	return provider;
}

describe("formatCwdForFooter", () => {
	it("does not abbreviate sibling paths that share the home prefix", () => {
		expect(formatCwdForFooter("/home/user2", "/home/user")).toBe("/home/user2");
	});

	it("abbreviates the home directory and descendants", () => {
		expect(formatCwdForFooter("/home/user", "/home/user")).toBe("~");
		expect(formatCwdForFooter("/home/user/project", "/home/user")).toBe("~/project");
	});
});

describe("FooterComponent width handling", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("keeps all lines within width for wide session names", () => {
		const width = 93;
		const session = createSession({ sessionName: "한글".repeat(30) });
		const footer = new FooterComponent(session, createFooterData(1));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("keeps stats line within width for wide model and provider names", () => {
		const width = 60;
		const session = createSession({
			sessionName: "",
			modelId: "模".repeat(30),
			provider: "공급자",
			reasoning: true,
			thinkingLevel: "high",
			usage: {
				input: 12_345,
				output: 6_789,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(2));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("shows the physical model a virtual model routed to", () => {
		const session = createSession({
			sessionName: "",
			modelId: "auto",
			reasoning: true,
			thinkingLevel: "high",
			routedModel: { model: { id: "gpt-5.6-luna" }, thinkingLevel: "medium" },
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const statsLine = stripAnsi(footer.render(120).join("\n"));

		expect(statsLine).toContain("auto • high");
		expect(statsLine).toContain("→ gpt-5.6-luna • medium");
	});

	it("includes summary and tool result usage in the total cost", () => {
		const session = createSession({
			sessionName: "",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.5 },
			},
			branchUsage: {
				input: 20,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.25 },
			},
			compactionUsage: {
				input: 5,
				output: 2,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.125 },
			},
			toolUsage: {
				input: 15,
				output: 3,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.375 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const statsLine = stripAnsi(footer.render(120).join("\n"));
		expect(statsLine).toContain("$1.250");
	});

	it("updates cached usage totals after an entry is appended", () => {
		const usage = { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.5 } };
		const session = createSession({ sessionName: "", usage });
		const footer = new FooterComponent(session, createFooterData(1));
		expect(stripAnsi(footer.render(120).join("\n"))).toContain("$0.500");

		session.sessionManager.getEntries().push({ type: "message", message: { role: "assistant", usage } } as never);
		expect(stripAnsi(footer.render(120).join("\n"))).toContain("$1.000");
	});

	it("shows the latest cache hit rate when cache usage is present", () => {
		const session = createSession({
			sessionName: "",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 50,
				cacheWrite: 50,
				cost: { total: 0.001 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const statsLine = stripAnsi(footer.render(120).join("\n"));
		expect(statsLine).toContain("CH25.0%");
	});

	it("shows path, usage, model and thinking on one right-aligned row", () => {
		const footer = new FooterComponent(
			createSession({
				sessionName: "",
				modelId: "gpt-6.1-sol",
				reasoning: true,
				thinkingLevel: "high",
				usage: { input: 12345, output: 6789, cacheRead: 50, cacheWrite: 10, cost: { total: 0.5 } },
			}),
			createFooterData(1),
		);
		for (const width of [80, 120, 200]) {
			const rows = footer.render(width).map(stripAnsi);
			expect(rows).toHaveLength(1);
			expect(visibleWidth(rows[0])).toBe(width);
			expect(rows[0].endsWith("gpt-6.1-sol • high")).toBe(true);
			expect(rows[0]).toContain("/tmp/project (main)");
			expect(rows[0]).toContain("↑12k ↓6.8k");
		}
		const wideRow = stripAnsi(footer.render(200)[0]);
		expect(wideRow).toContain("R50 W10 CH");
		expect(wideRow).toContain("$0.500");
		expect(wideRow).toContain("12.3%/200k (auto)");
	});

	it("drops optional stats and truncates the path before core tokens and thinking", () => {
		const footer = new FooterComponent(
			createSession({
				sessionName: "long session name",
				cwd: "/tmp/a/very/long/project/path",
				modelId: "test-model",
				reasoning: true,
				thinkingLevel: "high",
				usage: { input: 12345, output: 6789, cacheRead: 50000, cacheWrite: 100, cost: { total: 0.5 } },
			}),
			createFooterData(2),
		);
		const [row] = footer.render(48).map(stripAnsi);
		expect(visibleWidth(row)).toBe(48);
		expect(row).toContain("/tmp/");
		expect(row).toContain("…");
		expect(row).toContain("↑12k ↓6.8k");
		expect(row.endsWith("test-model • high")).toBe(true);
		expect(row).not.toContain("CH");
		expect(row).not.toContain("$0.500");
		expect(row).not.toContain("(test)");
	});

	it("keeps Unicode and ANSI content within even very narrow widths", () => {
		const footer = new FooterComponent(
			createSession({
				sessionName: "\u001b[31m한글 👩🏽‍💻 é\u001b[0m".repeat(10),
				cwd: "/tmp/项目",
				modelId: "模".repeat(30),
				routedModel: { model: { id: "physical-model" }, thinkingLevel: "medium" },
				reasoning: true,
				thinkingLevel: "high",
				usage: { input: 12345, output: 6789, cacheRead: 50000, cacheWrite: 100, cost: { total: 0.5 } },
				contextUsage: { tokens: 190000, contextWindow: 200000, percent: 95 },
			}),
			createFooterData(2),
		);
		for (let width = 0; width <= 200; width++) {
			const rows = footer.render(width);
			expect(rows).toHaveLength(1);
			expect(visibleWidth(rows[0])).toBeLessThanOrEqual(width);
		}
		expect(stripAnsi(footer.render(60)[0])).toContain("↑12k ↓6.8k");
		expect(stripAnsi(footer.render(60)[0]).endsWith(" • high")).toBe(true);
	});

	it("retains sorted and sanitized extension statuses on their own row", () => {
		const footer = new FooterComponent(createSession({ sessionName: "" }), {
			...createFooterData(1),
			getExtensionStatuses: () =>
				new Map([
					["z", "\u001b[32mReady\u001b[0m"],
					["a", "Running\n\t task"],
				]),
		});
		const rows = footer.render(80).map(stripAnsi);
		expect(rows).toHaveLength(2);
		expect(rows[1]).toBe("Running task Ready");
		for (let width = 0; width <= 20; width++) {
			for (const row of footer.render(width)) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
		}
	});

	it("shows provider and detached branch when supplied and space permits", () => {
		const footer = new FooterComponent(createSession({ sessionName: "", reasoning: true }), {
			...createFooterData(2),
			getGitBranch: () => "detached",
		});
		const [row] = footer.render(120).map(stripAnsi);
		expect(row).toContain("/tmp/project (detached)");
		expect(row.endsWith("(test) test-model • thinking off")).toBe(true);
	});
	it("omits the Git placeholder when the directory is not a repository", () => {
		const footer = new FooterComponent(createSession({ sessionName: "" }), {
			...createFooterData(1),
			getGitBranch: () => null,
		});
		const line = stripAnsi(footer.render(80)[0]);
		expect(line).toContain("/tmp/project");
		expect(line).not.toContain("No Git");
		expect(line).not.toContain(" · ");
	});
	it("keeps token and context statistics in the native footer", () => {
		const footer = new FooterComponent(
			createSession({
				sessionName: "",
				usage: { input: 5400000, output: 287000, cacheRead: 166000000, cacheWrite: 0, cost: { total: 0 } },
				contextUsage: { tokens: 796000, contextWindow: 1000000, percent: 79.6 },
			}),
			createFooterData(1),
		);
		const usage = footer.render(120).map(stripAnsi).join("\n");
		expect(usage).toContain("↑5.4M ↓287k");
		expect(usage).toContain("R166M CH");
		expect(usage).toContain("79.6%/1.0M (auto)");
	});

	it("marks Kimi Coding costs as subscription estimates", () => {
		const session = createSession({
			sessionName: "",
			provider: "kimi-coding",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		expect(stripAnsi(footer.render(120).join("\n"))).toContain("$1.234 (sub)");
	});

	it("marks explicitly identified subscription auth", () => {
		const session = createSession({ sessionName: "", provider: "anthropic", usingSubscription: true });
		const footer = new FooterComponent(session, createFooterData(1));

		expect(stripAnsi(footer.render(120).join("\n"))).toContain("$0.000 (sub)");
	});

	it("does not mark generic OAuth sign-in as a subscription", () => {
		const session = createSession({
			sessionName: "",
			provider: "openrouter",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));
		const stats = stripAnsi(footer.render(120).join("\n"));

		expect(stats).toContain("$1.234");
		expect(stats).not.toContain("(sub)");
	});
});
