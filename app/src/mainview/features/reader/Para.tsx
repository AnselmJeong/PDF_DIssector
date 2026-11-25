import { memo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, MessageCircleQuestion, MoreHorizontal, RefreshCw, Sparkles, Star, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Rating } from "@/components/reui/rating";
import { L } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { ReaderData, ReaderEntry, ReaderItem, RegenStyle, StoredAnnotation, Tier } from "../../../shared/types";
import { FigureCard, FormulaCard, Zoomable } from "./Cards";
import { MathText } from "./MathText";

export type ViewMode = "full" | "study" | "gist";

export interface ParaProps {
	pid: string;
	item: ReaderItem;
	entry?: ReaderEntry;
	data: ReaderData;
	fileBase: string;
	mode: ViewMode;
	threeTier: boolean;
	notes: StoredAnnotation[];
	figCaps: string[]; // captions hosted by this paragraph
	capCrops: Record<string, string[]>;
	fragCrops: string[];
	busy: boolean;
	active: boolean;
	expanded: boolean;
	onToggleExpand: () => void;
	onTier: (t: Tier) => void;
	onRegen: (style: RegenStyle, target?: { kind: "formula" | "figure"; index: number }) => void;
	onAsk: () => void;
	onRate: (stars: number) => void;
	onFocus: () => void;
	onNoteClick: (a: StoredAnnotation) => void;
}

const TIER_UI: Record<Tier, { label: string; cls: string }> = {
	close: { label: "정독", cls: "bg-study text-white" },
	skim: { label: "Skim", cls: "bg-skim text-white" },
	skip: { label: "Skim · 생략 가능", cls: "bg-skip text-white" },
};

type Span = { start: number; end: number; kind: "el" | "user"; index: number };

/** Original text with element highlights and the reader's own highlights (user marks win on overlap). */
/** Margin-note numbers: guide elements that highlight a phrase, numbered in order (1, 2, …). */
export function hlNumbers(entry?: ReaderEntry): Map<number, number> {
	const m = new Map<number, number>();
	entry?.els.forEach((e, i) => e.hl && m.set(i, m.size + 1));
	return m;
}

function Highlighted({ text, entry, data, notes, onNoteClick, nums }: { text: string; entry?: ReaderEntry; data: ReaderData; notes: StoredAnnotation[]; onNoteClick: (a: StoredAnnotation) => void; nums?: Map<number, number> }) {
	const spans: Span[] = [];
	entry?.els.forEach((e, i) => e.hl && spans.push({ start: e.hl[0], end: e.hl[1], kind: "el", index: i }));
	notes.forEach((a, i) => a.resolved && spans.push({ start: a.resolved.start, end: a.resolved.end, kind: "user", index: i }));
	if (!spans.length) return <>{text}</>;
	const cuts = new Set<number>([0, text.length]);
	spans.forEach((s) => {
		cuts.add(Math.max(0, Math.min(text.length, s.start)));
		cuts.add(Math.max(0, Math.min(text.length, s.end)));
	});
	const pts = [...cuts].sort((a, b) => a - b);
	const out: React.ReactNode[] = [];
	for (let k = 0; k < pts.length - 1; k++) {
		const a = pts[k];
		const b = pts[k + 1];
		const seg = text.slice(a, b);
		const cover = spans.filter((s) => s.start <= a && s.end >= b);
		const user = cover.find((s) => s.kind === "user");
		const el = cover.find((s) => s.kind === "el");
		let node: React.ReactNode = seg;
		if (el && entry) {
			const e = entry.els[el.index];
			const t = data.types[e.t];
			node = (
				<HoverCard openDelay={120} closeDelay={60}>
					<HoverCardTrigger asChild>
						<mark className="hl" data-family={t?.family}>
							{seg}
						</mark>
					</HoverCardTrigger>
					<HoverCardContent className="w-80 text-sm">
						<div className="mb-1 text-xs font-semibold text-muted-foreground">{t?.ko ?? t?.en ?? e.t}</div>
						<MathText text={L(e.s) || L(e.x)} />
						{L(e.s) && L(e.x) && L(e.x) !== L(e.s) && (
							<div className="mt-1 text-xs text-muted-foreground">
								<MathText text={L(e.x)} />
							</div>
						)}
					</HoverCardContent>
				</HoverCard>
			);
		}
		if (user) {
			const a0 = notes[user.index];
			const body = a0.body.map((b) => b.value).join("\n");
			node = (
				<Tooltip>
					<TooltipTrigger asChild>
						<mark className="user" style={a0.color ? { background: a0.color } : undefined} onClick={() => onNoteClick(a0)}>
							{node}
						</mark>
					</TooltipTrigger>
					{body && <TooltipContent className="max-w-xs whitespace-pre-wrap">{body}</TooltipContent>}
				</Tooltip>
			);
		}
		// the margin-note number sits where the element's highlight ends
		const endsHere = el && entry?.els[el.index].hl && Math.min(text.length, entry.els[el.index].hl![1]) === b ? nums?.get(el.index) : undefined;
		out.push(
			<span key={k}>
				{node}
				{endsHere != null && <sup className="hl-num">{endsHere}</sup>}
			</span>,
		);
	}
	return <>{out}</>;
}

