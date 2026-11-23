// End-to-end: real pdfx engine (segment, overlay, check, build_data, export), replayed LLM answers.
// The LLM double answers each stage from the prompt, so the test is deterministic and costs nothing.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackend } from "../src/bun/backend";
import { Work } from "../src/bun/jobs/work";
import type { CallSpec } from "../src/bun/llm/client";
import { ReplayClient } from "../src/bun/llm/client";
import { locateEngine } from "../src/bun/pipeline/bridge";

let dir: string;
let pdf: string;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "pdfx-e2e-"));
	pdf = join(dir, "sample.pdf");
	const loc = locateEngine();
	// the engine's own test helper writes a small born-digital PDF
	const r = Bun.spawnSync(
		[loc.python, "-c", `import sys; sys.path.insert(0, "tests"); from conftest import _pdf_bytes; open(sys.argv[1], "wb").write(_pdf_bytes([[(60, 700 - 20 * k, t) for k, t in enumerate(["Patients were randomly assigned to drug or placebo in a 1:1 ratio.", "The primary outcome was death at 12 months.", "The hazard ratio was 0.72 (95% CI 0.55 to 0.94)."])] + [(200, 560, "HR = h1 / h0 (1)")] for _ in range(2)]))`, pdf],
		{ cwd: loc.engineDir },
	);
	if (r.exitCode !== 0) throw new Error(r.stderr.toString());
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function answer(spec: CallSpec): unknown {
	const tag = spec.tag;
	if (tag.includes("inspect")) return { fixes: [], summary: "문제 없음" };
	if (tag.includes("understand")) {
		const n = Number(/all (\d+) paragraphs/.exec(spec.prompt)?.[1] ?? 1);
		return {
			genre: "Randomised controlled trial (CONSORT)",
			design_checkpoints: ["1차 결과 지표"],
			title: "Drug versus placebo",
			author: "Kim et al.",
			source: "Test Journal, 2026",
			thesis: "약물은 12개월 사망 위험을 낮췄다.",
			overview: "무작위 배정 시험이다. 위험비는 0.72였다.",
			parts: [
				{ id: "S1", title: "결과", range: `P1-P${n}`, role: "근거", claim: "위험비 0.72로 사망이 줄었다.", claim_p: "P1", rel: [{ to: "T", type: "supports", label: "" }], flow: [{ p: "P1", x: "무작위 배정" }, { p: `P${n}`, rel: "supports", x: "효과" }], recall: [{ q: "위험비는?", a: "0.72" }] },
			],
			questions: [],
			close_candidates: ["P1"],
		};
	}
	if (tag.includes("annotate")) {
		const ids = /in order: ([^.\n]+)\./.exec(spec.prompt)![1].split(", ");
		return {
			paras: ids.map((id, i) =>
				i === 0
					? { id, tier: "close", role: "무작위 배정", read: "배정 비율을 보세요.", note: "환자는 1:1로 약물 또는 위약에 배정되었다.", els: [{ t: "design", a: "randomly assigned to drug or placebo", s: "1:1 무작위 배정" }] }
					: { id, tier: "skim", role: `문단 ${id}`, note: "1차 결과는 12개월 사망이고 위험비는 0.72였다.", els: [] },
			),
		};
	}
	if (tag.includes("formula")) return { tex: "HR = h_1/h_0", syms: [{ s: "h_1", m: "약물군 위험" }], x: "두 군의 위험 비율", steps: [{ part: "h_1", x: "약물군 위험" }], intuition: "1보다 작으면 위험 감소" };
	if (tag.includes("figx")) return { what: "?", panels: [], look_for: ["x"], takeaway: "y", approx: false };
	if (tag.includes("review") || tag.includes("confirm")) return { findings: [], summary: "0" };
	if (tag.includes("patch") || tag.includes("fix_findings")) return { paras: [], notes: "" };
	if (tag.includes("CHAT_ask")) return "원문: \"The hazard ratio was 0.72\". 설명: 위험이 28% 줄었다는 뜻입니다.";
	throw new Error(`unexpected LLM call ${tag}`);
}

