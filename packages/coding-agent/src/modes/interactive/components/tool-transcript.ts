import { type Component, Container, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { stripAnsi } from "../../../utils/ansi.ts";
import { ToolExecutionComponent } from "./tool-execution.ts";

/** Lay out adjacent visible tools together, including tool-only assistant messages between them. */
export class ToolTranscriptContainer extends Container {
	private readonly layout = new Container();

	override render(width: number): string[] {
		this.layout.clear();
		let previousIsTool = false;
		let gaps: Component[] = [];
		for (const child of this.children) {
			const isTool = child instanceof ToolExecutionComponent;
			if (isTool) child.setLeadingGap(!previousIsTool);
			const rendered = child.render(width);
			if (!rendered.some((line) => stripAnsi(line).trim())) {
				if (rendered.length) gaps.push(child);
				continue;
			}
			if (!isTool || !previousIsTool) {
				for (const gap of gaps) this.layout.addChild(gap);
			}
			gaps = [];
			this.layout.addChild(child);
			previousIsTool = isTool;
		}
		for (const gap of gaps) this.layout.addChild(gap);
		return this.layout.render(width);
	}

	override handleMouse(event: TuiMouseEvent): ReturnType<Container["handleMouse"]> {
		return this.layout.handleMouse(event);
	}
}
