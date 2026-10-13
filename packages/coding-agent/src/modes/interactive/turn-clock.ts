export type TurnStatus = "Ready" | "Running" | "Done" | "Stopped" | "Failed";

/** One clock per user run; automatic retries keep the same start time. */
export class TurnClock {
	status: TurnStatus = "Ready";
	private startedAt = 0;
	private elapsed = 0;
	private timer: ReturnType<typeof setInterval> | undefined;

	start(render: () => void): void {
		if (this.status === "Running") return;
		this.dispose();
		this.status = "Running";
		this.startedAt = Date.now();
		this.timer = setInterval(render, 1000);
		this.timer.unref();
	}
	finish(status: Exclude<TurnStatus, "Ready" | "Running">): void {
		if (this.status === "Running") this.elapsed = Date.now() - this.startedAt;
		this.status = status;
		this.dispose();
	}
	reset(): void {
		this.dispose();
		this.status = "Ready";
		this.elapsed = 0;
	}
	get label(): string {
		if (this.status === "Ready") return "Ready";
		const elapsed = this.status === "Running" ? Date.now() - this.startedAt : this.elapsed;
		return `${this.status} ${(Math.max(0, elapsed) / 1000).toFixed(1)}s`;
	}
	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}
}
