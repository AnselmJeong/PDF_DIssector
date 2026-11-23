// JSON Schemas for structured outputs (output_config.format). Every object has additionalProperties: false.
// The schemas follow references/schema.md (guide.json, paras_NN.json) plus the PDF Dissector fields.

const obj = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
});
const str = { type: "string" };
const strArr = { type: "array", items: str };
const nullableStr = { type: ["string", "null"] };

export const FIXES_SCHEMA = obj({
	fixes: {
		type: "array",
		items: obj(
			{
				op: { type: "string", enum: ["type", "join", "split", "move", "region"] },
				why: str,
				ids: strArr,
				id: str,
				to: { type: "string", enum: ["para", "heading", "caption", "note", "frag", "table", "figure", "display"] },
				level: { type: "integer" },
				at: str,
				after: nullableStr,
				page: { type: "integer" },
				bbox: { type: "array", items: { type: "number" } },
				replaces: strArr,
			},
			["op", "why"],
		),
	},
	summary: str,
});

const rel = obj({ to: str, type: { type: "string", enum: ["supports", "explains", "qualifies", "extends", "frames", "challenges", "answers", "concludes"] }, label: str }, ["to", "type"]);
const flowStep = obj(
	{ p: str, rel: { type: "string", enum: ["supports", "explains", "qualifies", "extends", "frames", "challenges", "answers", "concludes", "rules out", "implies", "names", "raises"] }, x: str },
	["p", "x"],
);
const qa = obj({ q: str, a: str });

export const PART_SCHEMA = obj(
	{
		id: str,
		title: str,
		range: str,
		role: str,
		skip: { type: "boolean" },
		claim: str,
		claim_p: str,
		rel: { type: "array", items: rel },
		flow: { type: "array", items: flowStep },
		recall: { type: "array", items: qa },
	},
	["id", "title", "range", "role"],
);

export const UNDERSTAND_SCHEMA = obj({
	genre: str,
	design_checkpoints: strArr,
	title: str,
	author: str,
	source: str,
	thesis: str,
	overview: str,
	parts: { type: "array", items: PART_SCHEMA },
	questions: { type: "array", items: obj({ q: str, a: str, p: strArr }) },
	close_candidates: strArr,
});

const sym = obj({ s: str, m: str });
export const ELEMENT_SCHEMA = obj(
	{
		t: str,
		a: str,
		s: str,
		x: str,
		term: str,
		tex: str,
		syms: { type: "array", items: sym },
		why: str,
		steps: { type: "array", items: obj({ part: str, x: str }) },
		intuition: str,
		units: str,
		clinical: str,
		illustrative: str,
	},
	["t"],
);

export const ENTRY_SCHEMA = obj(
	{
		id: str,
		tier: { type: "string", enum: ["close", "skim", "skip"] },
		role: str,
		read: str,
		note: str,
		why: str,
		els: { type: "array", items: ELEMENT_SCHEMA },
	},
	["id", "tier", "role", "note", "els"],
);

export const ENTRIES_SCHEMA = obj({ paras: { type: "array", items: ENTRY_SCHEMA } });

export const FORMULA_SCHEMA = obj(
	{
		tex: str,
		syms: { type: "array", items: sym },
		x: str,
		why: str,
		steps: { type: "array", items: obj({ part: str, x: str }) },
		intuition: str,
		units: str,
		clinical: str,
		illustrative: str,
	},
	["tex", "syms", "x", "steps", "intuition"],
);

export const FIGX_SCHEMA = obj(
	{
		what: str,
		panels: { type: "array", items: obj({ label: str, x: str }) },
		axes: str,
		look_for: strArr,
		takeaway: str,
		caveat: str,
		approx: { type: "boolean" },
		s: str,
	},
	["what", "panels", "look_for", "takeaway", "approx"],
);

export const GUIDE_PATCH_SCHEMA = obj(
	{
		thesis: str,
		overview: str,
		parts: { type: "array", items: PART_SCHEMA },
		questions: { type: "array", items: obj({ q: str, a: str, p: strArr }) },
		paras: { type: "array", items: ENTRY_SCHEMA },
		notes: str,
	},
	["paras", "notes"],
);

export const REVIEW_SCHEMA = obj({
	findings: {
		type: "array",
		items: obj({ where: str, severity: { type: "string", enum: ["misleading", "minor"] }, problem: str, fix: str }),
	},
	summary: str,
});
