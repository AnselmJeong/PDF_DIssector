// JobRunner: the reading-guide workflow (SKILL.md steps 0-6) as a resumable state machine.
// Each stage reads and writes files in WORK, so a job can resume from any stage after a crash or a cancel.
import { existsSync, readFileSync } from "node:fs";
import type { Brief, FixOp, Finding, JobState, Settings, Stage, StageRecord } from "../../shared/types";
import { STAGES } from "../../shared/types";
import type { Library } from "../library/db";
import type { CallSpec, Llm } from "../llm/client";
import * as P from "../llm/prompts";
import * as S from "../llm/schemas";
import type { PdfxBridge } from "../pipeline/bridge";
import { clean, docDump, type Guide, idsInRange, metaFromBrief, readJson, toEntry, Work, writeJson } from "./work";

export interface CheckResult {
	errors: string[];
	warns: string[];
	stats: { n: number; counts: Record<string, number> };
}

export interface RunnerDeps {
	lib: Library;
	bridge: PdfxBridge;
	llm: (docId: string, work: Work) => Llm; // throws when no API key
	refs: () => Promise<P.References>;
	emit: {
		progress: (m: { docId: string; stage: Stage; status: StageRecord["status"]; pct: number; msg: string; tokens: number; costUsd: number }) => void;
		done: (m: { docId: string; ok: boolean; error?: string }) => void;
	};
	settings: () => Settings;
}

class Canceled extends Error {}

const PURPOSE_FALLBACK: Brief = { purpose: "whole argument", familiarity: "", density: "medium", questions: [], notesLang: "ko" };

export class JobRunner {
	private active = new Map<string, { jobId: string; canceled: boolean }>();

	constructor(private d: RunnerDeps) {}

	isRunning(docId: string) {
		return this.active.has(docId);
	}

	state(docId: string): JobState {
		const doc = this.d.lib.doc(docId);
		const work = new Work(doc.workDir);
		const recs = this.d.lib.getStages(docId);
		const stages = STAGES.map(
			(s) =>
				recs.find((r) => r.stage === s) ?? {
					stage: s,
					status: "pending" as const,
					startedAt: null,
					finishedAt: null,
					msg: null,
					detail: null,
					tokensIn: 0,
					tokensOut: 0,
					costUsd: 0,
					attempts: 0,
				},
		);
		const overlays = existsSync(work.path("inspect.json")) ? readJson<{ overlays: { page: number; path: string }[] }>(work.path("inspect.json")).overlays : [];
		const fixes = existsSync(work.path("fixes_all.json")) ? readJson<FixOp[]>(work.path("fixes_all.json")) : [];
		const findings = existsSync(work.path("findings.json")) ? readJson<Finding[]>(work.path("findings.json")) : [];
		return { docId, jobId: this.active.get(docId)?.jobId ?? null, running: this.active.has(docId), stages, overlays, fixes, findings };
	}

	cancel(docId: string) {
		const a = this.active.get(docId);
		if (a) {
			a.canceled = true;
			this.d.bridge.cancel(`segment:${docId}`);
		}
	}

	start(docId: string, from?: Stage) {
		if (this.active.has(docId)) return this.active.get(docId)!.jobId;
		const jobId = crypto.randomUUID();
		this.active.set(docId, { jobId, canceled: false });
		if (from) {
			const k = STAGES.indexOf(from);
			this.d.lib.clearStagesFrom(docId, STAGES.slice(k) as unknown as Stage[]);
		}
		this.d.lib.updateDocument(docId, { status: "processing", error: null });
		void this.run(docId, jobId)
			.then(() => this.d.emit.done({ docId, ok: true }))
			.catch((e: Error) => {
				const canceled = e instanceof Canceled;
				this.d.lib.updateDocument(docId, { status: canceled ? "canceled" : "failed", error: canceled ? null : e.message });
				this.d.emit.done({ docId, ok: false, error: canceled ? "취소됨" : e.message });
			})
			.finally(() => this.active.delete(docId));
		return jobId;
	}

