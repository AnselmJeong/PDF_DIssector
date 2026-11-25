// Types shared by the main process (Bun) and the webview (React).
// The guide data contract (paragraphs.json, guide.json, paras_NN.json) is owned by the Python engine;
// ReaderData mirrors what `pdfx build_data` returns.

export type Tier = "close" | "skim" | "skip";

export const STAGES = [
	"IMPORTED",
	"BRIEFED",
	"SEGMENTED",
	"INSPECTED",
	"FIXED",
	"OPEN_FETCHED",
	"UNDERSTOOD",
	"GUIDE_DRAFTED",
	"DEEP_DIVED",
	"CHECKED",
	"REVIEWED",
	"FINAL",
	"RENDERED",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
	IMPORTED: "가져옴",
	BRIEFED: "브리핑",
	SEGMENTED: "추출(문단 분할)",
	INSPECTED: "페이지 시각 검수",
	FIXED: "보정 적용",
	OPEN_FETCHED: "공개 원문(PMC) 연동",
	UNDERSTOOD: "논문 이해(구조·논지)",
	GUIDE_DRAFTED: "문단 해설 작성",
	DEEP_DIVED: "수식·그림 해설",
	CHECKED: "검증 루프",
	REVIEWED: "2차 검토",
	FINAL: "검토 반영",
	RENDERED: "Reader 데이터 생성",
};

export type Purpose = "whole argument" | "core claims only" | "method and design only" | "evidence to cite" | "exam or journal club";
export type Density = "low" | "medium" | "high";

export interface Brief {
	purpose: Purpose;
	familiarity: string;
	density: Density;
	questions: string[];
	notesLang: "ko" | "en";
	genre?: string | null;
	pages?: string | null;
}

export type DocStatus = "imported" | "queued" | "processing" | "awaiting_fixes" | "needs_review" | "done" | "failed" | "canceled";

export interface DocSummary {
	id: string;
	title: string;
	authors: string | null;
	journal: string | null;
	year: string | null;
	doi: string | null;
	genre: string | null;
	status: DocStatus;
	stage: Stage;
	pageCount: number | null;
	closeShare: number | null;
	costUsd: number;
	tokensIn: number;
	tokensOut: number;
	createdAt: string;
	updatedAt: string;
	error: string | null;
	fileName: string;
	/** While processing: overall progress 0..1 and the latest step message. */
	progress?: number | null;
	progressMsg?: string | null;
	/** While queued: 1-based place in the waiting line. */
	queuePosition?: number | null;
}

export interface DocFilter {
	status?: DocStatus[];
	genre?: string[];
}

export interface StageRecord {
	stage: Stage;
	status: "pending" | "running" | "done" | "failed" | "skipped";
	startedAt: string | null;
	finishedAt: string | null;
	msg: string | null;
	detail: string | null; // self-check line, check output, findings...
	tokensIn: number;
	tokensOut: number;
	costUsd: number;
	attempts: number;
}

export interface JobState {
	docId: string;
	jobId: string | null;
	running: boolean;
	queuePosition: number | null; // 1-based place in the waiting line while queued
	stages: StageRecord[];
	overlays: { page: number; path: string }[];
	fixes: FixOp[];
	findings: Finding[];
}

export interface FixOp {
	op: "type" | "join" | "split" | "move" | "region";
	why: string;
	ids?: string[];
	id?: string;
	to?: string;
	level?: number;
	at?: string;
	after?: string | null;
	page?: number;
	bbox?: number[];
	replaces?: string[];
	enabled?: boolean;
}

export interface Finding {
	where: string;
	severity: "misleading" | "minor";
	problem: string;
	fix: string;
	status?: "open" | "fixed" | "confirmed";
}

export interface Settings {
	llmBackend: "subscription" | "api" | "ollama"; // subscription = Claude Code CLI login; api = Anthropic API key; ollama = OpenAI-compatible Ollama API
	ollama: { baseUrl: string; model: string }; // one model serves every role on the ollama backend
	claudePath: string | null;
	models: { writer: string; reviewer: string; helper: string };
	defaultDensity: Density;
	notesLang: "ko" | "en";
	costCapUsd: number;
	fastMode: boolean; // second read on the helper model, skip the equation/figure deep-dive
	threeTierView: boolean;
	reviewLayout: boolean; // pause after the page inspection so the user can pick the layout fixes; off = apply the AI fixes and go on
	concurrency: number;
	parallelDocs: number; // how many papers are processed at the same time; the rest wait in a queue
	acceptedDataNotice: boolean;
	pythonPath: string | null;
}

