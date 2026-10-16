// Adapted from pi-usage 0.2.0 (MIT, Copyright 2026 chocotan).
// Source: https://github.com/chocotan/pi-usage at cd5e1dd3c40fedb0d8c27f78927988d3165be131.
import type { ExtensionAPI } from "../../core/extensions/types.ts";
import {
	aggregate,
	bucketOf,
	dayTotals,
	defaultSessionsDir,
	renderCalendar,
	renderTextTable,
	SessionScanner,
} from "./stats.ts";
import { parseView, UsageComponent } from "./view.ts";

export default function usageExtension(pi: ExtensionAPI): void {
	const scanner = new SessionScanner();
	const active = new Set<AbortController>();

	pi.registerCommand("usage", {
		description: "Token usage per provider/model — /usage [day|week|month|total|cal]",
		async handler(args, ctx) {
			const view = parseView(args);
			const controller = new AbortController();
			active.add(controller);
			try {
				if (ctx.mode !== "tui") {
					// Preserve the source's stderr output in print/JSON/RPC modes.
					const recs = await scanner.scan(defaultSessionsDir(), undefined, controller.signal);
					if (view === "cal") {
						const calendar = renderCalendar(dayTotals(recs), new Date(), 26);
						process.stderr.write(
							`pie-usage · cal · ${calendar.start} … ${calendar.end}\n${calendar.lines.join("\n")}\n`,
						);
					} else {
						const bucket = view === "total" ? null : bucketOf(Date.now(), view);
						process.stderr.write(
							`pie-usage · ${view} · ${bucket ?? "all time"}\n${renderTextTable(aggregate(recs, view, bucket))}\n`,
						);
					}
					return;
				}
				await ctx.ui.custom<null>(
					(tui, theme, keybindings, done) =>
						new UsageComponent(tui, theme, keybindings, done, view, scanner, defaultSessionsDir(), controller),
					{ overlay: true, overlayOptions: { width: "92%", maxHeight: "80%" } },
				);
			} catch (error) {
				if (!controller.signal.aborted) throw error;
			} finally {
				controller.abort();
				active.delete(controller);
			}
		},
	});

	pi.on("session_shutdown", () => {
		for (const controller of active) controller.abort();
		active.clear();
	});
}