	// ------------------------------------------------------------------
	private async run(docId: string, jobId: string) {
		const lib = this.d.lib;
		const doc = lib.doc(docId);
		const work = new Work(doc.workDir);
		const brief = lib.getBrief(docId) ?? PURPOSE_FALLBACK;
		const ctx: Ctx = { docId, jobId, work, brief, pdf: doc.pdfPath, stage: "IMPORTED" };
		const done = new Set(lib.getStages(docId).filter((s) => s.status === "done" || s.status === "skipped").map((s) => s.stage));
		const plan: [Stage, (c: Ctx) => Promise<string | void>][] = [
			["BRIEFED", async () => (lib.getBrief(docId) ? "브리핑 저장됨" : "기본값 사용(전체 논증, 중간 밀도)")],
			["SEGMENTED", (c) => this.segment(c)],
			["INSPECTED", (c) => this.inspect(c)],
			["FIXED", (c) => this.applyFixes(c)],
			["OPEN_FETCHED", (c) => this.fetchOpen(c)],
			["UNDERSTOOD", (c) => this.understand(c)],
			["GUIDE_DRAFTED", (c) => this.annotate(c)],
			["DEEP_DIVED", (c) => this.deepDive(c)],
			["CHECKED", (c) => this.checkLoop(c, 3)],
			["REVIEWED", (c) => this.review(c)],
			["FINAL", (c) => this.final(c)],
			["RENDERED", (c) => this.render(c)],
		];
		lib.setStage(docId, "IMPORTED", { status: "done", finishedAt: new Date().toISOString(), msg: doc.fileName });
		for (const [stage, fn] of plan) {
			if (done.has(stage)) continue;
			this.checkCanceled(docId);
			ctx.stage = stage;
			const prev = lib.getStages(docId).find((s) => s.stage === stage);
			lib.setStage(docId, stage, { status: "running", startedAt: new Date().toISOString(), finishedAt: null, msg: null, attempts: (prev?.attempts ?? 0) + 1 });
			lib.updateDocument(docId, { stage });
			this.progress(ctx, "running", 0, "시작");
			try {
				const msg = await fn(ctx);
				const skipped = typeof msg === "string" && msg.startsWith("SKIP:");
				lib.setStage(docId, stage, {
					status: skipped ? "skipped" : "done",
					finishedAt: new Date().toISOString(),
					msg: (skipped ? msg.slice(5) : msg) || "완료",
				});
				this.progress(ctx, skipped ? "skipped" : "done", 100, (skipped ? msg.slice(5) : msg) || "완료");
			} catch (e) {
				const err = e as Error;
				lib.setStage(docId, stage, { status: "failed", finishedAt: new Date().toISOString(), msg: err.message.slice(0, 2000) });
				this.progress(ctx, "failed", 100, err.message.slice(0, 300));
				throw err;
			}
		}
	}

	private checkCanceled(docId: string) {
		if (this.active.get(docId)?.canceled) throw new Canceled("canceled");
	}

	private progress(c: Ctx, status: StageRecord["status"], pct: number, msg: string) {
		const rec = this.d.lib.getStages(c.docId).find((s) => s.stage === c.stage);
		this.d.emit.progress({
			docId: c.docId,
			stage: c.stage,
			status,
			pct,
			msg,
			tokens: (rec?.tokensIn ?? 0) + (rec?.tokensOut ?? 0),
			costUsd: this.d.lib.doc(c.docId).costUsd,
		});
	}

	private llm(c: Ctx) {
		const s = this.d.settings();
		const cost = this.d.lib.doc(c.docId).costUsd;
		if (s.llmBackend === "api" && s.costCapUsd > 0 && cost >= s.costCapUsd) {
			throw new Error(`문서당 비용 상한($${s.costCapUsd})에 도달했습니다 (현재 $${cost.toFixed(2)}). 설정에서 상한을 올린 뒤 이어서 실행하세요.`);
		}
		return this.d.llm(c.docId, c.work);
	}

	/** Structured call with a fallback: if the API rejects the schema, ask for JSON in the prompt instead. */
	private async json<T>(c: Ctx, spec: CallSpec): Promise<T> {
		this.checkCanceled(c.docId);
		const llm = this.llm(c);
		try {
			return (await llm.call<T>({ ...spec, tag: `${c.stage}_${spec.tag}` })).value;
		} catch (e) {
			const msg = String((e as Error).message);
			if (!/schema|output_config|format/i.test(msg) || !spec.schema) throw e;
			const r = await llm.call<string>({
				...spec,
				schema: undefined,
				tag: `${c.stage}_${spec.tag}_noschema`,
				prompt: `${spec.prompt}\n\nReply with one JSON object only, matching this JSON Schema:\n${JSON.stringify(spec.schema)}`,
			});
			const t = r.text;
			return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as T;
		}
	}

