// Helpers for the WORK folder of one document: paragraphs.json, guide.json, paras_NN.json.
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Brief } from "../../shared/types";

export interface Item {
	id: string;
	type: "para" | "heading" | "caption" | "note" | "frag";
	text: string;
	page: number;
	pages?: number[];
	level?: number;
	notes?: string[];
	ref?: string;
	table?: boolean;
	figure?: boolean;
	equation?: boolean;
	embedded_image?: boolean;
	bbox?: number[];
	sid?: string;
	tex?: string;
}

export interface ParagraphsDoc {
	items: Item[];
	page_count: number;
	title_guess?: string;
	crops?: Record<string, string>;
	doc_rev?: string;
	source_path?: string;
	page_labels?: Record<string, string>;
}

export type Entry = {
	tier: "close" | "skim" | "skip";
	role: string;
	read?: string;
	note?: string;
	why?: string;
	els?: Record<string, unknown>[];
	verify_failed?: string[];
};

export interface Guide {
	meta: Record<string, unknown>;
	questions: { q: string; a: string; p: string[] }[];
	thesis: string;
	overview: string;
	parts: Record<string, unknown>[];
}

export const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
export const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 1));

export class Work {
	constructor(public dir: string) {}
	path(...p: string[]) {
		return join(this.dir, ...p);
	}
	paragraphs(): ParagraphsDoc {
		return readJson(this.path("paragraphs.json"));
	}
	hasGuide() {
		return existsSync(this.path("guide.json"));
	}
	guide(): Guide {
		return readJson(this.path("guide.json"));
	}
	saveGuide(g: Guide) {
		writeJson(this.path("guide.json"), g);
	}
	paraFiles() {
		return readdirSync(this.dir)
			.filter((f) => /^paras_\d+\.json$/.test(f))
			.sort();
	}
	entries(): Record<string, Entry> {
		const out: Record<string, Entry> = {};
		for (const f of this.paraFiles()) Object.assign(out, readJson<{ paras: Record<string, Entry> }>(this.path(f)).paras);
		return out;
	}
	/** Rewrite the paras files: one file per part (keeps the files small and the merge order stable). */
	saveEntries(all: Record<string, Entry>, parts?: { range: string }[]) {
		for (const f of this.paraFiles()) unlinkSync(this.path(f));
		const ids = Object.keys(all);
		const groups: string[][] = [];
		if (parts?.length) {
			const pnum = (id: string) => (/^P(\d+)$/.exec(id) ? Number(id.slice(1)) : null);
			const ranges = parts.map((p) => rangeOf(p.range));
			const byPart: string[][] = ranges.map(() => []);
			const rest: string[] = [];
			for (const id of ids) {
				const n = pnum(id);
				const k = n == null ? -1 : ranges.findIndex(([a, b]) => n >= a && n <= b);
				(k >= 0 ? byPart[k] : rest).push(id);
			}
			groups.push(...byPart.filter((g) => g.length));
			if (rest.length) groups.push(rest);
		} else {
			for (let i = 0; i < ids.length; i += 40) groups.push(ids.slice(i, i + 40));
		}
		groups.forEach((g, i) => {
			writeJson(this.path(`paras_${String(i + 1).padStart(2, "0")}.json`), { paras: Object.fromEntries(g.map((id) => [id, all[id]])) });
		});
	}
}

export function rangeOf(r: string): [number, number] {
	const m = /^\s*P(\d+)\s*(?:[-–]\s*P?(\d+))?\s*$/i.exec(String(r));
	if (!m) return [0, -1];
	return [Number(m[1]), Number(m[2] ?? m[1])];
}

export function idsInRange(r: string) {
	const [a, b] = rangeOf(r);
	const out: string[] = [];
	for (let i = a; i <= b; i++) out.push(`P${i}`);
	return out;
}

/** The paper as the model reads it: every item with id, type and page, in reading order. */
export function docDump(doc: ParagraphsDoc) {
	const lines = doc.items.map((it) => {
		const tag = it.type === "heading" ? `heading L${it.level ?? 1}` : it.type === "frag" ? `frag${it.table ? " table" : it.equation ? " equation" : ""}` : it.type;
		const notes = it.notes?.length ? ` notes:${it.notes.join(",")}` : "";
		return `[${it.id} | ${tag} | p.${it.page}${notes}] ${it.text}`;
	});
	return `<paper title_guess="${doc.title_guess ?? ""}" pages="${doc.page_count}">\n${lines.join("\n")}\n</paper>`;
}

export function metaFromBrief(b: Brief, g: { title?: string; author?: string; source?: string; genre?: string }) {
	return {
		title: g.title || "Untitled",
		author: g.author || "",
		source: g.source || "",
		genre: g.genre || "",
		notes_lang: [b.notesLang],
		density: b.density,
		language: "en",
		purpose: b.purpose,
		familiarity: b.familiarity || "not given",
	};
}

/** Drop empty strings/arrays the model emits for optional fields: check.py treats `tex: ""` as an error. */
export function clean<T>(v: T): T {
	if (Array.isArray(v)) return v.map(clean).filter((x) => x !== undefined) as T;
	if (v && typeof v === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, x] of Object.entries(v)) {
			const c = clean(x);
			if (c === undefined || c === null) continue;
			if (typeof c === "string" && !c.trim()) continue;
			if (Array.isArray(c) && !c.length && k !== "els" && k !== "questions" && k !== "p") continue;
			out[k] = c;
		}
		return out as T;
	}
	return v;
}

export function toEntry(e: Record<string, unknown>): [string, Entry] {
	const { id, ...rest } = clean(e) as Record<string, unknown> & { id: string };
	const entry = rest as unknown as Entry;
	if (!entry.els) entry.els = [];
	if (entry.tier !== "close") delete entry.read;
	if (entry.tier !== "skip") delete entry.why;
	return [String(id), entry];
}
