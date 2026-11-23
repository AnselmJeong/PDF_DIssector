import { useState } from "react";
import { FlaskConical, ImageIcon, Sigma } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fileUrl } from "@/lib/rpc";
import { L } from "@/lib/store";
import type { ReaderData, ReaderElement } from "../../../shared/types";
import { MathText, TexBlock } from "./MathText";

export function Zoomable({ src, alt, className }: { src: string; alt: string; className?: string }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<img src={fileUrl(src)} alt={alt} className={className ?? "max-h-72 cursor-zoom-in rounded border bg-white object-contain"} onClick={() => setOpen(true)} loading="lazy" />
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-h-[92vh] overflow-auto sm:max-w-5xl">
					<DialogTitle className="sr-only">{alt}</DialogTitle>
					<img src={fileUrl(src)} alt={alt} className="w-full bg-white" />
				</DialogContent>
			</Dialog>
		</>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div>
			<div className="mb-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground">{title}</div>
			<div className="text-sm leading-relaxed">{children}</div>
		</div>
	);
}

/** Formula card: KaTeX + PDF crop + symbol table + step-by-step explanation (plan section 6.3). */
export function FormulaCard({ el, crop }: { el: ReaderElement; crop?: string | null }) {
	const has = (v?: unknown) => !!v && (!(typeof v === "object") || Object.keys(v as object).length > 0);
	return (
		<div className="rounded-lg border border-[color:var(--hl-math)] bg-card p-3" data-testid="formula-card">
			<div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
				<Sigma className="size-3.5" /> 수식 {L(el.s) && <span className="text-muted-foreground">· {L(el.s)}</span>}
			</div>
			<Tabs defaultValue="explain">
				<TabsList className="h-8">
					<TabsTrigger value="explain" className="text-xs">
						해설
					</TabsTrigger>
					{el.steps?.length ? (
						<TabsTrigger value="steps" className="text-xs">
							단계별
						</TabsTrigger>
					) : null}
					{crop && (
						<TabsTrigger value="crop" className="text-xs">
							원본 crop
						</TabsTrigger>
					)}
					{el.tex && (
						<TabsTrigger value="latex" className="text-xs">
							LaTeX
						</TabsTrigger>
					)}
				</TabsList>
				<TabsContent value="explain" className="space-y-3 pt-2">
					{el.tex && <TexBlock src={el.tex} />}
					{has(el.x) && (
						<Section title="말로 풀면">
							<MathText text={L(el.x)} />
						</Section>
					)}
					{has(el.intuition) && (
						<Section title="직관">
							<MathText text={L(el.intuition)} />
						</Section>
					)}
					{el.syms?.length ? (
						<Section title="기호">
							<table className="w-full text-sm">
								<tbody>
									{el.syms.map((s, i) => (
										<tr key={i} className="border-b last:border-0">
											<td className="w-28 py-1 pr-3 align-top">
												<MathText text={s.s.includes("\\") || s.s.length < 4 ? `$${s.s}$` : s.s} />
											</td>
											<td className="py-1">
												<MathText text={L(s.m)} />
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</Section>
					) : null}
					{has(el.units) && (
						<Section title="단위·차원">
							<MathText text={L(el.units)} />
						</Section>
					)}
					{has(el.why) && (
						<Section title="논증에서의 역할">
							<MathText text={L(el.why)} />
						</Section>
					)}
					{has(el.clinical) && (
						<Section title="결과 해석에 쓰는 법">
							<MathText text={L(el.clinical)} />
						</Section>
					)}
					{has(el.illustrative) && (
						<div className="rounded-md border border-dashed border-amber-500/60 bg-amber-500/5 p-2.5">
							<Badge variant="outline" className="mb-1 border-amber-500/60 text-[10px] text-amber-700 dark:text-amber-400">
								설명용 가상 예시 · 원문 수치 아님
							</Badge>
							<div className="text-sm">
								<MathText text={L(el.illustrative)} />
							</div>
						</div>
					)}
				</TabsContent>
				{el.steps?.length ? (
					<TabsContent value="steps" className="space-y-2 pt-2">
						{el.steps.map((s, i) => (
							<div key={i} className="grid grid-cols-[minmax(90px,auto)_1fr] items-start gap-3 rounded border p-2">
								<TexBlock src={s.part} />
								<div className="text-sm">
									<MathText text={L(s.x)} />
								</div>
							</div>
						))}
					</TabsContent>
				) : null}
				{crop && (
					<TabsContent value="crop" className="pt-2">
						<Zoomable src={crop} alt="PDF에서 잘라 낸 수식" />
						<p className="mt-1 text-xs text-muted-foreground">PDF 원본과 KaTeX 전사를 대조해 보세요.</p>
					</TabsContent>
				)}
				{el.tex && (
					<TabsContent value="latex" className="pt-2">
						<pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{el.tex}</pre>
					</TabsContent>
				)}
			</Tabs>
		</div>
	);
}

/** Figure/table card: image (open version, crop or page), walkthrough by panel, what to look for, takeaway. */
export function FigureCard({ capId, data, el, fileBase, crops }: { capId: string; data: ReaderData; el?: ReaderElement; fileBase: string; crops: string[] }) {
	const cap = data.items[capId];
	const open = data.open.assets[capId];
	const img = open?.img ?? crops[0] ?? `${fileBase}pages/fig_${capId}.png`;
	const [imgOk, setImgOk] = useState(true);
	const isTable = /^\s*tab/i.test(cap?.text ?? "");
	return (
		<figure className="rounded-lg border bg-card p-3" data-testid="figure-card" id={`fig-${capId}`}>
			<div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
				{isTable ? <FlaskConical className="size-3.5" /> : <ImageIcon className="size-3.5" />}
				{isTable ? "표" : "그림"} {el?.s && <span className="text-muted-foreground">· {L(el.s)}</span>}
				{el?.approx && (
					<Badge variant="outline" className="ml-1 text-[10px]">
						그래프에서 읽은 근삿값 포함
					</Badge>
				)}
			</div>
			<Tabs defaultValue={el ? "guide" : "image"}>
				<TabsList className="h-8">
					{el && (
						<TabsTrigger value="guide" className="text-xs">
							해설
						</TabsTrigger>
					)}
					{el?.panels?.length ? (
						<TabsTrigger value="panels" className="text-xs">
							패널별
						</TabsTrigger>
					) : null}
					<TabsTrigger value="image" className="text-xs">
						원본
					</TabsTrigger>
					{open?.rows?.length ? (
						<TabsTrigger value="rows" className="text-xs">
							표 데이터(PMC)
						</TabsTrigger>
					) : null}
				</TabsList>
				{el && (
					<TabsContent value="guide" className="space-y-3 pt-2">
						{L(el.what) && (
							<Section title="이 그림이 답하는 질문">
								<MathText text={L(el.what)} />
							</Section>
						)}
						{L(el.axes) && (
							<Section title="축·범례 읽는 법">
								<MathText text={L(el.axes)} />
							</Section>
						)}
						{el.look_for?.length ? (
							<Section title="이 그림에서 볼 것">
								<ul className="list-disc space-y-0.5 pl-5">
									{el.look_for.map((x, i) => (
										<li key={i}>
											<MathText text={L(x)} />
										</li>
									))}
								</ul>
							</Section>
						) : null}
						{L(el.takeaway) && (
							<Section title="결론">
								<MathText text={L(el.takeaway)} />
							</Section>
						)}
						{L(el.caveat) && (
							<Section title="이 그림이 보여 주지 못하는 것">
								<MathText text={L(el.caveat)} />
							</Section>
						)}
					</TabsContent>
				)}
				{el?.panels?.length ? (
					<TabsContent value="panels" className="space-y-1.5 pt-2">
						{el.panels.map((p, i) => (
							<div key={i} className="flex gap-2 text-sm">
								<Badge variant="secondary" className="h-5 shrink-0">
									{p.label}
								</Badge>
								<MathText text={L(p.x)} />
							</div>
						))}
					</TabsContent>
				) : null}
				<TabsContent value="image" className="pt-2">
					{imgOk ? (
						<img
							src={fileUrl(img)}
							alt={cap?.text.slice(0, 80) ?? capId}
							className="max-h-[28rem] w-full rounded border bg-white object-contain"
							onError={() => setImgOk(false)}
							loading="lazy"
						/>
					) : (
						<p className="text-xs text-muted-foreground">이미지가 없습니다. 오른쪽 PDF 패널에서 {cap?.page}쪽을 보세요.</p>
					)}
				</TabsContent>
				{open?.rows?.length ? (
					<TabsContent value="rows" className="pt-2">
						<div className="max-h-96 overflow-auto">
							<table className="w-full text-xs">
								<tbody>
									{open.rows.map((r, i) => (
										<tr key={i} className="border-b">
											{r.map((c, j) => (
												<td key={j} className="px-1.5 py-1 align-top">
													{c}
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</TabsContent>
				) : null}
			</Tabs>
			{cap && <figcaption className="orig mt-2 text-[0.9rem] leading-snug text-muted-foreground">{cap.text}</figcaption>}
		</figure>
	);
}