function GuideBlock({ tone, label, children }: { tone: "study" | "skim" | "muted"; label: string; children: React.ReactNode }) {
	return (
		<div
			className={cn(
				"rounded-md border-l-[3px] px-3 py-2 text-[0.92rem] leading-relaxed",
				tone === "study" && "border-study bg-study-bg",
				tone === "skim" && "border-skim bg-skim-bg",
				tone === "muted" && "border-skip bg-muted",
			)}
		>
			<div className="mb-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground">{label}</div>
			{children}
		</div>
	);
}

export const Para = memo(function Para(p: ParaProps) {
	const { pid, item, entry, data, mode } = p;
	const tier: Tier = entry?.tier ?? "skim";
	const ui = TIER_UI[tier];
	const [showOrig, setShowOrig] = useState(false);
	const [showNote, setShowNote] = useState(false);
	const [rate, setRate] = useState(0);
	const isClose = tier === "close";
	const origOpen = isClose ? mode !== "gist" : showOrig || p.expanded;
	const role = L(entry?.role);
	const formulas = (entry?.els ?? []).map((e, i) => ({ e, i })).filter(({ e }) => e.t === "formula" && (e.tex || e.x));
	const figx = (entry?.els ?? []).map((e, i) => ({ e, i })).filter(({ e }) => e.t === "figx");
	const capsWithoutFigx = p.figCaps.filter((c) => !figx.some(({ e }) => e.cap === c));
	const gaps = data.open.text_check[pid];
	const label = tier === "skip" && !p.threeTier ? "Skim" : ui.label;
	const nums = hlNumbers(entry);
	// the outer margin carries the guide for close reads: how to read it, then one note per highlighted phrase
	const marginNotes = (entry?.els ?? []).map((e, i) => ({ e, i, n: nums.get(i) })).filter((x) => x.n != null);
	const hasMargin = isClose && mode !== "gist" && (!!L(entry?.read) || marginNotes.length > 0);

	if (mode === "study" && !isClose) {
		return (
			<div id={`para-${pid}`} data-pid={pid} className="group flex items-baseline gap-3 py-0.5 pl-[var(--gutter)] text-sm text-muted-foreground" onClick={p.onFocus}>
				<span className="w-10 shrink-0 font-mono text-[11px]">{pid}</span>
				<span className="line-clamp-1">
					<MathText text={L(entry?.note) || item.text.slice(0, 140)} />
				</span>
			</div>
		);
	}

	return (
		<section
			id={`para-${pid}`}
			data-pid={pid}
			data-tier={tier}
			data-scrollspy-anchor={pid}
			onClick={p.onFocus}
			className={cn(
				"para group relative grid scroll-mt-24 gap-x-8 gap-y-3 pl-[var(--gutter)] @3xl:grid-cols-[minmax(0,1fr)_14rem] @5xl:grid-cols-[minmax(0,40rem)_17rem] @5xl:justify-between @5xl:gap-x-12",
				isClose ? "py-5" : "py-2.5",
			)}
		>
			{p.active && <span aria-hidden className="absolute top-5 bottom-5 left-[calc(var(--gutter)-1.4rem)] w-[3px] rounded-full bg-study" />}
			<div className="min-w-0">
				<div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
					<span className="font-mono text-[11px]">{pid}</span>
					<span className={cn("font-semibold", tier === "close" ? "text-study" : tier === "skim" ? "text-skim" : "text-muted-foreground")} data-testid={`tier-${pid}`}>
						{label}
					</span>
					{tier === "skip" && !p.threeTier && <span>생략 가능</span>}
					{role && <span className="truncate font-medium">{role}</span>}
					<span>· {item.page}쪽</span>
					{entry?.verify_failed?.length ? (
						<Tooltip>
							<TooltipTrigger>
								<Badge variant="outline" className="h-5 border-amber-500/60 text-[10px] text-amber-700 dark:text-amber-400">
									<AlertTriangle className="size-3" /> 검증 실패
								</Badge>
							</TooltipTrigger>
							<TooltipContent className="max-w-sm whitespace-pre-wrap text-xs">{entry.verify_failed.join("\n")}</TooltipContent>
						</Tooltip>
					) : null}
					<div className={cn("ml-auto flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100", (p.active || p.busy) && "opacity-100")}>
						{p.busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									className="h-7 text-xs"
									disabled={p.busy || !entry}
									onClick={(e) => {
										e.stopPropagation();
										p.onTier(isClose ? "skim" : "close");
									}}
									data-testid={`toggle-tier-${pid}`}
								>
									{isClose ? "Skim으로" : "정독으로"}
								</Button>
							</TooltipTrigger>
							<TooltipContent>단축키 s{isClose ? "" : " · 정독으로 올리면 해설을 새로 씁니다"}</TooltipContent>
						</Tooltip>
						<Button variant="ghost" size="icon" className="size-7" onClick={(e) => (e.stopPropagation(), p.onAsk())} title="이 문단에 대해 묻기">
							<MessageCircleQuestion />
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon" className="size-7" disabled={p.busy || !entry} onClick={(e) => e.stopPropagation()}>
									<MoreHorizontal />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuLabel className="text-xs">해설 다시 쓰기</DropdownMenuLabel>
								<DropdownMenuItem onClick={() => p.onRegen("simpler")}>
									<Sparkles /> 더 쉽게
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => p.onRegen("deeper")}>
									<Wand2 /> 더 자세히
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => p.onRegen("redo")}>
									<RefreshCw /> 다시 쓰기
								</DropdownMenuItem>
								{tier !== "skip" && (
									<>
										<DropdownMenuSeparator />
										<DropdownMenuItem onClick={() => p.onTier("skip")}>생략 가능으로 표시</DropdownMenuItem>
									</>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>

				{!isClose && L(entry?.note) && (
					<div className={cn("text-[0.97rem] leading-relaxed", tier === "skip" ? "text-muted-foreground" : "text-foreground/90")}>
						<MathText text={L(entry?.note)} />
						{tier === "skip" && L(entry?.why) && <div className="mt-0.5 text-xs text-muted-foreground">생략해도 되는 이유: {L(entry?.why)}</div>}
					</div>
				)}
				{isClose && mode === "gist" && L(entry?.note) && (
					<div className="text-[1rem] leading-relaxed">
						<MathText text={L(entry?.note)} />
					</div>
				)}

				{origOpen ? (
					<div className={cn("orig", isClose ? "orig-close" : "mt-2 text-[0.98rem] text-foreground/85")} data-orig={pid}>
						<Highlighted text={item.text} entry={entry} data={data} notes={p.notes} onNoteClick={p.onNoteClick} nums={nums} />
					</div>
				) : (
					<button
						className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
						onClick={(e) => {
							e.stopPropagation();
							setShowOrig(true);
						}}
					>
						<ChevronRight className="size-3.5" /> 원문 펼치기
					</button>
				)}
				{!isClose && origOpen && (
					<button className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowOrig(false)}>
						<ChevronDown className="size-3.5" /> 원문 접기
					</button>
				)}
				{gaps?.length && origOpen ? (
					<div className="mt-1 text-xs text-muted-foreground">
						공개 버전에만 있는 단어: {gaps.map((g) => <b key={g}> {g} </b>)}
					</div>
				) : null}

				{origOpen && p.fragCrops.length > 0 && (
					<div className="mt-2 flex flex-wrap gap-2">
						{p.fragCrops.map((c) => (
							<Zoomable key={c} src={c} alt={`${pid}에 딸린 수식·표`} className="max-h-40 cursor-zoom-in rounded border bg-white object-contain" />
						))}
					</div>
				)}

				{(origOpen || mode === "gist") && (formulas.length > 0 || figx.length > 0 || capsWithoutFigx.length > 0) && (
					<div className="mt-4 space-y-3">
						{formulas.map(({ e, i }) => (
							<FormulaCard key={i} el={e} crop={p.fragCrops[0] ?? null} />
						))}
						{figx.map(({ e }) => (
							<FigureCard key={e.cap} capId={e.cap!} data={data} el={e} fileBase={p.fileBase} crops={p.capCrops[e.cap!] ?? []} />
						))}
						{capsWithoutFigx.map((c) => (
							<FigureCard key={c} capId={c} data={data} fileBase={p.fileBase} crops={p.capCrops[c] ?? []} />
						))}
					</div>
				)}

				{isClose && mode !== "gist" && L(entry?.note) && (
					<div className="mt-3">
						<button
							className="flex items-center gap-1 text-xs font-medium text-study hover:underline"
							onClick={(e) => {
								e.stopPropagation();
								setShowNote(!showNote);
							}}
							data-testid={`note-toggle-${pid}`}
						>
							{showNote ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} 읽은 뒤 요약
						</button>
						{showNote && (
							<div className="mt-1">
								<GuideBlock tone="study" label="읽은 뒤 요약">
									<MathText text={L(entry?.note)} />
								</GuideBlock>
								<div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
									<Star className="size-3" /> 해설이 도움이 되었나요?
									<Rating
										rating={rate}
										editable
										size="sm"
										onRatingChange={(v: number) => {
											setRate(v);
											p.onRate(v);
										}}
									/>
								</div>
							</div>
						)}
					</div>
				)}
			</div>

			{hasMargin && (
				<aside className="order-first flex flex-col gap-3.5 text-[0.86rem] leading-relaxed @3xl:order-none @3xl:pt-7" data-testid={`margin-${pid}`}>
					{L(entry?.read) && (
						<div className="rounded-r-lg border-l-[3px] border-study bg-study-bg px-3 py-2.5">
							<div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold tracking-wide text-study">
								<Sparkles className="size-3" /> 이렇게 읽기
							</div>
							<MathText text={L(entry?.read)} />
						</div>
					)}
					{marginNotes.map(({ e, n }) => {
						const t = data.types[e.t];
						return (
							<div key={n} className="margin-note border-l-[3px] pl-3" data-family={t?.family}>
								<div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
									<span className="margin-num">{n}</span> {t?.ko ?? t?.en ?? e.t}
								</div>
								<MathText text={L(e.s) || L(e.x)} />
								{L(e.s) && L(e.x) && L(e.x) !== L(e.s) && (
									<div className="mt-0.5 text-xs text-muted-foreground">
										<MathText text={L(e.x)} />
									</div>
								)}
							</div>
						);
					})}
				</aside>
			)}
		</section>
	);
});
