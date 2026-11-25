import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
	Brief,
	DocFilter,
	DocStatus,
	DocSummary,
	Settings,
	Stage,
	StageRecord,
	StoredAnnotation,
	Tier,
	UserRule,
	WebAnnotation,
} from "../../shared/types";

const MIGRATIONS: string[] = [
	`CREATE TABLE documents(
		id TEXT PRIMARY KEY, title TEXT, authors TEXT, journal TEXT, year TEXT, doi TEXT, pmid TEXT, pmcid TEXT, genre TEXT,
		status TEXT NOT NULL DEFAULT 'imported', stage TEXT NOT NULL DEFAULT 'IMPORTED', doc_rev TEXT, page_count INTEGER,
		close_share REAL, file_name TEXT, pdf_path TEXT, work_dir TEXT, error TEXT,
		created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
		tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0);
	CREATE TABLE briefs(doc_id TEXT PRIMARY KEY, purpose TEXT, familiarity TEXT, density TEXT, notes_lang TEXT, questions_json TEXT, genre TEXT, pages TEXT);
	CREATE TABLE jobs(id TEXT PRIMARY KEY, doc_id TEXT, stage TEXT, status TEXT, started_at TEXT, finished_at TEXT, error TEXT, attempts INTEGER DEFAULT 0);
	CREATE TABLE stages(doc_id TEXT, stage TEXT, status TEXT, started_at TEXT, finished_at TEXT, msg TEXT, detail TEXT,
		tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0, attempts INTEGER DEFAULT 0, PRIMARY KEY(doc_id, stage));
	CREATE TABLE llm_calls(id TEXT PRIMARY KEY, job_id TEXT, doc_id TEXT, stage TEXT, model TEXT, tokens_in INTEGER, tokens_out INTEGER,
		cache_read INTEGER, cache_write INTEGER, cost_usd REAL, log_path TEXT, created_at TEXT);
	CREATE TABLE tier_overrides(doc_id TEXT, sid TEXT, tier TEXT, created_at TEXT, PRIMARY KEY(doc_id, sid));
	CREATE TABLE annotations(id TEXT PRIMARY KEY, doc_id TEXT, sid TEXT, body_json TEXT, target_json TEXT, motivation TEXT, color TEXT,
		doc_rev TEXT, created_at TEXT, updated_at TEXT, orphaned INTEGER DEFAULT 0);
	CREATE TABLE user_rules(id TEXT PRIMARY KEY, scope TEXT, text TEXT, created_at TEXT);
	CREATE TABLE ratings(id TEXT PRIMARY KEY, doc_id TEXT, pid TEXT, stars INTEGER, comment TEXT, created_at TEXT);
	CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);`,
];

export const DEFAULT_SETTINGS: Settings = {
	llmBackend: "subscription",
	claudePath: null,
	models: { writer: "claude-opus-5-5", reviewer: "claude-sonnet-5-5", helper: "claude-haiku-5-5" },
	defaultDensity: "medium",
	notesLang: "ko",
	costCapUsd: 5,
	fastMode: false,
	threeTierView: false,
	reviewLayout: false,
	concurrency: 3,
	parallelDocs: 2,
	acceptedDataNotice: false,
	pythonPath: null,
};

const now = () => new Date().toISOString();
export const newId = (prefix = "") => prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

type Row = Record<string, unknown>;

export class Library {
	db: Database;

	constructor(path: string) {
		mkdirSync(dirname(path), { recursive: true });
		this.db = new Database(path, { create: true });
		this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
		this.migrate();
	}

	private migrate() {
		this.db.exec("CREATE TABLE IF NOT EXISTS schema_version(v INTEGER)");
		const row = this.db.query("SELECT v FROM schema_version").get() as { v: number } | null;
		let v = row?.v ?? 0;
		if (!row) this.db.exec("INSERT INTO schema_version(v) VALUES (0)");
		for (; v < MIGRATIONS.length; v++) {
			this.db.transaction(() => {
				this.db.exec(MIGRATIONS[v]);
				this.db.query("UPDATE schema_version SET v = ?").run(v + 1);
			})();
		}
	}