export interface UserRule {
	id: string;
	scope: "method" | "genre" | "style";
	text: string;
	createdAt: string;
}

// ---- Reader data (pdfx build_data) ----
export type LangText = Record<string, string>; // {"ko": "..."}

export interface ReaderItem {
	type: "para" | "heading" | "caption" | "note" | "frag";
	text: string;
	page: number;
	pages?: number[];
	level?: number;
	notes?: string[];
	num?: string;
	ref?: string;
	table?: boolean;
	equation?: boolean;
	has_math?: boolean;
	tex?: string;
	bbox?: number[];
	sid?: string;
}

export interface ReaderElement {
	t: string;
	a?: string;
	s?: LangText;
	x?: LangText;
	term?: LangText;
	tex?: string;
	why?: LangText;
	syms?: { s: string; m: LangText }[];
	hl?: [number, number];
	steps?: { part: string; x: LangText }[];
	intuition?: LangText;
	units?: LangText;
	clinical?: LangText;
	illustrative?: LangText;
	cap?: string;
	what?: LangText;
	panels?: { label: string; x: LangText }[];
	axes?: LangText;
	look_for?: LangText[];
	takeaway?: LangText;
	caveat?: LangText;
	approx?: boolean;
}

export interface ReaderEntry {
	tier: Tier;
	role: LangText;
	note?: LangText;
	read?: LangText;
	why?: LangText;
	ref?: string;
	els: ReaderElement[];
	verify_failed?: string[];
}

export interface ReaderPart {
	id: string;
	range: string;
	claim_p?: string;
	skip?: boolean;
	title?: LangText;
	role?: LangText;
	claim?: LangText;
	recall?: { q: LangText; a: LangText }[];
}

export interface ReaderData {
	v: number;
	langs: string[];
	default_lang: string;
	doc: { source: string; mode: string; page_count: number; title_guess: string };
	meta: Record<string, unknown> & { title?: LangText | string; author?: LangText | string; source?: LangText | string; genre?: LangText };
	thesis: LangText;
	overview: LangText;
	parts: ReaderPart[];
	order: string[];
	items: Record<string, ReaderItem>;
	page_labels: Record<string, string>;
	guide: Record<string, ReaderEntry>;
	figs: Record<string, { key: [string, number] | null; host: string | null; page: number }>;
	table_pages: Record<string, number>;
	open: {
		assets: Record<string, { caption?: string; img?: string; rows?: string[][] }>;
		equations: { tex?: string }[];
		text_check: Record<string, string[]>;
		source?: string;
	};
	types: Record<string, { en: string; zh: string; ko?: string; level: number; family: string; desc: string }>;
	logic: {
		rels: Record<string, { to: string; type: string; label?: LangText }[]>;
		flows: Record<string, { p: string; rel?: string; x: LangText }[]>;
	};
	crops: Record<string, string>; // id -> absolute path (main turns it into a URL)
	frag_crops: Record<string, string[]>;
	has_tex: boolean;
	glossary: { term: string; x: LangText; src: string }[];
	questions: { q: LangText; a: LangText; p: string[] }[];
	doc_rev?: string;
	source_path?: string;
	check: { errors: string[]; warns: string[]; stats: Record<string, unknown> };
}

export interface ReaderPayload {
	data: ReaderData;
	fileBase: string; // URL prefix for files of this doc (crops, pdf)
	pdfUrl: string;
	tierOverrides: Record<string, Tier>; // sid -> tier
	annotations: StoredAnnotation[];
}

// ---- Annotations (W3C Web Annotation, simplified) ----
export type Selector =
	| { type: "TextQuoteSelector"; exact: string; prefix: string; suffix: string }
	| { type: "TextPositionSelector"; start: number; end: number }
	| { type: "FragmentSelector"; value: string }
	| { type: "PdfBoxSelector"; page: number; bbox: number[] };

