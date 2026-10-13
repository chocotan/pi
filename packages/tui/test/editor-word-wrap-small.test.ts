import assert from "node:assert/strict";
import { test } from "node:test";
import { wordWrapLine } from "../src/components/editor.ts";

test("word wrapping terminates for indivisible graphemes wider than one column", () => {
	for (const text of ["你好", "🚀", "你a好"]) {
		const chunks = wordWrapLine(text, 1);
		assert.equal(chunks.map((chunk) => chunk.text).join(""), text);
		assert.equal(chunks[0].startIndex, 0);
		assert.equal(chunks.at(-1)?.endIndex, text.length);
		assert.ok(chunks.length <= [...text].length);
	}
});
