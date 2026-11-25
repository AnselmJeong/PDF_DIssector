// The app's main-process services and request handlers. index.ts exposes them over Electrobun RPC;
// devServer.ts exposes the same handlers over HTTP so the UI can be developed and tested in a browser.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { BunRequests, ReaderData, ReaderEntry, Stage, StoredAnnotation, WebviewMessages } from "../shared/types";
import { resolveAnnotation } from "./annotations/reanchor";
import { JobRunner } from "./jobs/runner";
import { toEntry, Work, readJson } from "./jobs/work";
import { DEFAULT_SETTINGS, Library, newId } from "./library/db";
import { claudeVersion, ClaudeCodeClient, locateClaude } from "./llm/claudeCode";
import { type Llm, LlmClient } from "./llm/client";
import * as P from "./llm/prompts";
import * as S from "./llm/schemas";
import { locateEngine, PdfxBridge } from "./pipeline/bridge";
import { SecretStore } from "./secrets";
import { listOllamaModels, OllamaClient } from "./llm/ollama";

type Handlers = { [K in keyof BunRequests]: (p: BunRequests[K]["params"]) => Promise<BunRequests[K]["response"]> };

export interface Platform {
	dataDir: string;
	resourcesDir?: string | null;
	pickFiles: () => Promise<string[]>;
	pickDir: () => Promise<string | null>;
	showInFolder: (path: string) => void;
	notify: (title: string, body: string) => void;
	send: <K extends keyof WebviewMessages>(name: K, payload: WebviewMessages[K]) => void;
}

