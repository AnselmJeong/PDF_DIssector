// Re-attach user annotations to the current segmentation (plan section 7.2):
// 1. sid + position match, 2. TextQuote inside the sid's item, 3. TextQuote anywhere (prefix/suffix break ties),
// 4. otherwise orphaned (kept in the "lost notes" list).
import type { Selector, StoredAnnotation } from "../../shared/types";

export interface AnchorItem {
	id: string;
	sid?: string;
	text: string;
}

export type Resolved = { pid: string; sid: string | null; start: number; end: number } | null;

const sel = <T extends Selector["type"]>(a: { target: { selector: Selector[] } }, t: T) =>
	a.target.selector.find((s) => s.type === t) as Extract<Selector, { type: T }> | undefined;

function allIndexes(hay: string, needle: string) {
	const out: number[] = [];
	if (!needle) return out;
	let i = hay.indexOf(needle);
	while (i >= 0) {
		out.push(i);
		i = hay.indexOf(needle, i + 1);
	}
	return out;
}

function score(text: string, at: number, exact: string, prefix: string, suffix: string) {
	let s = 0;
	const before = text.slice(Math.max(0, at - prefix.length), at);
	const after = text.slice(at + exact.length, at + exact.length + suffix.length);
	for (let k = 1; k <= prefix.length && before.endsWith(prefix.slice(-k)); k++) s++;
	for (let k = 1; k <= suffix.length && after.startsWith(suffix.slice(0, k)); k++) s++;
	return s;
}

export function resolveAnnotation(a: Pick<StoredAnnotation, "target" | "sid">, items: AnchorItem[]): Resolved {
	const quote = sel(a, "TextQuoteSelector");
	const pos = sel(a, "TextPositionSelector");
	const frag = sel(a, "FragmentSelector");
	const sid = a.sid ?? frag?.value.replace(/^sid=/, "") ?? null;
	const exact = quote?.exact ?? "";
	const home = sid ? items.find((i) => i.sid === sid) : undefined;
	if (home) {
		if (pos && home.text.slice(pos.start, pos.end) === exact && exact) return { pid: home.id, sid: home.sid ?? null, start: pos.start, end: pos.end };
		const hits = allIndexes(home.text, exact);
		if (hits.length) {
			const best = hits.sort((x, y) => score(home.text, y, exact, quote!.prefix, quote!.suffix) - score(home.text, x, exact, quote!.prefix, quote!.suffix))[0];
			return { pid: home.id, sid: home.sid ?? null, start: best, end: best + exact.length };
		}
	}
	if (!exact) return null;
	let best: { it: AnchorItem; at: number; s: number } | null = null;
	for (const it of items) {
		for (const at of allIndexes(it.text, exact)) {
			const s = score(it.text, at, exact, quote!.prefix, quote!.suffix);
			if (!best || s > best.s) best = { it, at, s };
		}
	}
	return best ? { pid: best.it.id, sid: best.it.sid ?? null, start: best.at, end: best.at + exact.length } : null;
}
