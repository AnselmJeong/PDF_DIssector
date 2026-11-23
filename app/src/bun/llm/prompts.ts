// Prompt assets. The system prompts embed the upstream method (method.md, elements.md, schema.md, genres.md)
// plus the Korean/biomedical addendum; they are identical for every call of a stage so prompt caching works.
import type { Brief, UserRule } from "../../shared/types";

export type References = Record<string, string>;

const PURPOSE_KO: Record<string, string> = {
	"whole argument": "전체 논증",
	"core claims only": "핵심 주장만",
	"method and design only": "방법론·연구 설계",
	"evidence to cite": "인용할 근거",
	"exam or journal club": "시험·저널클럽 준비",
};

export function writerSystem(refs: References, rules: UserRule[]) {
	const userRules = rules.length
		? `\n\n# The reader's own standing rules (apply them; they win over the defaults)\n${rules.map((r) => `- [${r.scope}] ${r.text}`).join("\n")}`
		: "";
	return `You write reading guides for biomedical research papers inside the PDF Dissector app. The reader reads the original English paper; your guide tells them what to read closely, what to skim, and explains in friendly Korean what each part says, with special care for formulas, figures and tables.

You never translate or edit the original text. Anchors ("a") are copied verbatim from the paragraph. Every number you write must appear in the source text (except a formula's "illustrative" example). Do not grade the authors or add information the text does not contain. Output only the JSON the schema asks for.

The method you follow is below, exactly as the reading-guide tool defines it, followed by the PDF Dissector addendum for Korean notes and biomedical papers.

<method>
${refs.method ?? ""}
</method>

<elements>
${refs.elements ?? ""}
</elements>

<schema>
${refs.schema ?? ""}
</schema>

<genres>
${refs.genres ?? ""}
</genres>

<addendum>
${refs.ko_biomed ?? ""}
</addendum>${userRules}`;
}

export function reviewerSystem(refs: References) {
	return `You are the second reader of a reading guide, as described below. You did not write the guide. Compare each guide field with the paragraphs it cites and report what would leave a reader believing something the text does not say. The guide's notes are in Korean; the text is English. Output only the JSON the schema asks for.

<review>
${refs.review ?? ""}
</review>

<method_section_12_and_numbers>
${(refs.method ?? "").split(/\n## /).filter((s) => /^(6 |12 )/.test(s)).map((s) => "## " + s).join("\n")}
</method_section_12_and_numbers>

<addendum>
${refs.ko_biomed ?? ""}
</addendum>`;
}

export const INSPECT_SYSTEM = `You inspect the automatic segmentation of a PDF page by page, like step 1b of the reading-guide workflow, and write fixes.json operations.

Each page image shows coloured boxes with item ids: para (body paragraphs), heading (with level), caption, note (footnote), frag (hidden fragments: equation lines, table cells, page furniture). A 0.1 grid gives normalised coordinates.

Operations (every op needs "why"):
- {"op":"type","ids":[...],"to":"para|heading|caption|note|frag","level":n} retype items (title level is 0).
- {"op":"join","ids":[...]} join pieces of one paragraph that were cut (same type, adjacent in reading order).
- {"op":"split","id":"P9","at":"verbatim text where the second piece starts"}.
- {"op":"move","id":"P12","after":"P10"} fix reading order.
- {"op":"region","page":n,"bbox":[x0,y0,x1,y1],"to":"table|figure|display|para|heading|caption|note","after":"P3" or null,"replaces":[...]} cover a whole table/figure/display that has no crop or a partial one.

Check: front matter (journal masthead, licence, contact lines, dates -> frag; title heading level 0; abstract kept as para), headings and levels, paragraphs cut in two across columns or pages, running heads inside paragraphs, two columns merged into one paragraph, references among paragraphs, figure/table captions typed as para, chart labels or table cells typed as para (-> frag). Lists and definitions stay para. Use the ids exactly as drawn. Propose only fixes you can see are needed; an empty list is a fine answer. Output only the JSON the schema asks for.`;

export function briefText(b: Brief, title: string) {
	return `Reader's brief (step 0 answers):
- Notes language: ${b.notesLang === "ko" ? "Korean (ko)" : "English (en)"}
- Reading for: ${b.purpose} (${PURPOSE_KO[b.purpose] ?? b.purpose})
- Familiarity: ${b.familiarity || "not given"}
- Density: ${b.density} (close reads at most ${b.density === "low" ? "15" : b.density === "high" ? "40" : "25"}% of paragraphs)
- Reader's questions: ${b.questions.length ? b.questions.map((q, i) => `\n  ${i + 1}. ${q}`).join("") : "none"}
- Genre given by the reader: ${b.genre || "decide yourself"}
- Document: ${title}`;
}

export function understandPrompt(brief: string, paraCount: number) {
	return `${brief}

Read the whole paper above (all ${paraCount} paragraphs P1-P${paraCount}, with headings, captions, notes and fragments for context). Then produce the skeleton of guide.json:
- genre: one of the genres in genres.md, biomedical ones preferred (e.g. "Randomised controlled trial (CONSORT)"); add "(approx.)" when unsure. design_checkpoints: the guideline checkpoints this paper's close reads must cover, in Korean.
- title, author (short: "Kim et al."), source (journal, year) from the paper.
- thesis (Korean, under 140 characters) and overview (Korean, 2 to 4 sentences: question, route, conclusion).
- parts: cover P1-P${paraCount} in order with no gap or overlap ("P1-P5", "P6"...). Each part: id (S0, S1, ...), title, role, and unless it is housekeeping ("skip": true), claim + claim_p inside the part, rel (first relation leads to "T" without cycles), 3-6 flow steps naming paragraphs inside the part, 2-3 recall questions answerable from the part. Front matter or reference-like parts can be skip.
- questions: answer each of the reader's questions from the text, with the paragraph ids that answer it (empty list if the reader has none).
- close_candidates: the paragraph ids you plan to read closely, within the density cap and following the reader's purpose and the genre checkpoints.
All prose in Korean; ids and relation types as in schema.md.`;
}

