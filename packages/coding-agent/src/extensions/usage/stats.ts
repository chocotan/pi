// Adapted from pi-usage 0.2.0 (MIT, Copyright 2026 chocotan).
/**
 * Scan local session files and aggregate recorded token usage.
 * Local files only; no provider or quota requests.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { ENV_SESSION_DIR, expandTildePath, getSessionsDir } from "../../config.ts";

export interface Rec {
	id?: string; // entry ID; copied session entries count only once per scan
	p: string; // provider
	m: string; // model
	ts: number; // ms epoch
	i: number; // input tokens
	o: number; // output tokens
	cr: number; // cache read tokens
	cw: number; // cache write tokens
	rs: number; // reasoning tokens
	t: number; // total tokens
	c: number; // cost total (0 when provider has no pricing)
}

export interface Agg {
	p: string;
	m: string;
	calls: number;
	i: number;
	o: number;
	cr: number;
	cw: number;
	rs: number;
	t: number;
	c: number;
}

export type Gran = "day" | "week" | "month" | "total";
export const GRANS: Gran[] = ["day", "week", "month", "total"];

export function defaultSessionsDir(): string {
	const override = process.env[ENV_SESSION_DIR];
	return override ? expandTildePath(override) : getSessionsDir();
}

// ---------- time buckets (local time; week = ISO-8601, Monday start) ----------

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));

export function dayKey(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function weekKey(d: Date): string {
	const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	const dow = (date.getDay() + 6) % 7; // Mon=0 .. Sun=6
	date.setDate(date.getDate() - dow + 3); // Thursday of this week
	const first = new Date(date.getFullYear(), 0, 4);
	first.setDate(first.getDate() - ((first.getDay() + 6) % 7) + 3);
	const week = 1 + Math.round((date.getTime() - first.getTime()) / (7 * 864e5));
	return `${date.getFullYear()}-W${pad(week)}`;
}

export function monthKey(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function bucketOf(ts: number, g: Gran): string {
	const d = new Date(ts);
	if (g === "day") return dayKey(d);
	if (g === "week") return weekKey(d);
	if (g === "month") return monthKey(d);
	return "total";
}

/** Shift a cursor date by ±1 unit of the granularity. */
export function shiftCursor(d: Date, g: Gran, dir: number): Date {
	const n = new Date(d.getTime());
	if (g === "day") n.setDate(n.getDate() + dir);
	else if (g === "week") n.setDate(n.getDate() + 7 * dir);
	else if (g === "month") {
		// clamp day: Jan 31 + 1 month must land in Feb, not Mar 3
		const day = n.getDate();
		n.setDate(1);
		n.setMonth(n.getMonth() + dir);
		const dim = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
		n.setDate(Math.min(day, dim));
	}
	return n;
}

// ---------- scanning (mtime+size cache; deduplicate each complete snapshot) ----------

interface CacheEntry {
	mtimeMs: number;
	size: number;
	recs: Rec[];
}

