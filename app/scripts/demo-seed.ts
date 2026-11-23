// Seed a data folder with one processed document using a heuristic stand-in for the LLM (no API calls).
// For UI development only: the guide text is placeholder text built from the paper itself.
//   bun scripts/demo-seed.ts <pdf> [--data DIR]
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createBackend } from "../src/bun/backend";
import { ReplayClient, type CallSpec } from "../src/bun/llm/client";
import { Work } from "../src/bun/jobs/work";

const pdf = resolve(process.argv[2]);
const di = process.argv.indexOf("--data");
const dataDir = resolve(di > 0 ? process.argv[di + 1] : join(homedir(), ".pdf-dissector-dev"));
process.env.PDFX_NO_KEYCHAIN = "1";
const be = createBackend({ dataDir, pickFiles: async () => [], pickDir: async () => dataDir, showInFolder: () => {}, notify: () => {}, send: () => {} });
let work: Work | null = null;
const firstSentence = (t: string) => (t.match(/^.{20,160}?[.!?](?=\s|$)/)?.[0] ?? t.slice(0, 80)).trim();

function answer(spec: CallSpec): unknown {
	const doc = work!.paragraphs();
	const paras = doc.items.filter((i) => i.type === "para");
	const tag = spec.tag;
	if (tag.includes("inspect")) return { fixes: [], summary: "demo" };
	if (tag.includes("understand")) {
		const n = paras.length;
		const k = Math.ceil(n / 4);
		const parts = [0, 1, 2, 3].map((i) => ({
			id: `S${i + 1}`,
			title: ["서론과 배경", "연구 설계", "분석 계획", "논의"][i],
			range: `P${i * k + 1}-P${Math.min(n, (i + 1) * k)}`,
			role: "데모",
			claim: ["연구 질문을 제시한다", "무작위 배정 설계를 쓴다", "결과 지표와 분석을 정한다", "한계와 의의를 논한다"][i],
			claim_p: `P${i * k + 1}`,
			rel: [{ to: "T", type: i === 3 ? "qualifies" : "supports" }],
			flow: [{ p: `P${i * k + 1}`, x: "첫 단계" }, { p: `P${Math.min(n, i * k + 2)}`, rel: "explains", x: "둘째 단계" }],
			recall: [{ q: "이 부분의 핵심은?", a: "데모 답변" }],
		})).filter((p) => Number(p.range.split("-P")[0].slice(1)) <= n);
		return { genre: "Randomised controlled trial (CONSORT) (데모)", design_checkpoints: [], title: doc.title_guess, author: "", source: "", thesis: "데모 결론: 실제 해설은 API 키를 넣고 처리하면 생성됩니다.", overview: "이 문서는 UI 확인용 데모 데이터입니다.", parts, questions: [], close_candidates: [] };
	}
	if (tag.includes("annotate")) {
		const ids = /in order: ([^.\n]+)\./.exec(spec.prompt)![1].split(", ");
		return {
			paras: ids.map((id) => {
				const it = paras.find((p) => p.id === id)!;
				const close = Number(id.slice(1)) % 4 === 1;
				return close
					? { id, tier: "close", role: "정독 데모", read: "이 문단의 주장과 근거를 확인하세요.", note: "읽은 뒤 요약 데모입니다.", els: [{ t: "claim", a: firstSentence(it.text), s: "핵심 문장", x: "이 문단의 첫 문장이 주장을 담습니다." }] }
					: { id, tier: Number(id.slice(1)) % 7 === 0 ? "skip" : "skim", role: "훑어보기 데모", note: "요약 데모: 이 문단은 맥락을 제공합니다.", why: "데모", els: [] };
			}),
		};
	}
	if (tag.includes("formula")) return { tex: "\\mathrm{HR} = \\frac{h_1(t)}{h_0(t)}", syms: [{ s: "h_1", m: "치료군 위험" }], x: "두 군 위험의 비", steps: [{ part: "h_1(t)", x: "시점 t의 치료군 위험" }], intuition: "1보다 작으면 위험 감소", illustrative: "예를 들어 위험이 절반이 되면 위험비는 0.5입니다." };
	if (tag.includes("figx")) return { what: "이 그림이 답하는 질문(데모)", panels: [], axes: "축 설명 데모", look_for: ["볼 것 1", "볼 것 2"], takeaway: "결론 데모", caveat: "한계 데모", approx: false, s: "그림 데모" };
	if (tag.includes("review") || tag.includes("confirm")) return { findings: [{ where: "S1 claim", severity: "minor", problem: "데모 지적", fix: "데모 수정" }], summary: "1" };
	if (tag.includes("patch") || tag.includes("fix_findings")) return { paras: [], notes: "" };
	return "데모";
}

const replay = new ReplayClient(answer);
(be.runner as unknown as { d: { llm: (id: string, w: Work) => ReplayClient } }).d.llm = (_id, w) => {
	work = w;
	return replay;
};
await be.handlers.setApiKey({ key: "demo" });
await be.handlers.setSettings({ settings: { acceptedDataNotice: true } });
const { docIds } = await be.handlers.importPdfs({ paths: [pdf] });
await be.handlers.setBrief({ docId: docIds[0], brief: { purpose: "whole argument", familiarity: "", density: "medium", questions: ["1차 결과 지표는?"], notesLang: "ko" } });
await be.handlers.startJob({ docId: docIds[0] });
while ((await be.handlers.getJob({ docId: docIds[0] })).running) await Bun.sleep(500);
const st = await be.handlers.getJob({ docId: docIds[0] });
console.log(st.stages.map((s) => `${s.stage}: ${s.status} ${s.msg ?? ""}`).join("\n"));
be.bridge.stop();
process.exit(0);
