import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import { areExperimentalFeaturesEnabled } from "../../../core/experimental.ts";
import type { ContextUsage } from "../../../core/extensions/types.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { addUsageToTotals, createUsageTotals, type UsageTotals } from "../../../core/usage-totals.ts";
import { theme } from "../theme/theme.ts";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts for compact footer display.
 */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

interface SessionStats {
	session: AgentSession;
	sessionId: string;
	leafId: string | null;
	entryCount: number;
	limitsModel: unknown;
	usageTotals: UsageTotals;
	latestCacheHitRate: number | undefined;
	contextUsage: ContextUsage | undefined;
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private autoCompactEnabled = true;
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;
	private sessionStats?: SessionStats;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
		this.session = session;
		this.footerData = footerData;
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	/**
	 * Usage totals and context usage scan the whole session, and the footer renders on every frame.
	 * Entries are append-only and every append moves the leaf, so the results only change with the
	 * session, leaf, entry count, or the model whose context window applies.
	 */
	private getSessionStats(): SessionStats {
		const sessionManager = this.session.sessionManager;
		const entryCount = sessionManager.getEntryCount();
		const sessionId = sessionManager.getSessionId();
		const leafId = sessionManager.getLeafId();
		const limitsModel = this.session.routedModel?.model ?? this.session.model;
		const cached = this.sessionStats;
		if (
			cached &&
			cached.session === this.session &&
			cached.sessionId === sessionId &&
			cached.leafId === leafId &&
			cached.entryCount === entryCount &&
			cached.limitsModel === limitsModel
		) {
			return cached;
		}

		// Calculate cumulative usage from ALL session entries (not just post-compaction messages)
		const usageTotals = createUsageTotals();
		let latestCacheHitRate: number | undefined;

		for (const entry of sessionManager.getEntries()) {
			if (entry.type === "usage") {
				addUsageToTotals(usageTotals, entry.usage);
			} else if (entry.type === "message" && entry.message.role === "assistant") {
				addUsageToTotals(usageTotals, entry.message.usage);

				const latestPromptTokens =
					entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite;
				latestCacheHitRate =
					latestPromptTokens > 0 ? (entry.message.usage.cacheRead / latestPromptTokens) * 100 : undefined;
			} else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
				addUsageToTotals(usageTotals, entry.message.usage);
			} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
				addUsageToTotals(usageTotals, entry.usage);
			}
		}

		// Calculate context usage from session (handles compaction correctly).
		// After compaction, tokens are unknown until the next LLM response.
		const contextUsage = this.session.getContextUsage();
		this.sessionStats = {
			session: this.session,
			sessionId,
			leafId,
			entryCount,
			limitsModel,
			usageTotals,
			latestCacheHitRate,
			contextUsage,
		};
		return this.sessionStats;
	}

	render(width: number): string[] {
		const state = this.session.state;
		const { usageTotals, latestCacheHitRate, contextUsage } = this.getSessionStats();
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

		// Replace home directory with ~
		let pwd = formatCwdForFooter(this.session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);

		// Add git branch if available
		const branch = this.footerData.getGitBranch();
		if (branch) {
			pwd = `${pwd} (${branch})`;
		}

		// Add session name if set
		const sessionName = this.session.sessionManager.getSessionName();
		if (sessionName) {
			pwd = `${pwd} • ${sessionName}`;
		}

		// Build stats line
		const statsParts = [];
		if (usageTotals.input) statsParts.push(`↑${formatTokens(usageTotals.input)}`);
		if (usageTotals.output) statsParts.push(`↓${formatTokens(usageTotals.output)}`);
		const coreStatsCount = statsParts.length;
		const coreStatsWidth = visibleWidth(statsParts.join(" "));
		if (usageTotals.cacheRead) statsParts.push(`R${formatTokens(usageTotals.cacheRead)}`);
		if (usageTotals.cacheWrite) statsParts.push(`W${formatTokens(usageTotals.cacheWrite)}`);
		if ((usageTotals.cacheRead > 0 || usageTotals.cacheWrite > 0) && latestCacheHitRate !== undefined) {
			statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
		}

		// Kimi Coding is subscription-backed despite using API-key authentication.
		const usingSubscription = state.model
			? state.model.provider === "kimi-coding" || this.session.modelRuntime.isUsingSubscription(state.model.provider)
			: false;
		if (usageTotals.cost || usingSubscription) {
			const costStr = `$${usageTotals.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
			statsParts.push(costStr);
		}

		// Colorize context percentage based on usage
		let contextPercentStr: string;
		const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
		const contextPercentDisplay =
			contextPercent === "?"
				? `?/${formatTokens(contextWindow)}${autoIndicator}`
				: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
		if (contextPercentValue > 90) {
			contextPercentStr = theme.fg("error", contextPercentDisplay);
		} else if (contextPercentValue > 70) {
			contextPercentStr = theme.fg("warning", contextPercentDisplay);
		} else {
			contextPercentStr = contextPercentDisplay;
		}
		statsParts.push(contextPercentStr);
		if (areExperimentalFeaturesEnabled()) {
			statsParts.push(`${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`);
		}

		// Reserve model/thinking and core token counts before fitting the path and optional stats.
		const modelName = state.model?.id || "no-model";
		const thinkingLevel = state.thinkingLevel || "off";
		const thinking = state.model?.reasoning ? ` • ${thinkingLevel === "off" ? "thinking off" : thinkingLevel}` : "";
		const rightBudget = Math.max(0, width - Math.min(coreStatsWidth + 2, Math.floor(width / 2)));
		const thinkingWidth = visibleWidth(thinking);
		let rightSide =
			rightBudget > thinkingWidth
				? truncateToWidth(modelName, rightBudget - thinkingWidth, "…") + thinking
				: truncateToWidth(modelName + thinking, rightBudget, "");

		// A virtual model routes each request; show where the latest response went.
		const routed = this.session.routedModel;
		if (routed) {
			const level = routed.thinkingLevel ? ` • ${routed.thinkingLevel}` : "";
			rightSide += truncateToWidth(` → ${routed.model.id}${level}`, rightBudget - visibleWidth(rightSide), "…");
		}

		// Provider names are useful only when the rest of the footer fits in full.
		if (this.footerData.getAvailableProviderCount() > 1 && state.model) {
			const withProvider = `(${state.model.provider}) ${rightSide}`;
			if (visibleWidth(pwd) + visibleWidth(statsParts.join(" ")) + visibleWidth(withProvider) + 4 <= width) {
				rightSide = withProvider;
			}
		}

		const rightWidth = visibleWidth(rightSide);
		const leftBudget = Math.max(0, width - rightWidth - (rightWidth > 0 ? 2 : 0));
		const pathReserve = Math.min(visibleWidth(pwd), 12, Math.max(0, leftBudget - coreStatsWidth - 2));
		let statsLeft = statsParts.join(" ");
		while (statsParts.length > coreStatsCount && visibleWidth(statsLeft) + pathReserve + 2 > leftBudget) {
			statsParts.pop();
			statsLeft = statsParts.join(" ");
		}
		statsLeft = truncateToWidth(statsLeft, leftBudget, "…");
		const pathBudget = Math.max(0, leftBudget - visibleWidth(statsLeft) - (statsLeft ? 2 : 0));
		const path = truncateToWidth(pwd, pathBudget, "…");
		const leftSide = path + (path && statsLeft ? "  " : "") + statsLeft;
		const padding = " ".repeat(Math.max(0, width - visibleWidth(leftSide) - rightWidth));
		// Dim each section separately so colored context warnings retain their styling.
		const lines = [theme.fg("dim", leftSide) + theme.fg("dim", padding + rightSide)];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
