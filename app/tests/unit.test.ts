import { describe, expect, test } from "bun:test";
import { resolveAnnotation } from "../src/bun/annotations/reanchor";
import { repairParts } from "../src/bun/jobs/runner";
import { clean, idsInRange, toEntry } from "../src/bun/jobs/work";
import { costOf } from "../src/bun/llm/client";

const anno = (exact: string, prefix: string, suffix: string, start: number, sid: string | null) => ({
	sid,
	target: {
		source: "doc:x",
		selector: [
			{ type: "TextQuoteSelector" as const, exact, prefix, suffix },
			{ type: "TextPositionSelector" as const, start, end: start + exact.length },
		],
	},
});

describe("annotation re-anchoring", () => {
	const items = [
		{ id: "P1", sid: "aaa", text: "The hazard ratio was 0.72 in the treated group." },
		{ id: "P2", sid: "bbb", text: "Mortality fell. The hazard ratio was 0.72 overall, and the hazard ratio was 0.80 in women." },
	];
	test("sid + position", () => {
		expect(resolveAnnotation(anno("hazard ratio", "The ", " was 0.72 in", 4, "aaa"), items)).toEqual({ pid: "P1", sid: "aaa", start: 4, end: 16 });
	});
	test("quote inside sid when positions moved; prefix/suffix break ties", () => {
		const r = resolveAnnotation(anno("hazard ratio", "and the ", " was 0.80", 3, "bbb"), items);
		expect(r?.pid).toBe("P2");
		expect(items[1].text.slice(r!.start, r!.end)).toBe("hazard ratio");
		expect(items[1].text.slice(r!.end, r!.end + 9)).toBe(" was 0.80");
	});
	test("sid gone (paragraph renumbered/split): document-wide quote search", () => {
		const r = resolveAnnotation(anno("in the treated group", "was 0.72 ", ".", 26, "zzz"), items);
		expect(r?.pid).toBe("P1");
	});
	test("orphaned when the text is gone", () => {
		expect(resolveAnnotation(anno("placebo arm", "", "", 0, "aaa"), items)).toBeNull();
	});
});

describe("parts repair", () => {
	test("gaps and overlaps become contiguous P1..Pn", () => {
		const parts = repairParts(
			[
				{ id: "S1", range: "P2-P4", claim_p: "P9", title: "a", role: "r" },
				{ id: "S2", range: "P4-P8", claim_p: "P6", title: "b", role: "r", flow: [{ p: "P3" }, { p: "P6" }] },
			],
			10,
		);
		expect(parts.map((p) => p.range)).toEqual(["P1-P3", "P4-P10"]);
		expect(parts[0].claim_p).toBe("P1");
		expect(parts[1].claim_p).toBe("P6");
		expect((parts[1].flow as { p: string }[]).map((s) => s.p)).toEqual(["P6"]);
	});
	test("nothing usable -> one skip part", () => {
		expect(repairParts([], 5)[0].range).toBe("P1-P5");
	});
});

describe("work helpers", () => {
	test("clean drops empty optional fields but keeps empty els", () => {
		expect(clean({ a: "", b: [], els: [], c: { tex: " ", x: "y" } }) as unknown).toEqual({ els: [], c: { x: "y" } });
	});
	test("toEntry normalises tiers", () => {
		const [id, e] = toEntry({ id: "P3", tier: "skim", role: "r", note: "n", read: "x", why: "w", els: [{ t: "claim", a: "", s: "s" }] });
		expect(id).toBe("P3");
		expect(e.read).toBeUndefined();
		expect(e.why).toBeUndefined();
		expect(e.els).toEqual([{ t: "claim", s: "s" }]);
	});
	test("idsInRange", () => {
		expect(idsInRange("P3-P5")).toEqual(["P3", "P4", "P5"]);
		expect(idsInRange("P7")).toEqual(["P7"]);
	});
});

test("cost accounting", () => {
	// 1M input + 1M output on Opus 5.5 = $4 + $20
	expect(costOf("claude-opus-5-5", { input_tokens: 1e6, output_tokens: 1e6 })).toBeCloseTo(24);
	// cache read at $0.20/M, cache write at 1.25x input
	expect(costOf("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 })).toBeCloseTo(0.2 + 5);
});