function object(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function nonnegative(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function parseData(data: string): Rec[] {
	const recs: Rec[] = [];
	for (const line of data.split("\n")) {
		let entry: Record<string, unknown> | undefined;
		try {
			entry = object(JSON.parse(line));
		} catch {
			continue;
		}
		const msg = object(entry?.message);
		if (entry?.type !== "message" || msg?.role !== "assistant") continue;
		const usage = object(msg.usage);
		if (!usage || typeof msg.provider !== "string" || !msg.provider || typeof msg.model !== "string" || !msg.model)
			continue;
		if (typeof msg.timestamp !== "number" || !Number.isFinite(new Date(msg.timestamp).getTime())) continue;
		const i = Math.floor(nonnegative(usage.input));
		const o = Math.floor(nonnegative(usage.output));
		const cr = Math.floor(nonnegative(usage.cacheRead));
		const cw = Math.floor(nonnegative(usage.cacheWrite));
		const t = Math.floor(nonnegative(usage.totalTokens)) || i + o + cr + cw;
		if (t <= 0) continue;
		// Session files are untrusted: names must not inject terminal commands or rows.
		const clean = (text: string): string =>
			stripVTControlCharacters(text).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "");
		recs.push({
			id: typeof entry.id === "string" && entry.id ? entry.id : undefined,
			p: clean(msg.provider),
			m: clean(msg.model),
			ts: msg.timestamp,
			i,
			o,
			cr,
			cw,
			rs: Math.floor(nonnegative(usage.reasoning)),
			t,
			c: nonnegative(object(usage.cost)?.total),
		});
	}
	return recs;
}

async function listSessionFiles(dir: string): Promise<string[]> {
	const files: string[] = [];
	let projects: fs.Dirent[];
	try {
		projects = await fs.promises.readdir(dir, { withFileTypes: true });
	} catch {
		return files;
	}
	for (const project of projects) {
		if (project.isFile() && project.name.endsWith(".jsonl")) files.push(path.join(dir, project.name));
		if (!project.isDirectory()) continue;
		const projectDir = path.join(dir, project.name);
		try {
			for (const file of await fs.promises.readdir(projectDir, { withFileTypes: true })) {
				if (file.isFile() && file.name.endsWith(".jsonl")) files.push(path.join(projectDir, file.name));
			}
		} catch {
			// A removed or unreadable project directory does not invalidate other history.
		}
	}
	return files.sort();
}

/** Each extension instance owns its cache. Changed files replace their cached snapshot. */
export class SessionScanner {
	private fileCache = new Map<string, CacheEntry>();

	async scan(dir: string, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<Rec[]> {
		signal?.throwIfAborted();
		const files = await listSessionFiles(dir);
		signal?.throwIfAborted();
		const present = new Set(files);
		for (const cached of this.fileCache.keys()) {
			if (!present.has(cached)) this.fileCache.delete(cached);
		}
		const out: Rec[] = [];
		const seen = new Set<string>();
		const batchSize = 16;
		for (let i = 0; i < files.length; i += batchSize) {
			signal?.throwIfAborted();
			const batch = await Promise.all(
				files.slice(i, i + batchSize).map(async (file) => {
					try {
						const stat = await fs.promises.stat(file);
						const hit = this.fileCache.get(file);
						if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.recs;
						const data = await fs.promises.readFile(file, { encoding: "utf8", signal });
						signal?.throwIfAborted();
						const recs = parseData(data);
						this.fileCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, recs });
						return recs;
					} catch {
						signal?.throwIfAborted();
						return [];
					}
				}),
			);
			signal?.throwIfAborted();
			for (const recs of batch) {
				for (const rec of recs) {
					const key = rec.id ? JSON.stringify([rec.id, rec.p, rec.m, rec.ts]) : undefined;
					if (key && seen.has(key)) continue;
					if (key) seen.add(key);
					out.push(rec);
				}
			}
			onProgress?.(Math.min(i + batchSize, files.length), files.length);
		}
		return out;
	}
}

// ---------- aggregation ----------

export function aggregate(recs: Rec[], g: Gran, bucket: string | null): Agg[] {
	const map = new Map<string, Agg>();
	for (const r of recs) {
		if (g !== "total" && bucketOf(r.ts, g) !== bucket) continue;
		const key = JSON.stringify([r.p, r.m]);
		let a = map.get(key);
		if (!a) {
			a = { p: r.p, m: r.m, calls: 0, i: 0, o: 0, cr: 0, cw: 0, rs: 0, t: 0, c: 0 };
			map.set(key, a);
		}
		a.calls++;
		a.i += r.i;
		a.o += r.o;
		a.cr += r.cr;
		a.cw += r.cw;
		a.rs += r.rs;
		a.t += r.t;
		a.c += r.c;
	}
	return [...map.values()].sort((x, y) => y.t - x.t);
}

export function totals(rows: Agg[]): Agg {
	const t: Agg = { p: "", m: "", calls: 0, i: 0, o: 0, cr: 0, cw: 0, rs: 0, t: 0, c: 0 };
	for (const r of rows) {
		t.calls += r.calls;
		t.i += r.i;
		t.o += r.o;
		t.cr += r.cr;
		t.cw += r.cw;
		t.rs += r.rs;
		t.t += r.t;
		t.c += r.c;
	}
	return t;
}

// ---------- calendar heatmap ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHADES = ["·", "░", "▒", "▓", "█"];

function mondayOf(d: Date): Date {
	const n = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	n.setDate(n.getDate() - ((n.getDay() + 6) % 7));
	return n;
}

export interface Calendar {
	lines: string[]; // month labels + 7 day rows + legend
	start: string;
	end: string;
}

