// Download the corpus PDFs listed in manifest.json into corpus/pdfs/ (skips files already present).
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dir;
const manifest = await Bun.file(join(dir, "manifest.json")).json();
mkdirSync(join(dir, "pdfs"), { recursive: true });
for (const p of manifest.papers) {
	const out = join(dir, "pdfs", `${p.id}.pdf`);
	if (existsSync(out)) continue;
	const r = await fetch(p.url, { headers: { "User-Agent": "pdf-dissector-corpus/0.1" } });
	const buf = new Uint8Array(await r.arrayBuffer());
	if (!r.ok || String.fromCharCode(...buf.slice(0, 4)) !== "%PDF") {
		console.error(`${p.id}: not a PDF (${r.status})`);
		continue;
	}
	await Bun.write(out, buf);
	console.log(`${p.id}: ${buf.length} bytes`);
}