	// ---- documents ----
	addDocument(d: { id: string; title: string; fileName: string; pdfPath: string; workDir: string }) {
		const t = now();
		this.db
			.query(
				`INSERT INTO documents(id, title, file_name, pdf_path, work_dir, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
			)
			.run(d.id, d.title, d.fileName, d.pdfPath, d.workDir, t, t);
	}

	updateDocument(id: string, f: Partial<Record<string, unknown>>) {
		const keys = Object.keys(f);
		if (!keys.length) return;
		const sets = keys.map((k) => `${k} = ?`).join(", ");
		this.db.query(`UPDATE documents SET ${sets}, updated_at = ? WHERE id = ?`).run(...(keys.map((k) => f[k]) as never[]), now(), id);
	}

	addUsage(id: string, tokensIn: number, tokensOut: number, cost: number) {
		this.db
			.query(`UPDATE documents SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, cost_usd = cost_usd + ?, updated_at = ? WHERE id = ?`)
			.run(tokensIn, tokensOut, cost, now(), id);
	}

	docRow(id: string): Row | null {
		return this.db.query("SELECT * FROM documents WHERE id = ?").get(id) as Row | null;
	}

	doc(id: string) {
		const r = this.docRow(id);
		if (!r) throw new Error(`no document ${id}`);
		return { ...toSummary(r), pdfPath: r.pdf_path as string, workDir: r.work_dir as string, docRev: r.doc_rev as string | null };
	}

	listDocs(query?: string, filters?: DocFilter): DocSummary[] {
		let rows = this.db.query("SELECT * FROM documents ORDER BY created_at DESC").all() as Row[];
		if (query) {
			const q = query.toLowerCase();
			rows = rows.filter((r) =>
				["title", "authors", "journal", "doi", "genre", "file_name"].some((k) => String(r[k] ?? "").toLowerCase().includes(q)),
			);
		}
		if (filters?.status?.length) rows = rows.filter((r) => filters.status!.includes(r.status as DocStatus));
		if (filters?.genre?.length) rows = rows.filter((r) => filters.genre!.includes(String(r.genre)));
		return rows.map(toSummary);
	}

	deleteDocument(id: string) {
		for (const t of ["briefs", "stages", "tier_overrides", "annotations", "ratings"]) {
			this.db.query(`DELETE FROM ${t} WHERE doc_id = ?`).run(id);
		}
		this.db.query("DELETE FROM jobs WHERE doc_id = ?").run(id);
		this.db.query("DELETE FROM llm_calls WHERE doc_id = ?").run(id);
		this.db.query("DELETE FROM documents WHERE id = ?").run(id);
	}

	// ---- briefs ----
	setBrief(docId: string, b: Brief) {
		this.db
			.query(
				`INSERT OR REPLACE INTO briefs(doc_id, purpose, familiarity, density, notes_lang, questions_json, genre, pages) VALUES (?,?,?,?,?,?,?,?)`,
			)
			.run(docId, b.purpose, b.familiarity, b.density, b.notesLang, JSON.stringify(b.questions), b.genre ?? null, b.pages ?? null);
	}

	getBrief(docId: string): Brief | null {
		const r = this.db.query("SELECT * FROM briefs WHERE doc_id = ?").get(docId) as Row | null;
		if (!r) return null;
		return {
			purpose: r.purpose as Brief["purpose"],
			familiarity: String(r.familiarity ?? ""),
			density: (r.density as Brief["density"]) ?? "medium",
			notesLang: (r.notes_lang as Brief["notesLang"]) ?? "ko",
			questions: JSON.parse(String(r.questions_json ?? "[]")),
			genre: (r.genre as string) ?? null,
			pages: (r.pages as string) ?? null,
		};
	}

	// ---- stages ----
	getStages(docId: string): StageRecord[] {
		const rows = this.db.query("SELECT * FROM stages WHERE doc_id = ?").all(docId) as Row[];
		return rows.map((r) => ({
			stage: r.stage as Stage,
			status: r.status as StageRecord["status"],
			startedAt: (r.started_at as string) ?? null,
			finishedAt: (r.finished_at as string) ?? null,
			msg: (r.msg as string) ?? null,
			detail: (r.detail as string) ?? null,
			tokensIn: Number(r.tokens_in ?? 0),
			tokensOut: Number(r.tokens_out ?? 0),
			costUsd: Number(r.cost_usd ?? 0),
			attempts: Number(r.attempts ?? 0),
		}));
	}

	setStage(docId: string, stage: Stage, f: Partial<StageRecord>) {
		const cur = this.getStages(docId).find((s) => s.stage === stage);
		const merged: StageRecord = {
			stage,
			status: "pending",
			startedAt: null,
			finishedAt: null,
			msg: null,
			detail: null,
			tokensIn: 0,
			tokensOut: 0,
			costUsd: 0,
			attempts: 0,
			...cur,
			...f,
		};
		this.db
			.query(
				`INSERT OR REPLACE INTO stages(doc_id, stage, status, started_at, finished_at, msg, detail, tokens_in, tokens_out, cost_usd, attempts)
				 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
			)
			.run(
				docId,
				stage,
				merged.status,
				merged.startedAt,
				merged.finishedAt,
				merged.msg,
				merged.detail,
				merged.tokensIn,
				merged.tokensOut,
				merged.costUsd,
				merged.attempts,
			);
		return merged;
	}