	// ---- stage 1: segment ---------------------------------------------
	private async segment(c: Ctx) {
		const args: Record<string, unknown> = { pdf: c.pdf, work: c.work.dir };
		if (c.brief.pages) args.pages = c.brief.pages;
		type Seg = { self_check: string | null; counts: Record<string, number>; page_count: number; title_guess: string; doc_rev: string };
		let res = await this.d.bridge.runOnce<Seg>("segment", args, `segment:${c.docId}`, (p) => this.progress(c, "running", p.pct, p.msg));
		if (!res.counts.para) {
			this.progress(c, "running", 50, "문단이 없음: 1단 설정으로 재시도");
			res = await this.d.bridge.runOnce<Seg>("segment", { ...args, columns: "1" }, `segment:${c.docId}`);
		}
		if (!res.counts.para) throw new Error("PDF에서 본문 문단을 찾지 못했습니다. 스캔본이면 설정에서 MinerU 설치가 필요합니다.");
		this.d.lib.updateDocument(c.docId, { page_count: res.page_count, doc_rev: res.doc_rev });
		this.d.lib.setStage(c.docId, "SEGMENTED", { detail: res.self_check ?? null });
		const cnt = res.counts;
		return `문단 ${cnt.para}, 제목 ${cnt.heading}, 캡션 ${cnt.caption}, 각주 ${cnt.note}, 조각 ${cnt.frag}`;
	}

	// ---- stage 2: inspect pages (vision) ------------------------------
	private async inspect(c: Ctx) {
		const doc = c.work.paragraphs();
		const pages = new Set<number>([1]);
		const lastBody = Math.max(...doc.items.filter((i) => i.type === "para").map((i) => i.page));
		pages.add(lastBody);
		const selfCheck = this.d.lib.getStages(c.docId).find((s) => s.stage === "SEGMENTED")?.detail ?? "";
		// pages the self-check names, and pages with captions (crops and caption typing are the usual problems)
		for (const m of selfCheck.matchAll(/(?:p|第\s?)(\d{1,3})/gi)) pages.add(Number(m[1]));
		for (const it of doc.items) if (it.type === "caption") pages.add(it.page);
		const selected = [...pages].filter((p) => p >= 1 && p <= doc.page_count).sort((a, b) => a - b).slice(0, 8);
		const ov = await this.d.bridge.call<{ pages: string[] }>("overlay", { work: c.work.dir, pages: selected });
		const overlays = ov.pages.map((p) => ({ page: Number(/p(\d+)\.png$/.exec(p)?.[1] ?? 0), path: p }));
		writeJson(c.work.path("inspect.json"), { overlays });
		const images = overlays.map((o) => ({
			mediaType: "image/png" as const,
			base64: readFileSync(o.path).toString("base64"),
			label: `Page ${o.page} overlay. Items on this page:\n${doc.items
				.filter((i) => i.page === o.page)
				.map((i) => `${i.id} ${i.type}${i.level != null ? ` L${i.level}` : ""}: ${i.text.slice(0, 90)}`)
				.join("\n")}`,
		}));
		const settings = this.d.settings();
		const res = await this.json<{ fixes: FixOp[]; summary: string }>(c, {
			model: settings.models.reviewer,
			system: P.INSPECT_SYSTEM,
			images,
			prompt: `Self-check line from the segmenter: ${selfCheck || "(none)"}\nCrops exist for: ${Object.keys(doc.crops ?? {}).join(", ") || "none"}.\nWrite the fixes for these pages.`,
			schema: S.FIXES_SCHEMA,
			effort: "medium",
			maxTokens: 16000,
			tag: "inspect",
		});
		const fixes = (res.fixes ?? []).map((f) => ({ ...(clean(f) as FixOp), enabled: true }));
		writeJson(c.work.path("fixes_all.json"), fixes);
		this.d.lib.setStage(c.docId, "INSPECTED", { detail: res.summary ?? null });
		return `${selected.length}쪽 검수, 보정 ${fixes.length}건 제안`;
	}

