import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "../../config.ts";
import { parseFrontmatter } from "../../utils/frontmatter.ts";

export interface AgentDefinition {
	name: string;
	description: string;
	prompt: string;
	tools?: string[];
	model?: string;
	thinking?: string;
	source: "builtin" | "user" | "project";
}

const builtins: AgentDefinition[] = [
	{
		name: "worker",
		description: "Implement a bounded coding task and verify it.",
		prompt:
			"Complete the delegated implementation. Preserve existing changes and verify the result. Do not delegate further.",
		source: "builtin",
	},
	{
		name: "researcher",
		description: "Investigate code and report evidence without changing files.",
		prompt:
			"Investigate the task without modifying files. Return concrete evidence and unknowns. Do not delegate further.",
		tools: ["read", "bash", "grep", "find", "ls"],
		source: "builtin",
	},
	{
		name: "reviewer",
		description: "Independently review code and report actionable findings.",
		prompt:
			"Review the task without modifying files. Report verified findings by severity with file references. Do not delegate further.",
		tools: ["read", "bash", "grep", "find", "ls"],
		source: "builtin",
	},
];

export function discoverAgentDefinitions(cwd: string, agentDir: string, trusted: boolean): AgentDefinition[] {
	const definitions = new Map(builtins.map((agent) => [agent.name, agent]));
	const directories: Array<{ path: string; source: "user" | "project" }> = [
		{ path: join(agentDir, "agents"), source: "user" },
	];
	if (trusted) directories.push({ path: join(cwd, CONFIG_DIR_NAME, "agents"), source: "project" });
	for (const directory of directories) {
		let names: string[];
		try {
			names = readdirSync(directory.path)
				.filter((name) => name.endsWith(".md"))
				.sort();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		for (const name of names) {
			const path = join(directory.path, name);
			const { frontmatter, body } = parseFrontmatter(readFileSync(path, "utf8"));
			if (
				typeof frontmatter.name !== "string" ||
				!/^[a-zA-Z0-9_-]+$/.test(frontmatter.name) ||
				typeof frontmatter.description !== "string" ||
				!body.trim()
			)
				throw new Error(`Invalid agent definition: ${path}`);
			let tools: string[] | undefined;
			if (frontmatter.tools !== undefined) {
				const value =
					typeof frontmatter.tools === "string"
						? frontmatter.tools.split(",").map((tool) => tool.trim())
						: frontmatter.tools;
				if (!Array.isArray(value) || !value.every((tool) => typeof tool === "string" && tool.length > 0))
					throw new Error(`Invalid agent tools: ${path}`);
				tools = value;
			}
			if (frontmatter.model !== undefined && typeof frontmatter.model !== "string")
				throw new Error(`Invalid agent model: ${path}`);
			if (
				frontmatter.thinking !== undefined &&
				(typeof frontmatter.thinking !== "string" ||
					!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(frontmatter.thinking))
			)
				throw new Error(`Invalid thinking level: ${path}`);
			definitions.set(frontmatter.name, {
				name: frontmatter.name,
				description: frontmatter.description,
				prompt: body,
				tools,
				model: frontmatter.model,
				thinking: typeof frontmatter.thinking === "string" ? frontmatter.thinking : undefined,
				source: directory.source,
			});
		}
	}
	return [...definitions.values()];
}
