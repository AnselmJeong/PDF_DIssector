import katex from "katex";
import { useMemo } from "react";

// Inline $...$ in guide text (schema.md): a span starting with a digit and containing spaces is money, not math.
const INLINE = /\$(?![\s$])([^$\n]+?)(?<!\s)\$/g;
const isMath = (inner: string) => !/^\d/.test(inner) || /[\\_^=<>()]/.test(inner) || !/\s/.test(inner);

export function tex(src: string, display = false) {
	try {
		return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: "ignore", output: "html" });
	} catch {
		return src;
	}
}

export function MathText({ text, className }: { text: string; className?: string }) {
	const parts = useMemo(() => {
		const out: { kind: "t" | "m"; v: string }[] = [];
		let last = 0;
		for (const m of text.matchAll(INLINE)) {
			if (!isMath(m[1])) continue;
			if (m.index! > last) out.push({ kind: "t", v: text.slice(last, m.index) });
			out.push({ kind: "m", v: m[1] });
			last = m.index! + m[0].length;
		}
		if (last < text.length) out.push({ kind: "t", v: text.slice(last) });
		return out;
	}, [text]);
	return (
		<span className={className}>
			{parts.map((p, i) => (p.kind === "t" ? <span key={i}>{p.v}</span> : <span key={i} dangerouslySetInnerHTML={{ __html: tex(p.v) }} />))}
		</span>
	);
}

export function TexBlock({ src }: { src: string }) {
	const html = useMemo(() => tex(src, true), [src]);
	return <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />;
}
