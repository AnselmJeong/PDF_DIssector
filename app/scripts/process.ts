// Process one PDF end to end with the configured Claude backend (default: Claude Code subscription), headless.
//   bun scripts/process.ts <pdf> [--data DIR] [--purpose "whole argument"] [--question "..."]
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createBackend } from "../src/bun/backend";
import { STAGE_LABEL } from "../src/shared/types";

const arg = (n: string, d: string) => {
	const i = process.argv.indexOf(n);
	return i > 0 ? process.argv[i + 1] : d;
};
const pdf = resolve(process.argv[2]);
const dataDir = resolve(arg("--data", join(homedir(), ".pdf-dissector-dev")));
const be = createBackend({
	dataDir,
	pickFiles: async () => [],
	pickDir: async () => dataDir,
	showInFolder: () => {},
	notify: (t, b) => console.log(`[notify] ${t} ${b}`),
	send: (name, p) => {
		if (name === "jobProgress") {
			const m = p as { stage: keyof typeof STAGE_LABEL; status: string; msg: string; costUsd: number };
			console.log(`${new Date().toLocaleTimeString("ko-KR")} ${STAGE_LABEL[m.stage]} [${m.status}] ${m.msg} ($${m.costUsd.toFixed(3)})`);
		}
	},
});
const q = arg("--question", "");
const { docIds } = await be.handlers.importPdfs({ paths: [pdf] });
const docId = docIds[0];
await be.handlers.setBrief({
	docId,
	brief: { purpose: arg("--purpose", "whole argument") as never, familiarity: "분야는 알지만 이 논문은 처음", density: "medium", questions: q ? [q] : [], notesLang: "ko" },
});
await be.handlers.startJob({ docId });
while ((await be.handlers.getJob({ docId })).running) await Bun.sleep(1000);
const st = await be.handlers.getJob({ docId });
console.log("\n" + st.stages.map((s) => `${s.stage}: ${s.status} ${s.msg ?? ""}`).join("\n"));
console.log(`docId ${docId}`);
be.bridge.stop();
process.exit(0);
