import * as fs from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_DIR_NAME, ENV_AGENT_DIR, ENV_SESSION_DIR } from "../src/config.ts";
import {
	aggregate,
	bucketOf,
	dayKey,
	dayTotals,
	defaultSessionsDir,
	fmtCost,
	fmtNum,
	monthKey,
	renderCalendar,
	renderTextTable,
	SessionScanner,
	shiftCursor,
	totals,
	weekKey,
} from "../src/extensions/usage/stats.ts";

const jan5 = new Date(2026, 0, 5, 12).getTime();
function entry(id: string, tokens = 150, timestamp = jan5, provider = "provider", model = "model") {
	return {
		type: "message",
		id,
		message: {
			role: "assistant",
			provider,
			model,
			timestamp,
			usage: {
				input: 100,
				output: 20,
				cacheRead: 20,
				cacheWrite: 10,
				reasoning: 5,
				totalTokens: tokens,
				cost: { total: 0.25 },
			},
		},
	};
}

describe("bundled usage statistics (synthetic history only)", () => {
	let root: string;
	let dir: string;
	beforeEach(() => {
		root = fs.mkdtempSync(join(tmpdir(), "pie-usage-test-"));
		vi.stubEnv(ENV_AGENT_DIR, root);
		vi.stubEnv(ENV_SESSION_DIR, undefined);
		dir = defaultSessionsDir();
		fs.mkdirSync(join(dir, "project"), { recursive: true });
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 0, 15, 12));
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		vi.useRealTimers();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("uses the application directory and its override instead of the old Pi root", () => {
		expect(defaultSessionsDir()).toBe(join(root, "sessions"));
		vi.stubEnv(ENV_AGENT_DIR, undefined);
		expect(defaultSessionsDir()).toBe(join(homedir(), CONFIG_DIR_NAME, "sessions"));
		vi.stubEnv(ENV_SESSION_DIR, join(root, "custom-sessions"));
		expect(defaultSessionsDir()).toBe(join(root, "custom-sessions"));
	});

	it("reads flat custom session directories as well as encoded project folders", async () => {
		fs.writeFileSync(join(dir, "flat.jsonl"), JSON.stringify(entry("flat")));
		fs.writeFileSync(join(dir, "project", "nested.jsonl"), JSON.stringify(entry("nested")));
		expect(await new SessionScanner().scan(dir)).toHaveLength(2);
	});

	it("keeps local date buckets, ISO year boundaries, and month-end cursor clamping", () => {
		expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
		expect(monthKey(new Date(2026, 11, 31))).toBe("2026-12");
		for (const date of [new Date(2025, 11, 29), new Date(2026, 0, 1), new Date(2026, 0, 4)]) {
			expect(weekKey(date)).toBe("2026-W01");
		}
		expect(weekKey(new Date(2026, 0, 5))).toBe("2026-W02");
		expect(weekKey(new Date(2021, 0, 1))).toBe("2020-W53");
		expect(dayKey(shiftCursor(new Date(2026, 0, 31), "month", 1))).toBe("2026-02-28");
		expect(dayKey(shiftCursor(new Date(2024, 2, 31), "month", -1))).toBe("2024-02-29");
		expect(dayKey(shiftCursor(new Date(2026, 0, 5), "week", -1))).toBe("2025-12-29");
		expect(bucketOf(jan5, "total")).toBe("total");
	});

	it("aggregates all source metrics per provider/model and selected period", async () => {
		const records = [
			entry("a"),
			entry("b", 300),
			entry("c", 50, jan5, "other"),
			entry("d", 1000, new Date(2026, 1, 1).getTime()),
		];
		fs.writeFileSync(join(dir, "project", "one.jsonl"), records.map((record) => JSON.stringify(record)).join("\n"));
		const recs = await new SessionScanner().scan(dir);
		const day = aggregate(recs, "day", "2026-01-05");
		expect(day).toHaveLength(2);
		expect(day[0]).toMatchObject({
			p: "provider",
			m: "model",
			calls: 2,
			i: 200,
			o: 40,
			cr: 40,
			cw: 20,
			rs: 10,
			t: 450,
			c: 0.5,
		});
		expect(totals(aggregate(recs, "week", "2026-W02")).t).toBe(500);
		expect(totals(aggregate(recs, "month", "2026-01")).t).toBe(500);
		expect(totals(aggregate(recs, "total", null))).toMatchObject({ calls: 4, t: 1500, c: 1 });
		expect(dayTotals(recs).get("2026-01-05")).toBe(500);
		expect(renderTextTable(day)).toContain("CacheR");
		expect(renderTextTable(day)).toContain("TOTAL");
		expect(renderTextTable(day)).toContain("$0.50");
		expect(aggregate(recs, "day", "2026-01-06")).toEqual([]);
	});

	it("keeps provider/model pairs containing slashes distinct", async () => {
		fs.writeFileSync(
			join(dir, "project", "one.jsonl"),
			[entry("a", 100, jan5, "a/b", "c"), entry("b", 200, jan5, "a", "b/c")]
				.map((record) => JSON.stringify(record))
				.join("\n"),
		);
		expect(aggregate(await new SessionScanner().scan(dir), "total", null)).toHaveLength(2);
	});

	it("deduplicates fork copies on every scan, caches unchanged files, and preserves unrelated ID collisions", async () => {
		const file = join(dir, "project", "a.jsonl");
		const copy = join(dir, "project", "b.jsonl");
		fs.writeFileSync(file, `${JSON.stringify(entry("same"))}\n`);
		fs.writeFileSync(copy, `${JSON.stringify(entry("same"))}\n${JSON.stringify(entry("same", 200, jan5 + 1))}\n`);
		const scanner = new SessionScanner();
		expect(await scanner.scan(dir)).toHaveLength(2);
		const read = vi.spyOn(fs.promises, "readFile");
		expect(await scanner.scan(dir)).toHaveLength(2);
		expect(read).not.toHaveBeenCalled();
		fs.appendFileSync(file, `${JSON.stringify(entry("new"))}\n`);
		expect(await scanner.scan(dir)).toHaveLength(3);
		expect(read).toHaveBeenCalledOnce();
		fs.rmSync(file);
		expect(await scanner.scan(dir)).toHaveLength(2);
		fs.writeFileSync(file, `${JSON.stringify(entry("same"))}\n`);
		expect(await scanner.scan(dir)).toHaveLength(2);
	});

	it("replaces rewritten snapshots and never double-counts entries without IDs", async () => {
		const file = join(dir, "project", "one.jsonl");
		const { id: _id, ...anonymous } = entry("unused");
		fs.writeFileSync(file, `${JSON.stringify(anonymous)}\n`);
		const scanner = new SessionScanner();
		expect(await scanner.scan(dir)).toHaveLength(1);
		fs.appendFileSync(file, `${JSON.stringify(entry("second"))}\n`);
		expect(await scanner.scan(dir)).toHaveLength(2);
		fs.writeFileSync(file, `${JSON.stringify(entry("replacement", 500))}\n`);
		const records = await scanner.scan(dir);
		expect(records).toHaveLength(1);
		expect(records[0].t).toBe(500);
	});

	it("tolerates partial/corrupt JSON and validates numeric fields without 32-bit overflow", async () => {
		const base = entry("valid", 3_000_000_000);
		const invalid = [
			null,
			[],
			{ type: "message", message: null },
			{ ...base, id: "bad-date", message: { ...base.message, timestamp: "wrong" } },
			{ ...base, id: "bad-provider", message: { ...base.message, provider: {} } },
		];
		const fallback = {
			...base,
			id: "fallback",
			message: {
				...base.message,
				usage: { input: 7, output: -4, cacheRead: 3, cacheWrite: "bad", cost: { total: -2 } },
			},
		};
		const spaced = JSON.stringify(entry("spaced")).replaceAll(":", ": ");
		fs.writeFileSync(
			join(dir, "project", "one.jsonl"),
			[
				"{broken",
				...invalid.map((record) => JSON.stringify(record)),
				JSON.stringify(base),
				JSON.stringify(fallback),
				spaced,
				'{"partial":',
			].join("\n"),
		);
		const recs = await new SessionScanner().scan(dir);
		expect(recs).toHaveLength(3);
		expect(recs[0].t).toBe(3_000_000_000);
		expect(recs[1]).toMatchObject({ i: 7, o: 0, cr: 3, cw: 0, t: 10, c: 0 });
	});

	it("strips terminal commands, newlines, and bidi controls from recorded names", async () => {
		fs.writeFileSync(
			join(dir, "project", "one.jsonl"),
			JSON.stringify(entry("a", 150, jan5, "\x1b]52;c;secret\x07provider\n", "\x1b[31mmodel\x1b[0m\u202e")),
		);
		const [rec] = await new SessionScanner().scan(dir);
		expect(rec.p).toBe("provider");
		expect(rec.m).toBe("model");
		expect(renderTextTable(aggregate([rec], "total", null))).not.toContain("\x1b");
	});

	it("skips missing/unreadable files and retries them on the next scan", async () => {
		const scanner = new SessionScanner();
		expect(await scanner.scan(join(root, "missing"))).toEqual([]);
		fs.writeFileSync(join(dir, "project", "one.jsonl"), JSON.stringify(entry("a")));
		vi.spyOn(fs.promises, "readFile").mockRejectedValueOnce(new Error("fixture read denied"));
		expect(await scanner.scan(dir)).toEqual([]);
		expect(await scanner.scan(dir)).toHaveLength(1);
	});

	it("reports bounded batch progress and aborts before or between batches", async () => {
		for (let i = 0; i < 17; i++)
			fs.writeFileSync(join(dir, "project", `${i}.jsonl`), JSON.stringify(entry(String(i))));
		const scanner = new SessionScanner();
		const progress = vi.fn();
		expect(await scanner.scan(dir, progress)).toHaveLength(17);
		expect(progress.mock.calls).toEqual([
			[16, 17],
			[17, 17],
		]);
		const controller = new AbortController();
		const cancel = vi.fn(() => controller.abort());
		await expect(scanner.scan(dir, cancel, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
		expect(cancel).toHaveBeenCalledOnce();
		await expect(scanner.scan(dir, undefined, AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
	});

	it("renders the source calendar shades, peak/window totals, and blank future days", () => {
		const map = new Map([
			["2026-01-12", 1_000_000],
			["2026-01-14", 500_000],
			["2026-01-16", 9_000_000],
		]);
		const calendar = renderCalendar(map, new Date(), 4);
		expect(calendar.lines).toHaveLength(9);
		expect(calendar.start).toBe("2025-12-22");
		expect(calendar.end).toBe("2026-01-15");
		expect(calendar.lines[1]).toMatch(/██$/);
		expect(calendar.lines[3]).toMatch(/▓▓$/);
		expect(calendar.lines[5]).toMatch(/ {2}$/);
		expect(calendar.lines[8]).toContain("peak 1.0M (2026-01-12)");
		expect(calendar.lines[8]).toContain("window 1.5M");
		expect(renderCalendar(new Map(), new Date(), 4).lines[8]).toContain("no usage");
		expect([fmtNum(999), fmtNum(1500), fmtNum(2_340_000), fmtNum(1_200_000_000)]).toEqual([
			"999",
			"1.5K",
			"2.3M",
			"1.2B",
		]);
		expect([fmtCost(0), fmtCost(1.234)]).toEqual(["-", "$1.23"]);
	});
});