	// ---- stage 3: apply fixes ----------------------------------------
	private async applyFixes(c: Ctx) {
		const all = existsSync(c.work.path("fixes_all.json")) ? readJson<FixOp[]>(c.work.path("fixes_all.json")) : [];
		let ops = all.filter((f) => f.enabled !== false).map(({ enabled: _e, ...f }) => f);
		if (!ops.length && !existsSync(c.work.path("fixes_log.json"))) return "SKIP:적용할 보정 없음";
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const r = await this.d.bridge.call<{ counts: Record<string, number>; doc_rev: string }>("apply_fixes", { work: c.work.dir, fixes: ops });
				this.d.lib.updateDocument(c.docId, { doc_rev: r.doc_rev });
				return `보정 ${ops.length}건 적용 (문단 ${r.counts.para})`;
			} catch (e) {
				if (attempt === 1) {
					// drop the fixes and carry on with the raw segmentation rather than failing the job
					writeJson(c.work.path("fixes_all.json"), all.map((f) => ({ ...f, enabled: false })));
					return `SKIP:보정 적용 실패, 원래 분할 사용: ${(e as Error).message.slice(0, 200)}`;
				}
				// one rewrite with the error message, as the workflow prescribes
				const res = await this.json<{ fixes: FixOp[] }>(c, {
					model: this.d.settings().models.reviewer,
					system: P.INSPECT_SYSTEM,
					prompt: `These fixes failed to apply:\n${JSON.stringify(ops)}\nError: ${(e as Error).message}\nItems:\n${c.work
						.paragraphs()
						.items.map((i) => `${i.id} ${i.type} p${i.page}: ${i.text.slice(0, 80)}`)
						.join("\n")}\nReturn the corrected list (drop ops you cannot fix).`,
					schema: S.FIXES_SCHEMA,
					effort: "low",
					maxTokens: 8000,
					tag: "fixes_retry",
				});
				ops = (res.fixes ?? []).map((f) => clean(f) as FixOp);
				writeJson(c.work.path("fixes_all.json"), ops.map((f) => ({ ...f, enabled: true })));
			}
		}
		return undefined;
	}

	// ---- stage 4: open version ---------------------------------------
	private async fetchOpen(c: Ctx) {
		try {
			const r = await this.d.bridge.call<{ written: boolean; reason?: string; figures?: number; equations?: number; record?: Record<string, string> | null }>(
				"fetch_open",
				{ work: c.work.dir },
			);
			const rec = r.record;
			if (rec) {
				this.d.lib.updateDocument(c.docId, {
					doi: rec.doi ?? null,
					pmid: rec.pmid ?? null,
					pmcid: rec.pmcid ?? null,
					journal: rec.journal ?? null,
					year: rec.year ?? null,
					authors: rec.authors ?? null,
					...(rec.title ? { title: rec.title } : {}),
				});
			}
			if (!r.written) return `SKIP:${r.reason ?? "공개 원문 없음"}`;
			return `PMC 원문: 그림·표 ${r.figures}, 수식 ${r.equations}`;
		} catch (e) {
			return `SKIP:네트워크 오류로 건너뜀 (${(e as Error).message.slice(0, 120)})`;
		}
	}

	// ---- stage 5: understand -----------------------------------------
	private async writerBase(c: Ctx) {
		const refs = await this.d.refs();
		const doc = c.work.paragraphs();
		return {
			system: P.writerSystem(refs, this.d.lib.listRules()),
			context: docDump(doc),
			brief: P.briefText(c.brief, doc.title_guess ?? ""),
			doc,
		};
	}

	private async understand(c: Ctx) {
		const { system, context, brief, doc } = await this.writerBase(c);
		const n = doc.items.filter((i) => i.type === "para").length;
		const s = this.d.settings();
		const r = await this.json<{
			genre: string;
			design_checkpoints: string[];
			title: string;
			author: string;
			source: string;
			thesis: string;
			overview: string;
			parts: Record<string, unknown>[];
			questions: { q: string; a: string; p: string[] }[];
			close_candidates: string[];
		}>(c, { model: s.models.writer, system, context, prompt: P.understandPrompt(brief, n), schema: S.UNDERSTAND_SCHEMA, effort: "high", maxTokens: 64000, tag: "understand" });
		const parts = repairParts((r.parts ?? []).map((p) => clean(p)), n);
		const guide: Guide = {
			meta: { ...metaFromBrief(c.brief, { title: r.title, author: r.author, source: r.source, genre: r.genre }), design_checkpoints: r.design_checkpoints, close_candidates: r.close_candidates },
			questions: c.brief.questions.length ? (r.questions ?? []).map((q) => clean(q)) : [],
			thesis: r.thesis,
			overview: r.overview,
			parts,
		};
		c.work.saveGuide(guide);
		const hasRecord = !!this.d.lib.docRow(c.docId)?.pmcid;
		this.d.lib.updateDocument(c.docId, {
			genre: r.genre,
			...(!hasRecord && r.title ? { title: r.title } : {}),
			...(!hasRecord && r.author ? { authors: r.author } : {}),
		});
		return `장르: ${r.genre}; 파트 ${parts.length}개; 정독 후보 ${r.close_candidates?.length ?? 0}개`;
	}

	// ---- stage 6: annotate paragraphs per part (parallel) --------------
	private async annotate(c: Ctx) {
		const { system, context, brief } = await this.writerBase(c);
		const guide = c.work.guide();
		const skeleton = JSON.stringify({ thesis: guide.thesis, parts: guide.parts, close_candidates: guide.meta.close_candidates, design_checkpoints: guide.meta.design_checkpoints });
		const s = this.d.settings();
		const existing = c.work.entries();
		const jobs = guide.parts
			.map((p) => ({ p, ids: idsInRange(String(p.range)) }))
			.filter(({ ids }) => ids.some((id) => !existing[id]));
		let doneCount = 0;
		const all = { ...existing };
		await pool(jobs, Math.max(1, s.concurrency), async ({ p, ids }) => {
			// a long part goes in chunks of 30 so the output stays well inside max_tokens
			for (let i = 0; i < ids.length; i += 30) {
				const chunk = ids.slice(i, i + 30);
				const r = await this.json<{ paras: Record<string, unknown>[] }>(c, {
					model: s.models.writer,
					system,
					context,
					prompt: P.annotatePrompt(brief, skeleton, chunk, `${p.id} ${p.title}`),
					schema: S.ENTRIES_SCHEMA,
					effort: "high",
					maxTokens: 64000,
					tag: `annotate_${p.id}_${i}`,
				});
				for (const e of r.paras ?? []) {
					const [id, entry] = toEntry(e);
					all[id] = entry;
				}
				c.work.saveEntries(all, guide.parts as { range: string }[]);
			}
			doneCount++;
			this.progress(c, "running", Math.round((doneCount / jobs.length) * 100), `${p.id} ${p.title} 완료 (${doneCount}/${jobs.length})`);
		});
		const close = Object.values(all).filter((e) => e.tier === "close").length;
		return `문단 해설 ${Object.keys(all).length}개 (정독 ${close})`;
	}

	// ---- stage 6b: formula and figure deep-dive ------------------------
	private async deepDive(c: Ctx) {
		const s = this.d.settings();
		if (s.fastMode) return "SKIP:빠른 모드: 수식·그림 심화 해설 생략";
		const { system, context, brief, doc } = await this.writerBase(c);
		const entries = c.work.entries();
		const items = new Map(doc.items.map((i) => [i.id, i]));
		const order = doc.items.map((i) => i.id);
		const crops = doc.crops ?? {};
		const sources = existsSync(c.work.path("sources.json")) ? readJson<{ figures?: { kind: string; num: number; caption?: string; rows?: string[][] }[] }>(c.work.path("sources.json")) : null;
		type Task = () => Promise<void>;
		const tasks: Task[] = [];
		// formulas in close reads
		for (const [pid, e] of Object.entries(entries)) {
			if (e.tier !== "close") continue;
			(e.els ?? []).forEach((el, index) => {
				if (el.t !== "formula") return;
				tasks.push(async () => {
					const k = order.indexOf(pid);
					let crop: string | null = null;
					for (let j = k + 1; j < order.length && j < k + 6; j++) {
						const it = items.get(order[j])!;
						if (it.type === "para") break;
						if (it.type === "frag" && crops[it.id]) {
							crop = c.work.path(crops[it.id]);
							break;
						}
					}
					const img = crop && existsSync(crop) ? [{ mediaType: "image/png" as const, base64: readFileSync(crop).toString("base64") }] : [];
					const r = await this.json<Record<string, unknown>>(c, {
						model: s.models.writer,
						system,
						context,
						images: img,
						prompt: P.formulaPrompt(brief, pid, items.get(pid)?.text ?? "", JSON.stringify(el), img.length > 0),
						schema: S.FORMULA_SCHEMA,
						effort: "high",
						maxTokens: 16000,
						tag: `formula_${pid}_${index}`,
					});
					const cur = c.work.entries();
					const target = cur[pid]?.els?.[index];
					if (target && target.t === "formula") {
						Object.assign(target, clean(r));
						c.work.saveEntries(cur, c.work.guide().parts as { range: string }[]);
					}
				});
			});
		}
		// figures and tables: host paragraph = first paragraph that cites them
		const capRe = /^\s*(fig(?:ure)?s?\.?|tables?)\s*(\d+)/i;
		const mention = (kind: string, n: number) => new RegExp(`\\b${kind === "table" ? "tables?" : "fig(?:ure)?s?\\.?"}\\s*${n}(?![\\d])`, "i");
		const caps = doc.items.filter((i) => i.type === "caption").slice(0, 14);
		for (const cap of caps) {
			const m = capRe.exec(cap.text);
			const kind = m ? (m[1].toLowerCase().startsWith("tab") ? "table" : "fig") : "fig";
			const num = m ? Number(m[2]) : null;
			const citing = num != null ? doc.items.filter((i) => i.type === "para" && mention(kind, num).test(i.text)) : [];
			const host = citing[0]?.id ?? order.slice(0, order.indexOf(cap.id)).reverse().find((id) => items.get(id)?.type === "para");
			if (!host || !entries[host]) continue;
			if ((entries[host].els ?? []).some((e) => e.t === "figx" && e.cap === cap.id)) continue;
			tasks.push(async () => {
				const out = c.work.path("pages", `fig_${cap.id}.png`);
				let img: { mediaType: "image/png"; base64: string }[] = [];
				try {
					const r = await this.d.bridge.call<{ path: string }>("page_image", { pdf: c.pdf, page: cap.page, out, max_side: 1500 });
					img = [{ mediaType: "image/png", base64: readFileSync(r.path).toString("base64") }];
				} catch {
					/* no page image: caption and text only */
				}
				const open = sources?.figures?.find((f) => f.kind === kind && f.num === num);
				const rows = open?.rows ? open.rows.map((r) => r.join(" | ")).join("\n").slice(0, 6000) : null;
				const r = await this.json<Record<string, unknown>>(c, {
					model: s.models.writer,
					system,
					context,
					images: img,
					prompt: P.figurePrompt(brief, cap.id, cap.text, citing.map((p) => `${p.id}: ${p.text}`).join("\n").slice(0, 6000) || "(none)", img.length > 0, rows),
					schema: S.FIGX_SCHEMA,
					effort: "high",
					maxTokens: 16000,
					tag: `figx_${cap.id}`,
				});
				const cur = c.work.entries();
				if (cur[host]) {
					cur[host].els = [...(cur[host].els ?? []), { t: "figx", cap: cap.id, ...clean(r) }];
					c.work.saveEntries(cur, c.work.guide().parts as { range: string }[]);
				}
			});
		}
		if (!tasks.length) return "SKIP:심화 해설할 수식·그림 없음";
		let n = 0;
		// writes to the paras files are serialised by running one task per item and saving after each
		await pool(tasks, 1, async (t) => {
			await t();
			n++;
			this.progress(c, "running", Math.round((n / tasks.length) * 100), `수식·그림 ${n}/${tasks.length}`);
		});
		return `수식·그림 해설 ${tasks.length}건`;
	}

	// ---- stage 7: check loop -----------------------------------------
	async runCheck(work: Work): Promise<CheckResult> {
		return this.d.bridge.call<CheckResult>("check", { work: work.dir });
	}

	private async checkLoop(c: Ctx, rounds: number) {
		const s = this.d.settings();
		let res = await this.runCheck(c.work);
		for (let round = 0; round < rounds && res.errors.length; round++) {
			this.progress(c, "running", Math.round((round / rounds) * 100), `오류 ${res.errors.length}개 수정 (${round + 1}/${rounds})`);
			await this.patchFromLlm(c, P.fixPrompt, res.errors, res.warns, s.models.writer);
			res = await this.runCheck(c.work);
		}
		if (res.errors.length) {
			this.fallbackFix(c, res.errors);
			res = await this.runCheck(c.work);
		}
		this.d.lib.setStage(c.docId, c.stage, { detail: [...res.errors.map((e) => "ERROR " + e), ...res.warns.map((w) => "WARN " + w)].join("\n") || null });
		return `오류 ${res.errors.length}, 경고 ${res.warns.length}`;
	}

	private affected(messages: string[]) {
		const ids = new Set<string>();
		let guideLevel = false;
		for (const m of messages) {
			const id = /^(P\d+|N\d+)\b/.exec(m)?.[1];
			if (id) ids.add(id);
			else guideLevel = true;
			for (const x of m.matchAll(/\bP(\d+)(?:-P(\d+))?/g)) {
				if (/no guide entry/.test(m)) {
					const a = Number(x[1]);
					const b = Number(x[2] ?? x[1]);
					for (let i = a; i <= b; i++) ids.add(`P${i}`);
				}
			}
		}
		return { ids, guideLevel };
	}

	private async patchFromLlm(
		c: Ctx,
		prompt: (brief: string, a: string[], b: string[], cur: string) => string,
		errors: string[],
		warns: string[],
		model: string,
	) {
		const { system, context, brief } = await this.writerBase(c);
		const { ids, guideLevel } = this.affected(errors);
		const entries = c.work.entries();
		const guide = c.work.guide();
		const current = JSON.stringify({
			...(guideLevel ? { thesis: guide.thesis, overview: guide.overview, parts: guide.parts, questions: guide.questions } : {}),
			paras: Object.fromEntries([...ids].map((id) => [id, entries[id] ?? null])),
		});
		const r = await this.json<{ thesis?: string; overview?: string; parts?: Record<string, unknown>[]; questions?: { q: string; a: string; p: string[] }[]; paras: Record<string, unknown>[]; notes: string }>(
			c,
			{ model, system, context, prompt: prompt(brief, errors, warns, current), schema: S.GUIDE_PATCH_SCHEMA, effort: "high", maxTokens: 64000, tag: "patch" },
		);
		this.applyPatch(c.work, r);
		return r.notes;
	}

	applyPatch(work: Work, r: { thesis?: string; overview?: string; parts?: Record<string, unknown>[]; questions?: { q: string; a: string; p: string[] }[]; paras?: Record<string, unknown>[] }) {
		const guide = work.guide();
		const n = work.paragraphs().items.filter((i) => i.type === "para").length;
		if (r.thesis) guide.thesis = r.thesis;
		if (r.overview) guide.overview = r.overview;
		if (r.parts?.length) guide.parts = repairParts(r.parts.map((p) => clean(p)), n);
		if (r.questions) guide.questions = r.questions.map((q) => clean(q));
		work.saveGuide(guide);
		const entries = work.entries();
		for (const e of r.paras ?? []) {
			const [id, entry] = toEntry(e);
			entries[id] = entry;
		}
		work.saveEntries(entries, guide.parts as { range: string }[]);
	}

	/** After the LLM rounds: drop elements whose anchors cannot be found, fill missing entries, mark the rest. */
	private fallbackFix(c: Ctx, errors: string[]) {
		const entries = c.work.entries();
		const guide = c.work.guide();
		const n = c.work.paragraphs().items.filter((i) => i.type === "para").length;
		guide.parts = repairParts(guide.parts, n);
		const drop = new Map<string, Set<number>>();
		for (const e of errors) {
			const m = /^(P\d+|N\d+) element (\d+)/.exec(e);
			if (m && /anchor|unknown type|needs an anchor|tex/.test(e)) {
				if (!drop.has(m[1])) drop.set(m[1], new Set());
				drop.get(m[1])!.add(Number(m[2]) - 1);
				continue;
			}
			const miss = /no guide entry for (.*)$/.exec(e);
			if (miss) {
				for (const r of miss[1].split(/,\s*/)) {
					for (const id of idsInRange(r)) {
						entries[id] ??= { tier: "skim", role: "해설 없음", note: "이 문단의 해설을 만들지 못했습니다. 원문을 읽어 주세요.", els: [], verify_failed: ["해설 생성 실패"] };
					}
				}
				continue;
			}
			const id = /^(P\d+|N\d+)\b/.exec(e)?.[1];
			if (id && entries[id]) entries[id].verify_failed = [...(entries[id].verify_failed ?? []), e];
		}
		for (const [id, idx] of drop) {
			if (entries[id]?.els) {
				entries[id].els = entries[id].els!.filter((_, i) => !idx.has(i));
				entries[id].verify_failed = [...(entries[id].verify_failed ?? []), `요소 ${idx.size}개 제거(원문에서 근거를 찾지 못함)`];
			}
		}
		c.work.saveGuide(guide);
		c.work.saveEntries(entries, guide.parts as { range: string }[]);
	}

	// ---- stage 8: second read ----------------------------------------
	private mergedGuide(work: Work) {
		const g = work.guide();
		return JSON.stringify({ ...g, meta: { ...g.meta, close_candidates: undefined }, paras: work.entries() });
	}

	private async review(c: Ctx) {
		const s = this.d.settings();
		const refs = await this.d.refs();
		const doc = c.work.paragraphs();
		const r = await this.json<{ findings: Finding[]; summary: string }>(c, {
			model: s.fastMode ? s.models.helper : s.models.reviewer,
			system: P.reviewerSystem(refs),
			context: docDump(doc),
			prompt: P.reviewPrompt(this.mergedGuide(c.work)),
			schema: S.REVIEW_SCHEMA,
			effort: "high",
			maxTokens: 32000,
			tag: "review",
		});
		const findings = (r.findings ?? []).map((f) => ({ ...f, status: "open" as const }));
		writeJson(c.work.path("findings.json"), findings);
		const mis = findings.filter((f) => f.severity === "misleading").length;
		return `지적 ${findings.length}건 (오해 소지 ${mis}, 경미 ${findings.length - mis})`;
	}

	// ---- stage 9: fix findings, confirm, re-check -----------------------
	private async final(c: Ctx) {
		const s = this.d.settings();
		const findings = existsSync(c.work.path("findings.json")) ? readJson<Finding[]>(c.work.path("findings.json")) : [];
		const open = findings.filter((f) => f.status !== "fixed");
		if (open.length) {
			const msgs = open.map((f) => `${f.where}: [${f.severity}] ${f.problem} -> ${f.fix}`);
			const { ids, guideLevel } = this.affected(open.map((f) => f.where));
			const entries = c.work.entries();
			const guide = c.work.guide();
			// fields such as "S4 claim" are guide-level; include the parts whenever a finding is not a paragraph
			const current = JSON.stringify({
				...(guideLevel ? { thesis: guide.thesis, overview: guide.overview, parts: guide.parts, questions: guide.questions } : {}),
				paras: Object.fromEntries([...ids].map((id) => [id, entries[id] ?? null])),
			});
			const { system, context, brief } = await this.writerBase(c);
			const r = await this.json<{ paras: Record<string, unknown>[]; notes: string; thesis?: string; overview?: string; parts?: Record<string, unknown>[] }>(c, {
				model: s.models.writer,
				system,
				context,
				prompt: P.findingFixPrompt(brief, msgs.join("\n"), current),
				schema: S.GUIDE_PATCH_SCHEMA,
				effort: "high",
				maxTokens: 64000,
				tag: "fix_findings",
			});
			this.applyPatch(c.work, r);
			// the reviewer confirms the changed fields once
			const refs = await this.d.refs();
			const changed = JSON.stringify({ changed_paras: (r.paras ?? []).map((p) => p), thesis: r.thesis, overview: r.overview, parts: r.parts, earlier_findings: msgs });
			const conf = await this.json<{ findings: Finding[] }>(c, {
				model: s.fastMode ? s.models.helper : s.models.reviewer,
				system: P.reviewerSystem(refs),
				context: docDump(c.work.paragraphs()),
				prompt: `The writer changed these fields to answer your earlier findings. Confirm each change against the text; report only findings that remain or that the change introduced.\n${changed}`,
				schema: S.REVIEW_SCHEMA,
				effort: "medium",
				maxTokens: 16000,
				tag: "confirm",
			});
			const remaining = (conf.findings ?? []).map((f) => ({ ...f, status: "open" as const }));
			const resolved = open.map((f) => ({ ...f, status: "fixed" as const }));
			writeJson(c.work.path("findings.json"), [...findings.filter((f) => f.status === "fixed"), ...resolved, ...remaining]);
		}
		const msg = await this.checkLoop(c, 2);
		return `검토 반영 완료; ${msg}`;
	}

	// ---- stage 10: reader data ---------------------------------------
	private async render(c: Ctx) {
		const r = await this.d.bridge.call<{ path: string; errors: number }>("build_data", { work: c.work.dir, out: c.work.path("reader.json") });
		const data = readJson<{ check: CheckResult; meta: { title?: Record<string, string> | string } }>(r.path);
		const st = data.check.stats;
		const findings = existsSync(c.work.path("findings.json")) ? readJson<Finding[]>(c.work.path("findings.json")) : [];
		const misleading = findings.filter((f) => f.status === "open" && f.severity === "misleading").length;
		const status = data.check.errors.length || misleading ? "needs_review" : "done";
		const t = data.meta.title;
		const guideTitle = typeof t === "string" ? t : t ? Object.values(t)[0] : undefined;
		// a title from the PMC record wins over the model's reading of the first page
		const title = this.d.lib.docRow(c.docId)?.pmcid ? undefined : guideTitle;
		this.d.lib.updateDocument(c.docId, {
			status,
			close_share: st.n ? (st.counts.close ?? 0) / st.n : null,
			...(title ? { title } : {}),
		});
		return `Reader 준비 완료${status === "needs_review" ? " (검토 필요 항목 있음)" : ""}`;
	}
}

