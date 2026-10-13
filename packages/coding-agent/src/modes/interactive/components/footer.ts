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

/** All token categories stay on one row; narrower terminals use shorter labels. */
export function formatUsageLine(totals: UsageTotals, hitRate: number | undefined, width: number): string {
	const input = formatTokens(totals.input);
	const output = formatTokens(totals.output);
	const cache = formatTokens(totals.cacheRead);
	const writes = totals.cacheWrite ? ` W${formatTokens(totals.cacheWrite)}` : "";
	const hit = hitRate === undefined ? "—" : `${hitRate.toFixed(1)}%`;
	const full = `↑${input} ↓${output} Cache ${cache}${writes} CH${hit}`;
	if (visibleWidth(full) <= width) return full;
	const compact = `↑${input} ↓${output} R${cache}${writes} CH${hit}`;
	if (visibleWidth(compact) <= width) return compact;
	return truncateToWidth(compact.replaceAll(" ", ""), width, "…");
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
	private showModel = true;
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;
	private sessionStats?: SessionStats;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
		this.session = session;
		this.footerData = footerData;
	}

	setShowModel(show: boolean): void {
		this.showModel = show;
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
		let cwd = formatCwdForFooter(this.session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
		const branch = this.footerData.getGitBranch();
		cwd += ` · ${branch ?? "No Git"}`;
		const name = this.session.sessionManager.getSessionName();
		if (name) cwd += ` · ${name}`;
		const window = contextUsage?.contextWindow ?? state.model?.contextWindow;
		const tokens = contextUsage?.tokens;
		const percent = contextUsage?.percent;
		const context = `Context ${tokens == null ? "—" : formatTokens(tokens)}/${window ? formatTokens(window) : "—"} · ${percent == null ? "—" : `${percent.toFixed(1)}%`}${this.autoCompactEnabled ? " (auto)" : ""}`;
		const color = (percent ?? 0) > 90 ? "error" : (percent ?? 0) > 70 ? "warning" : "dim";
		const lines = [
			truncateToWidth(theme.fg("dim", sanitizeStatusText(cwd)), width, "…"),
			theme.fg("dim", formatUsageLine(usageTotals, latestCacheHitRate, width)),
			truncateToWidth(theme.fg(color, context), width, "…"),
		];
		const details: string[] = [];
		if (this.showModel) {
			let model = state.model?.id ?? "No model";
			if (state.model?.reasoning) model += ` · ${state.thinkingLevel || "off"}`;
			if (this.footerData.getAvailableProviderCount() > 1 && state.model) model = `${state.model.provider}/${model}`;
			details.push(model);
		}
		const routed = this.session.routedModel;
		if (routed) details.push(`→ ${routed.model.id}${routed.thinkingLevel ? ` · ${routed.thinkingLevel}` : ""}`);
		const subscription = state.model
			? state.model.provider === "kimi-coding" || this.session.modelRuntime.isUsingSubscription(state.model.provider)
			: false;
		if (usageTotals.cost || subscription)
			details.push(`$${usageTotals.cost.toFixed(3)}${subscription ? " (sub)" : ""}`);
		if (areExperimentalFeaturesEnabled()) details.push("xp");
		if (details.length) lines.push(truncateToWidth(theme.fg("dim", details.join(" · ")), width, "…"));
		const statuses = [...this.footerData.getExtensionStatuses().entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, text]) => sanitizeStatusText(text));
		if (statuses.length) lines.push(truncateToWidth(statuses.join(" "), width, "…"));
		return lines;
	}
}
