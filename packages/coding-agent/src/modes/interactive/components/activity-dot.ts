import type { TUI } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Shared dot animation for queued and running work; owners dispose it when work settles or disappears. */
export class ActivityDot {
	private readonly timer: ReturnType<typeof setInterval>;
	constructor(ui: TUI) {
		this.timer = setInterval(() => ui.requestRender(), 80);
		this.timer.unref();
	}
	renderDot(): string {
		return theme.fg("warning", FRAMES[Math.floor(Date.now() / 80) % FRAMES.length]);
	}
	dispose(): void {
		clearInterval(this.timer);
	}
}