export function annotatePrompt(brief: string, skeleton: string, ids: string[], partTitle: string) {
	return `${brief}

The guide skeleton (parts, claims, close-read plan) is:
${skeleton}

Write the paragraph entries for part "${partTitle}": exactly these ids, in order: ${ids.join(", ")}.
For each entry: tier (close/skim/skip), role (Korean, under 30 characters, what this paragraph does), and
- close: read (what to watch for while reading, no spoilers), note (after-reading summary that restates the content), els (2-4 anchored elements; anchors copied verbatim from that paragraph; formulas the argument relies on get a formula element with tex, syms, x and, when the paragraph introduces a displayed equation, steps and intuition).
- skim: note that restates the content with its numbers, definitions and conclusion, so the reader can move on without the original; els optional.
- skip: note (one line) and why.
Footnote ids (N...) are optional; include one only when it matters. Use the elements of elements.md, including the biomedical ones. All prose in Korean. Return {"paras": [...]} with one object per id.`;
}

export function formulaPrompt(brief: string, pid: string, paraText: string, current: string, hasImage: boolean) {
	return `${brief}

Deep-dive one formula of paragraph ${pid}. Paragraph text:
"""${paraText}"""
Current formula element: ${current}
${hasImage ? "The attached image is the PDF crop of the displayed equation: transcribe tex from it and check symbols against it." : "No crop is available: transcribe from the text."}
Return the formula fields: tex (LaTeX, no $), syms (every symbol with its meaning in Korean), x (what the equation says, Korean), why (its job in the argument), steps (term by term), intuition, units, clinical (how it is used to read the results), and optionally illustrative (a small made-up worked example, clearly hypothetical). Numbers other than in illustrative must come from the text.`;
}

export function figurePrompt(brief: string, capId: string, caption: string, citing: string, hasImage: boolean, rows: string | null) {
	return `${brief}

Write a figure/table walkthrough (figx) for caption ${capId}:
"""${caption}"""
Paragraphs that cite it:
${citing}
${rows ? `Table rows from the open (PMC) version:\n${rows}\n` : ""}${hasImage ? "The attached image is the PDF page (or crop) that holds the figure/table." : "No image is available; work from the caption and the citing paragraphs."}
Fields (Korean): what (the question it answers), panels (only labels that appear in the caption: A, B, ...; empty list if none), axes, look_for (2-4 things to look at), takeaway (no stronger than the authors), caveat, approx (true if you state any value read off the graph, written with "약"), s (a short label, under 20 characters). Numbers must come from the caption, the citing paragraphs or the table text unless marked approximate.`;
}

export function fixPrompt(brief: string, errors: string[], warns: string[], current: string) {
	return `${brief}

check.py reported problems with the guide. Fix every error and every warning you agree with, changing as little as possible. When an anchor is not found, copy from the closest sentence the checker prints. When a number is not in the source, use the author's figure or wording, or drop the number.

Errors:
${errors.map((e) => "- " + e).join("\n") || "(none)"}
Warnings:
${warns.slice(0, 40).map((w) => "- " + w).join("\n") || "(none)"}

Current data of the affected fields:
${current}

Return: paras (complete replacement entries for every paragraph id you change), and only if guide-level fields need changes: thesis, overview, parts (the complete parts list), questions. notes: one line on what you changed.`;
}

export function reviewPrompt(guide: string) {
	return `The guide to check (guide.json merged with all paragraph entries):
${guide}

Check it against the paper above, in the order the brief gives (short fields first, then notes that report results, then formula and figure explanations). Report findings with "where" naming the field as in the brief (e.g. "S4 claim", "P23 note", "P12 element 2 takeaway").`;
}

export function findingFixPrompt(brief: string, findings: string, current: string) {
	return `${brief}

A second reader who did not write the guide reported these findings:
${findings}

Current data of the affected fields:
${current}

Fix every misleading finding and every minor finding with a clear fix. When a finding is wrong (the reader missed a sentence), leave the field. Return paras (complete replacement entries for changed paragraphs) and, if needed, thesis/overview/parts/questions. notes: one line per finding saying fixed or why not.`;
}

export function regenPrompt(brief: string, pid: string, style: string, current: string, extra: string) {
	const how =
		style === "simpler"
			? "Rewrite it more simply for a reader new to the field: shorter sentences, everyday words, one concrete intuition. Keep every fact and hedge."
			: style === "deeper"
				? "Rewrite it in more depth for an expert reader: add the reasoning steps, assumptions and caveats the text gives. Keep it faithful."
				: "Write it again from scratch, following the method.";
	return `${brief}

Regenerate the guide entry for paragraph ${pid}. ${how}
${extra}
Current entry: ${current}
Return {"paras": [one entry for ${pid}]}.`;
}

export function chatSystem(refs: References) {
	return `You help a reader understand a biomedical paper they are reading in PDF Dissector. Answer in Korean, friendly and precise.
Rules (from the reading-guide method, "While the user reads"):
- When the question is about a paragraph, point to the original first: quote the relevant words in English (short), then explain.
- Keep what the authors say apart from your own explanation: mark your explanation as such ("설명:"), and never present it as the paper's claim.
- Every number you give must come from the paper; if you use a made-up example, say it is hypothetical.
- If the paper does not answer the question, say so.

<addendum>
${refs.ko_biomed ?? ""}
</addendum>`;
}