/** GitHub-style heatmap of total tokens/day, weeks as 2-char columns, Mon..Sun rows. */
export function renderCalendar(map: Map<string, number>, endDate: Date, cols: number): Calendar {
	const gutter = 4;
	cols = Math.max(4, cols);
	const today = new Date();
	const todayD = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	const endMon = mondayOf(endDate);
	const startMon = new Date(endMon);
	startMon.setDate(startMon.getDate() - 7 * (cols - 1));

	// scale + peak over the visible window
	let max = 0;
	let peakKey = "";
	let windowTotal = 0;
	for (let w = 0; w < cols; w++) {
		for (let dow = 0; dow < 7; dow++) {
			const d = new Date(startMon);
			d.setDate(d.getDate() + 7 * w + dow);
			if (d > todayD) continue;
			const v = map.get(dayKey(d)) ?? 0;
			windowTotal += v;
			if (v > max) {
				max = v;
				peakKey = dayKey(d);
			}
		}
	}
	const level = (v: number): number => (v === 0 || max === 0 ? 0 : Math.min(4, 1 + Math.floor((4 * v) / max)));

	// month labels: written when the column's Monday enters a new month
	const labelRow = new Array<string>(gutter + cols * 2).fill(" ");
	let lastEnd = 0;
	let prevMonth = -1;
	for (let w = 0; w < cols; w++) {
		const mon = new Date(startMon);
		mon.setDate(mon.getDate() + 7 * w);
		const m = mon.getMonth();
		const pos = gutter + w * 2;
		if (m !== prevMonth && pos >= lastEnd && pos + 3 <= labelRow.length) {
			const label = MONTHS[m]!;
			for (let i = 0; i < 3; i++) labelRow[pos + i] = label[i]!;
			lastEnd = pos + 4;
			prevMonth = m;
		} else if (m !== prevMonth) {
			prevMonth = m;
		}
	}

	const rowLabel = (dow: number): string => (dow === 0 ? "Mon " : dow === 2 ? "Wed " : dow === 4 ? "Fri " : "    ");
	const lines: string[] = [labelRow.join("").replace(/\s+$/, "")];
	for (let dow = 0; dow < 7; dow++) {
		let row = rowLabel(dow);
		for (let w = 0; w < cols; w++) {
			const d = new Date(startMon);
			d.setDate(d.getDate() + 7 * w + dow);
			if (d > todayD) {
				row += "  ";
				continue;
			}
			const v = map.get(dayKey(d)) ?? 0;
			const ch = SHADES[level(v)]!;
			row += ch + ch;
		}
		lines.push(row);
	}
	const endSun = new Date(endMon);
	endSun.setDate(endSun.getDate() + 6);
	const endD = endSun > todayD ? todayD : endSun;
	lines.push(
		`less ${SHADES.join("")} more` +
			(max > 0 ? ` · peak ${fmtNum(max)} (${peakKey})` : " · no usage") +
			` · window ${fmtNum(windowTotal)}`,
	);
	return { lines, start: dayKey(startMon), end: dayKey(endD) };
}

// ---------- formatting ----------

/** Total tokens per day (YYYY-MM-DD) — for the calendar heatmap. */
export function dayTotals(recs: Rec[]): Map<string, number> {
	const m = new Map<string, number>();
	for (const r of recs) {
		const k = dayKey(new Date(r.ts));
		m.set(k, (m.get(k) ?? 0) + r.t);
	}
	return m;
}

export function fmtNum(n: number): string {
	if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
	if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
	return String(n);
}

export function fmtCost(c: number): string {
	return c > 0 ? `$${c.toFixed(2)}` : "-";
}

/** Plain-text table of aggregated rows (for non-TUI output and tests). */
export function renderTextTable(rows: Agg[]): string {
	const sum = totals(rows);
	const head =
		"Provider            Model                     Calls    Input   Output   CacheR   CacheW    Total     Cost";
	const line = (p: string, m: string, a: Agg): string =>
		`${p.padEnd(20)}${m.padEnd(26)}${String(a.calls).padStart(6)} ${fmtNum(a.i).padStart(8)} ${fmtNum(a.o).padStart(8)} ${fmtNum(a.cr).padStart(8)} ${fmtNum(a.cw).padStart(8)} ${fmtNum(a.t).padStart(8)} ${fmtCost(a.c).padStart(8)}`;
	const body = rows.map((r) => line(r.p, r.m, r));
	return [head, ...body, "-".repeat(head.length), line("TOTAL", `${rows.length} models`, sum)].join("\n");
}