	clearStagesFrom(docId: string, stages: Stage[]) {
		for (const s of stages) this.db.query("DELETE FROM stages WHERE doc_id = ? AND stage = ?").run(docId, s);
	}

	addStageUsage(docId: string, stage: Stage, tin: number, tout: number, cost: number) {
		this.db
			.query(`UPDATE stages SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, cost_usd = cost_usd + ? WHERE doc_id = ? AND stage = ?`)
			.run(tin, tout, cost, docId, stage);
	}

	logLlmCall(c: {
		docId: string;
		jobId: string | null;
		stage: string;
		model: string;
		tokensIn: number;
		tokensOut: number;
		cacheRead: number;
		cacheWrite: number;
		costUsd: number;
		logPath: string;
	}) {
		this.db
			.query(
				`INSERT INTO llm_calls(id, job_id, doc_id, stage, model, tokens_in, tokens_out, cache_read, cache_write, cost_usd, log_path, created_at)
				 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
			)
			.run(newId("c_"), c.jobId, c.docId, c.stage, c.model, c.tokensIn, c.tokensOut, c.cacheRead, c.cacheWrite, c.costUsd, c.logPath, now());
	}

	// ---- tier overrides ----
	setTierOverride(docId: string, sid: string, tier: Tier) {
		this.db.query("INSERT OR REPLACE INTO tier_overrides(doc_id, sid, tier, created_at) VALUES (?,?,?,?)").run(docId, sid, tier, now());
	}

	tierOverrides(docId: string): Record<string, Tier> {
		const rows = this.db.query("SELECT sid, tier FROM tier_overrides WHERE doc_id = ?").all(docId) as Row[];
		return Object.fromEntries(rows.map((r) => [r.sid as string, r.tier as Tier]));
	}

	// ---- annotations ----
	saveAnnotation(docId: string, a: WebAnnotation, sid: string | null, orphaned: boolean): StoredAnnotation {
		const id = a.id ?? newId("a_");
		const t = now();
		const existing = this.db.query("SELECT created_at FROM annotations WHERE id = ?").get(id) as Row | null;
		this.db
			.query(
				`INSERT OR REPLACE INTO annotations(id, doc_id, sid, body_json, target_json, motivation, color, doc_rev, created_at, updated_at, orphaned)
				 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
			)
			.run(
				id,
				docId,
				sid,
				JSON.stringify(a.body),
				JSON.stringify(a.target),
				a.motivation,
				a.color ?? null,
				a.docRev ?? null,
				(existing?.created_at as string) ?? t,
				t,
				orphaned ? 1 : 0,
			);
		return this.annotations(docId).find((x) => x.id === id)!;
	}

