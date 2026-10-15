import { Text } from "@earendil-works/pi-tui";
import { formatToolCallWithArgs, getToolCallDescription } from "../../core/tools/render-utils.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";

/** A readable subagent heading, with the original parameters retained when expanded. */
export function renderSubagentCall(
	name: string,
	caption: string,
	args: unknown,
	theme: Theme,
	expanded: boolean,
): Text {
	const purpose = getToolCallDescription({ description: caption }) ?? name;
	const heading = `${theme.fg("toolTitle", theme.bold(name))} ${theme.fg("accent", purpose)}`;
	if (!expanded) return new Text(heading, 0, 0);
	const parameters = formatToolCallWithArgs(name, args, theme, true).split("\n").slice(1).join("\n");
	// ToolExecutionComponent already draws an explicit description in its title.
	return new Text(getToolCallDescription(args) ? parameters : `${heading}\n${parameters}`, 0, 0);
}