export function createBackend(pf: Platform) {
	mkdirSync(pf.dataDir, { recursive: true });
	const lib = new Library(join(pf.dataDir, "library.sqlite"));
	const secrets = new SecretStore(pf.dataDir);
	const ollamaSecrets = new SecretStore(pf.dataDir, "ollama-api-key", "OLLAMA_API_KEY", ".ollama-key");
	/** Ollama Cloud needs a key; a local server (localhost) does not. */
	const ollamaNeedsKey = (url: string) => !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
	let engineInfo = "";
	// Two engine processes: the `serve` process answers one request at a time, so background jobs get
	// their own (jobBridge) and the reader/brief dialog (bridge) never wait behind a long pipeline step.
	let bridge: PdfxBridge;
	let jobBridge: PdfxBridge;
	try {
		const loc = locateEngine({ pythonOverride: lib.settings().pythonPath, resourcesDir: pf.resourcesDir });
		bridge = new PdfxBridge(loc);
		jobBridge = new PdfxBridge(loc);
		engineInfo = `${loc.python} | ${loc.engineDir}`;
	} catch (e) {
		engineInfo = (e as Error).message;
		bridge = new PdfxBridge({ python: "python3", engineDir: "." });
		jobBridge = new PdfxBridge({ python: "python3", engineDir: "." });
	}

	let refsCache: P.References | null = null;
	const refs = async () => (refsCache ??= await bridge.call<P.References>("references"));

	const llmReady = (): string | null => {
		const s = lib.settings();
		if (s.llmBackend === "api") return secrets.has() ? null : "Anthropic API 키가 없습니다. 설정에서 입력하거나 구독(Claude Code) 방식으로 바꾸세요.";
		if (s.llmBackend === "ollama") {
			if (!s.ollama.model.trim()) return "Ollama 모델 이름이 없습니다. 설정에서 입력하세요.";
			return ollamaNeedsKey(s.ollama.baseUrl) && !ollamaSecrets.has() ? "Ollama API 키가 없습니다. 설정에서 입력하세요." : null;
		}
		return locateClaude(s.claudePath) ? null : "Claude Code(claude 명령)를 찾지 못했습니다. Claude Code를 설치하고 `claude`로 한 번 로그인하세요.";
	};

	const llmFor = (docId: string, work: Work | null): Llm => {
		const s = lib.settings();
		const onUsage = (u: import("./llm/client").Usage, tag: string, logPath: string) => {
			lib.addUsage(docId, u.tokensIn, u.tokensOut, u.costUsd);
			const stage = (tag.split("_")[0] || "CHAT") as Stage;
			lib.addStageUsage(docId, stage, u.tokensIn, u.tokensOut, u.costUsd);
			lib.logLlmCall({ docId, jobId: null, stage, model: u.model, tokensIn: u.tokensIn, tokensOut: u.tokensOut, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite, costUsd: u.costUsd, logPath });
		};
		const logDir = work ? work.path("llm_log") : join(pf.dataDir, "llm_log");
		if (s.llmBackend === "ollama") {
			const model = s.ollama.model.trim();
			if (!model) throw new Error("Ollama 모델 이름이 없습니다. 설정에서 입력하세요.");
			const key = ollamaSecrets.get();
			if (!key && ollamaNeedsKey(s.ollama.baseUrl)) throw new Error("Ollama API 키가 없습니다. 설정에서 입력하세요.");
			return new OllamaClient(s.ollama.baseUrl.trim() || "https://ollama.com/v1", key, model, logDir, onUsage);
		}
		if (s.llmBackend !== "api") {
			const bin = locateClaude(s.claudePath);
			if (!bin) throw new Error("Claude Code(claude 명령)를 찾지 못했습니다. 설치 후 `claude`로 로그인하세요.");
			return new ClaudeCodeClient(bin, join(pf.dataDir, "claude-cwd"), logDir, onUsage);
		}
		const key = secrets.get();
		if (!key) throw new Error("Anthropic API 키가 없습니다. 설정에서 입력하세요.");
		return new LlmClient(key, logDir, (u, tag, logPath) => {
			lib.addUsage(docId, u.tokensIn, u.tokensOut, u.costUsd);
			const stage = (tag.split("_")[0] || "CHAT") as Stage;
			lib.addStageUsage(docId, stage, u.tokensIn, u.tokensOut, u.costUsd);
			lib.logLlmCall({ docId, jobId: null, stage, model: u.model, tokensIn: u.tokensIn, tokensOut: u.tokensOut, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite, costUsd: u.costUsd, logPath });
		});
	};

	const runner = new JobRunner({
		lib,
		bridge: jobBridge,
		llm: llmFor,
		refs,
		settings: () => lib.settings(),
		emit: {
			progress: (m) => {
				pf.send("jobProgress", { ...m, progress: runner.progressOf(m.docId)?.progress ?? undefined });
			},
			changed: () => pf.send("docsChanged", {}),
			done: (m) => {
				pf.send("jobDone", m);
				pf.send("docsChanged", {});
				const d = lib.docRow(m.docId);
				pf.notify(m.paused ? "레이아웃 보정 확인 대기" : m.ok ? "해설 준비 완료" : "처리 실패", `${(d?.title as string) ?? ""}${m.error ? `: ${m.error}` : ""}`);
			},
		},
	});

	const docsRoot = join(pf.dataDir, "docs");
	const work = (docId: string) => new Work(lib.doc(docId).workDir);

	async function readerData(docId: string, rebuild = false): Promise<ReaderData> {
		const w = work(docId);
		const cached = w.path("reader.json");
		if (rebuild || !existsSync(cached)) await bridge.call("build_data", { work: w.dir, out: cached });
		return readJson<ReaderData>(cached);
	}

	function entryOf(data: ReaderData, pid: string): ReaderEntry {
		return data.guide[pid];
	}

	/** Re-run the checker on one paragraph's change; on errors, ask the writer once to fix just that entry. */
	async function regenEntry(docId: string, pid: string, prompt: string, model?: string) {
		const w = work(docId);
		const refsNow = await refs();
		const doc = w.paragraphs();
		const { docDump } = await import("./jobs/work");
		const brief = P.briefText(lib.getBrief(docId) ?? { purpose: "whole argument", familiarity: "", density: "medium", questions: [], notesLang: "ko" }, doc.title_guess ?? "");
		const s = lib.settings();
		const llm = llmFor(docId, w);
		const system = P.writerSystem(refsNow, lib.listRules());
		const context = docDump(doc);
		const r = await llm.call<{ paras: Record<string, unknown>[] }>({
			model: model ?? s.models.writer,
			system,
			context,
			prompt: prompt.replace("__BRIEF__", brief),
			schema: S.ENTRIES_SCHEMA,
			effort: "high",
			maxTokens: 32000,
			tag: `CHAT_regen_${pid}`,
		});
		const entries = w.entries();
		const prev = entries[pid];
		for (const e of r.value.paras ?? []) {
			const [id, entry] = toEntry(e);
			if (id !== pid) continue;
			// keep the deep-dive elements (figx) the regeneration did not touch
			const keep = (prev?.els ?? []).filter((x) => x.t === "figx" && !(entry.els ?? []).some((y) => y.t === "figx" && y.cap === x.cap));
			entry.els = [...(entry.els ?? []), ...keep];
			entries[id] = entry;
		}
		w.saveEntries(entries, w.guide().parts as { range: string }[]);
		const chk = await runner.runCheck(w);
		const mine = chk.errors.filter((e) => e.startsWith(pid + " ") || e.startsWith(pid + ":"));
		if (mine.length) {
			const fix = await llm.call<{ paras: Record<string, unknown>[] }>({
				model: model ?? s.models.writer,
				system,
				context,
				prompt: `${brief}\n\ncheck.py reported for ${pid}:\n${mine.join("\n")}\nCurrent entry: ${JSON.stringify(entries[pid])}\nReturn {"paras": [the corrected entry for ${pid}]}.`,
				schema: S.ENTRIES_SCHEMA,
				effort: "medium",
				maxTokens: 16000,
				tag: `CHAT_regenfix_${pid}`,
			});
			const e2 = w.entries();
			for (const e of fix.value.paras ?? []) {
				const [id, entry] = toEntry(e);
				if (id === pid) e2[id] = { ...entry, els: [...(entry.els ?? []), ...(e2[id]?.els ?? []).filter((x) => x.t === "figx")] };
			}
			w.saveEntries(e2, w.guide().parts as { range: string }[]);
		}
		const data = await readerData(docId, true);
		return entryOf(data, pid);
	}

	function reanchorAll(docId: string, data: ReaderData): StoredAnnotation[] {
		const items = Object.entries(data.items)
			.filter(([, it]) => it.type === "para" || it.type === "note" || it.type === "heading" || it.type === "caption")
			.map(([id, it]) => ({ id, sid: it.sid, text: it.text }));
		return lib.annotations(docId).map((a) => {
			const r = resolveAnnotation(a, items);
			const orphaned = !r;
			if (orphaned !== a.orphaned || (r && r.sid !== a.sid) || a.docRev !== data.doc_rev) lib.setAnnotationState(a.id, r?.sid ?? a.sid, orphaned, data.doc_rev ?? null);
			return { ...a, sid: r?.sid ?? a.sid, orphaned, resolved: r ? { pid: r.pid, start: r.start, end: r.end } : null };
		});
	}

	const chats = new Map<string, boolean>();

	const server = { origin: "", token: "" };
	const handlers: Handlers = {
		async serverInfo() {
			return server;
		},
		async pickPdfs() {
			return { paths: await pf.pickFiles() };
		},
		async importPdfs({ paths }) {
			const ids: string[] = [];
			for (const p of paths) {
				if (!p.toLowerCase().endsWith(".pdf") || !existsSync(p)) continue;
				ids.push(addPdf(basename(p), (dest) => copyFileSync(p, dest)));
			}
			pf.send("docsChanged", {});
			return { docIds: ids };
		},
		async probe({ docId }) {
			return bridge.call("probe", { pdf: lib.doc(docId).pdfPath });
		},
		async setBrief({ docId, brief }) {
			lib.setBrief(docId, brief);
			lib.setStage(docId, "BRIEFED", { status: "done", finishedAt: new Date().toISOString(), msg: brief.purpose });
			return { ok: true };
		},
		async getBrief({ docId }) {
			return lib.getBrief(docId);
		},
		async startJob({ docId, from }) {
			const notReady = llmReady();
			if (notReady) throw new Error(notReady);
			return { jobId: runner.start(docId, from) };
		},
		async cancelJob({ docId }) {
			runner.cancel(docId);
			return { ok: true };
		},
		async getJob({ docId }) {
			return runner.state(docId);
		},
		async setFixEnabled({ docId, index, enabled }) {
			const w = work(docId);
			const all = existsSync(w.path("fixes_all.json")) ? readJson<{ enabled?: boolean }[]>(w.path("fixes_all.json")) : [];
			if (all[index]) all[index].enabled = enabled;
			const { writeJson } = await import("./jobs/work");
			writeJson(w.path("fixes_all.json"), all);
			return { ok: true };
		},
		async reapplyFixes({ docId }) {
			// re-applying fixes renumbers paragraphs, so the guide must be written again from the FIXED stage
			const w = work(docId);
			for (const f of w.paraFiles()) rmSync(w.path(f));
			for (const f of ["guide.json", "reader.json", "findings.json"]) if (existsSync(w.path(f))) rmSync(w.path(f));
			runner.start(docId, "FIXED");
			return { ok: true };
		},
		async listDocs({ query, filters }) {
			return lib.listDocs(query, filters).map((d) => {
				const p = runner.progressOf(d.id);
				return { ...d, progress: p?.progress ?? null, progressMsg: p?.msg ?? null, queuePosition: runner.queuePosition(d.id) };
			});
		},
		async deleteDoc({ docId }) {
			runner.cancel(docId);
			const d = lib.doc(docId);
			const dir = resolve(d.workDir, "..");
			if (dir.startsWith(resolve(docsRoot))) rmSync(dir, { recursive: true, force: true });
			lib.deleteDocument(docId);
			pf.send("docsChanged", {});
			return { ok: true };
		},
		async getReader({ docId }) {
			const data = structuredClone(await readerData(docId));
			data.crops = Object.fromEntries(Object.entries(data.crops ?? {}).map(([k, v]) => [k, cropUrl(docId, v)]));
			return {
				data,
				fileBase: `/files/${docId}/`,
				pdfUrl: `/files/${docId}/source.pdf`,
				tierOverrides: lib.tierOverrides(docId),
				annotations: reanchorAll(docId, data),
			};
		},
		async setTier({ docId, pid, tier }) {
			const w = work(docId);
			const entries = w.entries();
			const e = entries[pid];
			if (!e) throw new Error(`${pid}에 해설이 없습니다`);
			const data = await readerData(docId);
			const sid = data.items[pid]?.sid;
			if (sid) lib.setTierOverride(docId, sid, tier);
			if (tier === "close" && e.tier !== "close") {
				// moving up to a close read: the writer adds read / note / elements for this paragraph
				return regenEntry(
					docId,
					pid,
					`__BRIEF__\n\nThe reader marked paragraph ${pid} as a close read (정독). Write its close-read entry: tier "close", role, read (what to watch for, no spoilers), note (after-reading summary), and 2-4 anchored elements (formula elements with tex, syms, x, steps, intuition where a formula is introduced). Current entry: ${JSON.stringify(e)}\nReturn {"paras": [one entry for ${pid}]}.`,
				);
			}
			e.tier = tier;
			if (tier === "skip" && !e.why) e.why = "독자가 생략 가능으로 표시";
			if (tier !== "close") delete e.read;
			w.saveEntries(entries, w.guide().parts as { range: string }[]);
			return entryOf(await readerData(docId, true), pid);
		},
		async regenerate({ docId, target, style }) {
			const w = work(docId);
			const e = w.entries()[target.pid];
			const extra =
				target.kind === "para"
					? ""
					: `Focus on element ${target.index + 1} (${target.kind}) and rewrite it ${style === "simpler" ? "more simply" : style === "deeper" ? "in more depth" : "again"}; keep the other elements as they are.`;
			return regenEntry(docId, target.pid, P.regenPrompt("__BRIEF__", target.pid, style, JSON.stringify(e ?? {}), extra));
		},
		async askAbout({ docId, pid, question, history }) {
			const streamId = newId("s_");
			const w = work(docId);
			const doc = w.paragraphs();
			const { docDump } = await import("./jobs/work");
			const llm = llmFor(docId, w);
			const entries = w.entries();
			const focus = pid ? `\n\nThe reader is looking at ${pid}:\n"""${doc.items.find((i) => i.id === pid)?.text ?? ""}"""\nGuide entry: ${JSON.stringify(entries[pid] ?? {})}` : "";
			chats.set(streamId, true);
			const s = lib.settings();
			void llm
				.streamText(
					{
						model: s.models.reviewer,
						system: P.chatSystem(await refs()),
						context: docDump(doc),
						prompt: `${question}${focus}`,
						history,
						effort: "medium",
						maxTokens: 8000,
						tag: "CHAT_ask",
					},
					(t) => pf.send("chatDelta", { streamId, text: t, done: false }),
				)
				.then(() => pf.send("chatDelta", { streamId, text: "", done: true }))
				.catch((e: Error) => pf.send("chatDelta", { streamId, text: "", done: true, error: e.message }))
				.finally(() => chats.delete(streamId));
			return { streamId };
		},
		async saveAnnotation({ docId, anno }) {
			const data = await readerData(docId);
			const items = Object.entries(data.items).map(([id, it]) => ({ id, sid: it.sid, text: it.text }));
			const frag = anno.target.selector.find((s) => s.type === "FragmentSelector") as { value: string } | undefined;
			const sid = frag?.value.replace(/^sid=/, "") ?? null;
			const r = resolveAnnotation({ target: anno.target, sid }, items);
			const saved = lib.saveAnnotation(docId, { ...anno, docRev: data.doc_rev }, r?.sid ?? sid, !r);
			return { ...saved, resolved: r ? { pid: r.pid, start: r.start, end: r.end } : null };
		},
		async deleteAnnotation({ id }) {
			lib.deleteAnnotation(id);
			return { ok: true };
		},
		async exportHtml({ docId, dir }) {
			const target = dir ?? (await pf.pickDir());
			if (!target) throw new Error("저장할 폴더를 선택하지 않았습니다");
			const d = lib.doc(docId);
			const safe = (d.title || "guide").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60);
			const out = join(target, `${safe}-guide.html`);
			await bridge.call("export_html", { work: d.workDir, out, lang: "ko" });
			return { path: out };
		},
		async showInFolder({ path }) {
			pf.showInFolder(path);
			return { ok: true };
		},
		async getSettings() {
			let engineOk = false;
			try {
				const r = await bridge.call<{ version: string; python: string }>("ping");
				engineOk = true;
				engineInfo = `pdfx ${r.version}, Python ${r.python} | ${engineInfo.split(" | ").slice(-1)[0]}`;
			} catch (e) {
				engineInfo = `엔진 오류: ${(e as Error).message.slice(0, 300)}`;
			}
			const s = lib.settings();
			const bin = locateClaude(s.claudePath);
			const ver = bin ? claudeVersion(bin) : null;
			return { ...s, hasApiKey: secrets.has(), hasOllamaKey: ollamaSecrets.has(), engineOk, engineInfo, claudeOk: !!ver, claudeInfo: ver ? `${ver} (${bin})` : "claude 명령을 찾지 못했습니다" };
		},
		async setSettings({ settings }) {
			lib.setSettings(settings);
			return { ok: true };
		},
		async setApiKey({ key }) {
			secrets.set(key && key.trim() ? key.trim() : null);
			return { ok: true, hasApiKey: secrets.has() };
		},
		async listOllamaModels() {
			try {
				return { models: await listOllamaModels(lib.settings().ollama.baseUrl, ollamaSecrets.get()) };
			} catch (e) {
				return { models: [], error: (e as Error).message };
			}
		},
		async setOllamaKey({ key }) {
			ollamaSecrets.set(key && key.trim() ? key.trim() : null);
			return { ok: true, hasOllamaKey: ollamaSecrets.has() };
		},
		async listRules() {
			return lib.listRules();
		},
		async addRule({ scope, text }) {
			return lib.addRule(scope, text);
		},
		async deleteRule({ id }) {
			lib.deleteRule(id);
			return { ok: true };
		},
		async rateExplanation({ docId, pid, stars, comment }) {
			lib.addRating(docId, pid, stars, comment);
			return { ok: true };
		},
	};

	/** Files of a document for the webview: the PDF, crops, page images. Only paths inside the doc folder. */
	/** Create a library document from a PDF; `write` puts the bytes at the given destination path. */
	function addPdf(fileName: string, write: (dest: string) => void) {
		const id = newId("d_");
		const dir = join(docsRoot, id);
		mkdirSync(join(dir, "work"), { recursive: true });
		const pdf = join(dir, "source.pdf");
		write(pdf);
		lib.addDocument({ id, title: fileName.replace(/\.pdf$/i, ""), fileName, pdfPath: pdf, workDir: join(dir, "work") });
		lib.setStage(id, "IMPORTED", { status: "done", finishedAt: new Date().toISOString(), msg: fileName });
		return id;
	}

	/** Import a PDF whose bytes came from the webview (drag & drop: WKWebView gives no file path). */
	function importPdfBytes(name: string, bytes: Uint8Array): string | null {
		const fileName = basename(name || "document.pdf");
		const isPdf = bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-");
		if (!isPdf) return null;
		const id = addPdf(/\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`, (dest) => writeFileSync(dest, bytes));
		pf.send("docsChanged", {});
		return id;
	}

	function serveFile(docId: string, rel: string): Response {
		const row = lib.docRow(docId);
		if (!row) return new Response("not found", { status: 404 });
		const root = resolve(String(row.work_dir), "..");
		const target = rel === "source.pdf" ? join(root, "source.pdf") : resolve(root, "work", rel);
		if (!target.startsWith(root) || !existsSync(target)) return new Response("not found", { status: 404 });
		return new Response(Bun.file(target));
	}

	/** Absolute crop paths in reader data -> URLs relative to the doc's file base. */
	function cropUrl(docId: string, abs: string) {
		const row = lib.docRow(docId);
		const root = resolve(String(row?.work_dir ?? ""));
		return abs.startsWith(root) ? `/files/${docId}/${abs.slice(root.length + 1)}` : abs;
	}

	// Jobs live in memory: papers that were queued or processing when the app quit start again
	// (from their last finished stage) the next time it opens.
	for (const d of lib.listDocs()) {
		if (d.status === "queued" || d.status === "processing") runner.start(d.id);
	}

	const stop = () => {
		bridge.stop();
		jobBridge.stop();
	};

	const setServer = (origin: string, token: string) => Object.assign(server, { origin, token });
	return { handlers, setServer, lib, bridge, jobBridge, stop, runner, serveFile, importPdfBytes, cropUrl, settingsDefault: DEFAULT_SETTINGS, readFileSync };
}

export type Backend = ReturnType<typeof createBackend>;