test(
	"import -> brief -> job -> reader data -> tier change -> annotation -> export",
	async () => {
		process.env.PDFX_NO_KEYCHAIN = "1";
		const sent: { name: string; payload: unknown }[] = [];
		const be = createBackend({
			dataDir: join(dir, "data"),
			pickFiles: async () => [pdf],
			pickDir: async () => dir,
			showInFolder: () => {},
			notify: () => {},
			send: (name, payload) => sent.push({ name, payload }),
		});
		const replay = new ReplayClient(answer);
		// swap the LLM for the replay double
		(be.runner as unknown as { d: { llm: () => ReplayClient } }).d.llm = () => replay;
		await be.handlers.setApiKey({ key: "test-key" });
		const h = be.handlers;

		const { docIds } = await h.importPdfs({ paths: [pdf] });
		const docId = docIds[0];
		const probe = await h.probe({ docId });
		expect(probe.pages).toBe(2);
		await h.setBrief({ docId, brief: { purpose: "whole argument", familiarity: "", density: "high", questions: [], notesLang: "ko" } });
		await h.startJob({ docId });
		const t0 = Date.now();
		while (Date.now() - t0 < 120_000) {
			const st = await h.getJob({ docId });
			if (!st.running) break;
			await Bun.sleep(300);
		}
		const job = await h.getJob({ docId });
		const failed = job.stages.find((s) => s.status === "failed");
		expect(failed?.msg ?? null).toBeNull();
		expect(job.stages.find((s) => s.stage === "RENDERED")?.status).toBe("done");
		expect(sent.some((m) => m.name === "jobDone" && (m.payload as { ok: boolean }).ok)).toBe(true);

		const reader = await h.getReader({ docId });
		expect(reader.data.default_lang).toBe("ko");
		expect(reader.data.check.errors).toEqual([]);
		expect(reader.data.guide.P1.tier).toBe("close");
		expect(reader.data.guide.P1.els[0].hl).toBeDefined();
		const docs = await h.listDocs({});
		expect(docs[0].status).toBe("done");
		expect(docs[0].genre).toContain("CONSORT");

		// tier down (no LLM call) and back up (LLM rewrites the entry)
		const e2 = await h.setTier({ docId, pid: "P2", tier: "skip" });
		expect(e2.tier).toBe("skip");

		// annotation survives a rebuild and is resolved to its paragraph
		const text = reader.data.items.P1.text;
		const start = text.indexOf("drug or placebo");
		const saved = await h.saveAnnotation({
			docId,
			anno: {
				type: "Annotation",
				motivation: "commenting",
				body: [{ type: "TextualBody", value: "메모", format: "text/markdown" }],
				target: {
					source: `doc:${docId}`,
					selector: [
						{ type: "TextQuoteSelector", exact: "drug or placebo", prefix: text.slice(Math.max(0, start - 32), start), suffix: "" },
						{ type: "TextPositionSelector", start, end: start + 15 },
						{ type: "FragmentSelector", value: `sid=${reader.data.items.P1.sid}` },
					],
				},
			},
		});
		expect(saved.resolved?.pid).toBe("P1");
		const again = await h.getReader({ docId });
		expect(again.annotations[0].orphaned).toBe(false);

		// file server path guard
		expect(be.serveFile(docId, "../../../etc/passwd").status).toBe(404);
		expect(be.serveFile(docId, "source.pdf").status).toBe(200);

		const out = await h.exportHtml({ docId, dir });
		expect(existsSync(out.path)).toBe(true);
		const work = new Work(be.lib.doc(docId).workDir);
		expect(existsSync(work.path("llm_log"))).toBe(false); // replay client writes no logs
		be.bridge.stop();
	},
	{ timeout: 180_000 },
);
