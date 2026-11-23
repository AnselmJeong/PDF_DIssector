import { useMemo, useState } from "react";
import { L } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { ReaderData } from "../../../shared/types";

const REL_KO: Record<string, string> = {
	supports: "뒷받침",
	explains: "설명",
	qualifies: "단서",
	extends: "확장",
	frames: "틀 제시",
	challenges: "반박",
	answers: "응답",
	concludes: "결론",
	"rules out": "배제",
	implies: "함의",
	names: "명명",
	raises: "제기",
};
export const relKo = (r?: string) => (r ? (REL_KO[r] ?? r) : "");

/** Thesis on top, parts in layers by their distance to the thesis along the first relation (template.html layoutMap). */
export function ArgumentMap({ data, onPick, current }: { data: ReaderData; onPick: (partId: string) => void; current?: string | null }) {
	const [guess, setGuess] = useState(false);
	const live = data.parts.filter((p) => !p.skip);
	const layout = useMemo(() => {
		const depth: Record<string, number> = {};
		const first = (id: string) => data.logic.rels[id]?.[0]?.to;
		for (const p of live) {
			let d = 1;
			let cur = first(p.id);
			const seen = new Set([p.id]);
			while (cur && cur !== "T" && !seen.has(cur)) {
				seen.add(cur);
				d++;
				cur = first(cur);
			}
			depth[p.id] = d;
		}
		const layers: string[][] = [];
		for (const p of live) (layers[depth[p.id] - 1] ??= []).push(p.id);
		// at most 5 nodes per row: a long layer wraps onto extra rows
		const rows: string[][] = [];
		for (const layer of layers.filter(Boolean)) for (let i = 0; i < layer.length; i += 5) rows.push(layer.slice(i, i + 5));
		const W = 860;
		const nodeW = 150;
		const rowH = 92;
		const pos: Record<string, { x: number; y: number }> = { T: { x: W / 2, y: 34 } };
		rows.forEach((row, r) => {
			const gap = W / (row.length + 1);
			row.forEach((id, i) => (pos[id] = { x: gap * (i + 1), y: 34 + rowH * (r + 1) }));
		});
		return { pos, height: 34 + rowH * (rows.length + 1) - 30, nodeW, W };
	}, [data, live]);
	if (!live.length) return null;
	const { pos, height, nodeW, W } = layout;
	const edges = live.flatMap((p) => (data.logic.rels[p.id] ?? []).map((r, k) => ({ from: p.id, to: r.to, type: r.type, label: L(r.label), primary: k === 0 })));
	const thesis = L(data.thesis);
	return (
		<div className="rounded-xl border bg-card p-3">
			<div className="mb-1 flex items-center justify-between">
				<div className="text-xs font-medium text-muted-foreground">논증 지도 · 부분을 누르면 해당 위치로 갑니다</div>
				<button className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setGuess(!guess)}>
					{guess ? "관계 보기" : "관계 먼저 추측하기"}
				</button>
			</div>
			<svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="논증 지도">
				<defs>
					<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
						<path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground" />
					</marker>
				</defs>
				{edges.map((e, i) => {
					const a = pos[e.from];
					const b = pos[e.to];
					if (!a || !b) return null;
					const my = (a.y + b.y) / 2;
					return (
						<g key={i} opacity={e.primary ? 1 : 0.55}>
							<path
								d={`M${a.x},${a.y - 22} C${a.x},${my} ${b.x},${my} ${b.x},${b.y + 22}`}
								fill="none"
								className="stroke-muted-foreground"
								strokeWidth={1.3}
								strokeDasharray={e.type === "qualifies" || e.type === "challenges" ? "5 4" : undefined}
								markerEnd="url(#arr)"
							>
								<title>{`${relKo(e.type)}${e.label ? `: ${e.label}` : ""}`}</title>
							</path>
							{!guess && (
								<text x={(a.x + b.x) / 2} y={my} textAnchor="middle" className="fill-muted-foreground text-[11px]">
									{relKo(e.type)}
								</text>
							)}
						</g>
					);
				})}
				<foreignObject x={W / 2 - 260} y={6} width={520} height={56}>
					<div className="flex h-full items-center justify-center rounded-lg bg-primary px-3 text-center text-[13px] leading-snug font-medium text-primary-foreground">
						<span className="line-clamp-2">{thesis}</span>
					</div>
				</foreignObject>
				{live.map((p) => {
					const q = pos[p.id];
					if (!q) return null;
					return (
						<foreignObject key={p.id} x={q.x - nodeW / 2} y={q.y - 22} width={nodeW} height={46}>
							<button
								onClick={() => onPick(p.id)}
								className={cn(
									"flex h-full w-full items-center justify-center rounded-lg border bg-background px-2 text-center text-[12px] leading-tight hover:border-primary",
									current === p.id && "border-primary ring-2 ring-primary/30",
								)}
								title={L(p.claim)}
							>
								<span className="line-clamp-2">{L(p.title)}</span>
							</button>
						</foreignObject>
					);
				})}
			</svg>
		</div>
	);
}