	annotations(docId: string): StoredAnnotation[] {
		const rows = this.db.query("SELECT * FROM annotations WHERE doc_id = ? ORDER BY created_at").all(docId) as Row[];
		return rows.map((r) => ({
			id: r.id as string,
			type: "Annotation",
			motivation: r.motivation as StoredAnnotation["motivation"],
			body: JSON.parse(String(r.body_json)),
			target: JSON.parse(String(r.target_json)),
			docRev: (r.doc_rev as string) ?? undefined,
			color: (r.color as string) ?? undefined,
			sid: (r.sid as string) ?? null,
			orphaned: Boolean(r.orphaned),
			createdAt: r.created_at as string,
			updatedAt: r.updated_at as string,
		}));
	}

	setAnnotationState(id: string, sid: string | null, orphaned: boolean, docRev: string | null) {
		this.db.query("UPDATE annotations SET sid = ?, orphaned = ?, doc_rev = ? WHERE id = ?").run(sid, orphaned ? 1 : 0, docRev, id);
	}

	deleteAnnotation(id: string) {
		this.db.query("DELETE FROM annotations WHERE id = ?").run(id);
	}

	// ---- rules, ratings, settings ----
	listRules(): UserRule[] {
		return (this.db.query("SELECT * FROM user_rules ORDER BY created_at").all() as Row[]).map((r) => ({
			id: r.id as string,
			scope: r.scope as UserRule["scope"],
			text: r.text as string,
			createdAt: r.created_at as string,
		}));
	}

	addRule(scope: UserRule["scope"], text: string): UserRule {
		const r = { id: newId("r_"), scope, text, createdAt: now() };
		this.db.query("INSERT INTO user_rules(id, scope, text, created_at) VALUES (?,?,?,?)").run(r.id, r.scope, r.text, r.createdAt);
		return r;
	}

	deleteRule(id: string) {
		this.db.query("DELETE FROM user_rules WHERE id = ?").run(id);
	}

	addRating(docId: string, pid: string, stars: number, comment?: string) {
		this.db.query("INSERT INTO ratings(id, doc_id, pid, stars, comment, created_at) VALUES (?,?,?,?,?,?)").run(newId("g_"), docId, pid, stars, comment ?? null, now());
	}

	settings(): Settings {
		const rows = this.db.query("SELECT key, value FROM settings").all() as Row[];
		const s: Record<string, unknown> = structuredClone(DEFAULT_SETTINGS) as never;
		for (const r of rows) s[r.key as string] = JSON.parse(String(r.value));
		return s as unknown as Settings;
	}

	setSettings(p: Partial<Settings>) {
		const q = this.db.query("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)");
		for (const [k, v] of Object.entries(p)) q.run(k, JSON.stringify(v));
	}
}

function toSummary(r: Row): DocSummary {
	return {
		id: r.id as string,
		title: (r.title as string) || (r.file_name as string),
		authors: (r.authors as string) ?? null,
		journal: (r.journal as string) ?? null,
		year: (r.year as string) ?? null,
		doi: (r.doi as string) ?? null,
		genre: (r.genre as string) ?? null,
		status: r.status as DocStatus,
		stage: r.stage as Stage,
		pageCount: (r.page_count as number) ?? null,
		closeShare: (r.close_share as number) ?? null,
		costUsd: Number(r.cost_usd ?? 0),
		tokensIn: Number(r.tokens_in ?? 0),
		tokensOut: Number(r.tokens_out ?? 0),
		createdAt: r.created_at as string,
		updatedAt: r.updated_at as string,
		error: (r.error as string) ?? null,
		fileName: r.file_name as string,
	};
}