interface Ctx {
	docId: string;
	jobId: string;
	work: Work;
	brief: Brief;
	pdf: string;
	stage: Stage;
}

/** Make parts cover P1..Pn in order without gaps or overlaps (keeps the model's boundaries where it can). */
export function repairParts(parts: Record<string, unknown>[], n: number) {
	const parsed = parts
		.map((p) => {
			const m = /^\s*P(\d+)\s*(?:[-–]\s*P?(\d+))?/i.exec(String(p.range ?? ""));
			return m ? { p, a: Number(m[1]), b: Number(m[2] ?? m[1]) } : null;
		})
		.filter((x): x is { p: Record<string, unknown>; a: number; b: number } => !!x && x.a <= n)
		.sort((x, y) => x.a - y.a);
	if (!parsed.length) return [{ id: "S1", title: "본문", range: `P1-P${n}`, role: "전체", skip: true }];
	const out: Record<string, unknown>[] = [];
	let next = 1;
	for (let i = 0; i < parsed.length; i++) {
		const { p } = parsed[i];
		const end = i === parsed.length - 1 ? n : Math.max(next, Math.min(parsed[i + 1].a - 1, Math.max(parsed[i].b, next)));
		if (end < next) continue;
		const a = next;
		const range = a === end ? `P${a}` : `P${a}-P${end}`;
		const q: Record<string, unknown> = { ...p, range };
		const cp = /^P(\d+)$/.exec(String(q.claim_p ?? ""));
		if (!q.skip && (!cp || Number(cp[1]) < a || Number(cp[1]) > end)) q.claim_p = `P${a}`;
		if (Array.isArray(q.flow)) q.flow = (q.flow as { p: string }[]).filter((s) => {
			const k = /^P(\d+)$/.exec(s.p);
			return !k || (Number(k[1]) >= a && Number(k[1]) <= end);
		});
		out.push(q);
		next = end + 1;
	}
	return out;
}

export async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
	let i = 0;
	const errors: Error[] = [];
	const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
		while (i < items.length) {
			const k = i++;
			try {
				await fn(items[k]);
			} catch (e) {
				errors.push(e as Error);
			}
		}
	});
	await Promise.all(workers);
	if (errors.length) throw errors[0];
}