export interface WebAnnotation {
	id?: string;
	type: "Annotation";
	motivation: "highlighting" | "commenting" | "questioning";
	body: { type: "TextualBody"; value: string; format: "text/markdown" }[];
	target: { source: string; selector: Selector[] };
	docRev?: string;
	color?: string;
}

export interface StoredAnnotation extends WebAnnotation {
	id: string;
	sid: string | null;
	orphaned: boolean;
	// resolved position for the current doc_rev
	resolved?: { pid: string; start: number; end: number } | null;
	createdAt: string;
	updatedAt: string;
}

export type RegenTarget = { kind: "para"; pid: string } | { kind: "formula"; pid: string; index: number } | { kind: "figure"; pid: string; index: number };
export type RegenStyle = "simpler" | "deeper" | "redo";

export interface ProbeResult {
	pages: number;
	scanned: boolean;
	image_only_pages: number;
	mineru: string | null;
	meta: Record<string, string>;
}

// ---- RPC ----
export type BunRequests = {
	serverInfo: { params: Record<string, never>; response: { origin: string; token: string } };
	pickPdfs: { params: Record<string, never>; response: { paths: string[] } };
	importPdfs: { params: { paths: string[] }; response: { docIds: string[] } };
	probe: { params: { docId: string }; response: ProbeResult };
	setBrief: { params: { docId: string; brief: Brief }; response: { ok: true } };
	getBrief: { params: { docId: string }; response: Brief | null };
	startJob: { params: { docId: string; from?: Stage }; response: { jobId: string } };
	cancelJob: { params: { docId: string }; response: { ok: true } };
	getJob: { params: { docId: string }; response: JobState };
	setFixEnabled: { params: { docId: string; index: number; enabled: boolean }; response: { ok: true } };
	reapplyFixes: { params: { docId: string }; response: { ok: true } };
	listDocs: { params: { query?: string; filters?: DocFilter }; response: DocSummary[] };
	deleteDoc: { params: { docId: string }; response: { ok: true } };
	getReader: { params: { docId: string }; response: ReaderPayload };
	setTier: { params: { docId: string; pid: string; tier: Tier }; response: ReaderEntry };
	regenerate: { params: { docId: string; target: RegenTarget; style: RegenStyle }; response: ReaderEntry };
	askAbout: { params: { docId: string; pid: string | null; question: string; history: { role: "user" | "assistant"; text: string }[] }; response: { streamId: string } };
	saveAnnotation: { params: { docId: string; anno: WebAnnotation }; response: StoredAnnotation };
	deleteAnnotation: { params: { docId: string; id: string }; response: { ok: true } };
	exportHtml: { params: { docId: string; dir?: string }; response: { path: string } };
	showInFolder: { params: { path: string }; response: { ok: true } };
	getSettings: { params: Record<string, never>; response: Settings & { hasApiKey: boolean; hasOllamaKey: boolean; engineOk: boolean; engineInfo: string; claudeOk: boolean; claudeInfo: string } };
	setSettings: { params: { settings: Partial<Settings> }; response: { ok: true } };
	setApiKey: { params: { key: string | null }; response: { ok: true; hasApiKey: boolean } };
	setOllamaKey: { params: { key: string | null }; response: { ok: true; hasOllamaKey: boolean } };
	listRules: { params: Record<string, never>; response: UserRule[] };
	addRule: { params: { scope: UserRule["scope"]; text: string }; response: UserRule };
	deleteRule: { params: { id: string }; response: { ok: true } };
	rateExplanation: { params: { docId: string; pid: string; stars: number; comment?: string }; response: { ok: true } };
}

export type WebviewMessages = {
	jobProgress: { docId: string; stage: Stage; status: StageRecord["status"]; pct: number; msg: string; tokens: number; costUsd: number; progress?: number };
	jobDone: { docId: string; ok: boolean; error?: string; paused?: boolean };
	chatDelta: { streamId: string; text: string; done: boolean; error?: string };
	docsChanged: Record<string, never>;
}
