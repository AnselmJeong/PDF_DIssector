import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, Download, FileText, Highlighter, Loader2, MessageCircleQuestion, NotebookPen, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/rpc";
import { L, useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { ReaderEntry, ReaderPayload, RegenStyle, StoredAnnotation, Tier, WebAnnotation } from "../../../shared/types";
import { ArgumentMap, relKo } from "./ArgumentMap";
import { ChatPanel } from "./ChatPanel";
import { MathText } from "./MathText";
import { Para, type ViewMode } from "./Para";
import { PdfPane } from "./PdfPane";

const pnum = (id: string) => (/^P(\d+)$/.exec(id) ? Number(id.slice(1)) : null);
const inRange = (range: string, id: string) => {
	const m = /^P(\d+)(?:-P(\d+))?$/.exec(range);
	const n = pnum(id);
	return !!m && n != null && n >= Number(m[1]) && n <= Number(m[2] ?? m[1]);
};

export function ReaderView({ docId, initialPid }: { docId: string; initialPid?: string }) {
	const qc = useQueryClient();
	const { go } = useApp();
	const q = useQuery({ queryKey: ["reader", docId], queryFn: () => api.getReader({ docId }) });
	const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings({}) });
	const [mode, setMode] = useState<ViewMode>("full");
	const [current, setCurrent] = useState<string | null>(initialPid ?? null);
	const [side, setSide] = useState<"pdf" | "chat" | "notes" | null>("pdf");
	const [busy, setBusy] = useState<Set<string>>(new Set());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [chatSeed, setChatSeed] = useState<string | null>(null);
	const [sel, setSel] = useState<{ pid: string; x: number; y: number; exact: string; prefix: string; suffix: string; start: number; end: number } | null>(null);
	const [memo, setMemo] = useState<{ anno: StoredAnnotation | null; draft: WebAnnotation | null; text: string } | null>(null);
	const scroller = useRef<HTMLDivElement>(null);

	const payload = q.data;
	const data = payload?.data;

	const paraIds = useMemo(() => (data ? data.order.filter((id) => data.items[id].type === "para") : []), [data]);
	const closeIds = useMemo(() => paraIds.filter((id) => data?.guide[id]?.tier === "close"), [paraIds, data]);
	const partOf = useCallback((id: string | null) => (data && id ? (data.parts.find((p) => inRange(p.range, id)) ?? null) : null), [data]);
	const curPart = partOf(current);

	// captions hosted by each paragraph (template: figures on the paragraph that first cites them) and their crops
	const { hostCaps, capCrops, looseCaps } = useMemo(() => {
		const hostCaps: Record<string, string[]> = {};
		const capCrops: Record<string, string[]> = {};
		const looseCaps = new Set<string>();
		if (!data) return { hostCaps, capCrops, looseCaps };
		const keys = Object.keys(data.items);
		for (const [cid, f] of Object.entries(data.figs)) {
			if (f.host && data.guide[f.host]) (hostCaps[f.host] ??= []).push(cid);
			else looseCaps.add(cid);
			const k = keys.indexOf(cid);
			for (let j = k + 1; j < keys.length && data.items[keys[j]].type === "frag"; j++) if (data.crops[keys[j]]) (capCrops[cid] ??= []).push(data.crops[keys[j]]);
		}
		// figx elements attached to a host override the default host
		for (const [pid, e] of Object.entries(data.guide)) {
			for (const el of e.els) {
				if (el.t !== "figx" || !el.cap) continue;
				for (const h of Object.keys(hostCaps)) if (h !== pid) hostCaps[h] = hostCaps[h].filter((c) => c !== el.cap);
				looseCaps.delete(el.cap);
				(hostCaps[pid] ??= []).includes(el.cap) || hostCaps[pid].push(el.cap);
			}
		}
		return { hostCaps, capCrops, looseCaps };
	}, [data]);

	const notesByPid = useMemo(() => {
		const out: Record<string, StoredAnnotation[]> = {};
		for (const a of payload?.annotations ?? []) if (a.resolved) (out[a.resolved.pid] ??= []).push(a);
		return out;
	}, [payload]);

	const updateEntry = (pid: string, e: ReaderEntry) =>
		qc.setQueryData<ReaderPayload>(["reader", docId], (old) => (old ? { ...old, data: { ...old.data, guide: { ...old.data.guide, [pid]: e } } } : old));

	const withBusy = async (pid: string, fn: () => Promise<void>) => {
		setBusy((s) => new Set(s).add(pid));
		try {
			await fn();
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setBusy((s) => {
				const n = new Set(s);
				n.delete(pid);
				return n;
			});
			qc.invalidateQueries({ queryKey: ["docs"] });
		}
	};

	const setTier = (pid: string, tier: Tier) =>
		withBusy(pid, async () => {
			if (tier === "close") toast.info(`${pid}를 정독으로 올리고 해설을 새로 씁니다…`);
			updateEntry(pid, await api.setTier({ docId, pid, tier }));
		});
	const regen = (pid: string, style: RegenStyle) =>
		withBusy(pid, async () => {
			updateEntry(pid, await api.regenerate({ docId, target: { kind: "para", pid }, style }));
			toast.success(`${pid} 해설을 다시 썼습니다`);
		});

	const jump = useCallback((pid: string) => {
		const el = document.getElementById(`para-${pid}`);
		if (!el) return;
		el.scrollIntoView({ behavior: "smooth", block: "start" });
		el.classList.remove("para-flash");
		void el.offsetWidth;
		el.classList.add("para-flash");
		setCurrent(pid);
	}, []);

	useEffect(() => {
		if (initialPid && data) setTimeout(() => jump(initialPid), 200);
	}, [initialPid, data, jump]);

	// scrollspy: the paragraph nearest the top of the reading column is "current"
	useEffect(() => {
		const root = scroller.current;
		if (!root || !data) return;
		const visible = new Map<string, number>();
		const io = new IntersectionObserver(
			(ents) => {
				for (const e of ents) {
					const pid = (e.target as HTMLElement).dataset.pid!;
					if (e.isIntersecting) visible.set(pid, e.boundingClientRect.top);
					else visible.delete(pid);
				}
				const top = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
				if (top) setCurrent(top[0]);
			},
			{ root, rootMargin: "-80px 0px -55% 0px" },
		);
		root.querySelectorAll("[data-pid]").forEach((n) => io.observe(n));
		return () => io.disconnect();
	}, [data, mode]);

	// keyboard: j/k next/previous close read, s toggle tier, e expand, p PDF
	useEffect(() => {
		const onKey = (ev: KeyboardEvent) => {
			const t = ev.target as HTMLElement;
			if (t.closest("input, textarea, [contenteditable]") || ev.metaKey || ev.ctrlKey || ev.altKey) return;
			const idx = current ? paraIds.indexOf(current) : -1;
			if (ev.key === "j" || ev.key === "k") {
				const dir = ev.key === "j" ? 1 : -1;
				for (let i = idx + dir; i >= 0 && i < paraIds.length; i += dir) {
					if (closeIds.includes(paraIds[i])) return jump(paraIds[i]);
				}
			} else if (ev.key === "s" && current && data?.guide[current]) {
				void setTier(current, data.guide[current].tier === "close" ? "skim" : "close");
			} else if (ev.key === "e" && current) {
				setExpanded((s) => {
					const n = new Set(s);
					if (n.has(current)) n.delete(current);
					else n.add(current);
					return n;
				});
			} else if (ev.key === "p") {
				setSide((s) => (s === "pdf" ? null : "pdf"));
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	// text selection inside the original text -> floating toolbar (highlight, memo, ask AI)
	useEffect(() => {
		const onUp = () => {
			const s = window.getSelection();
			if (!s || s.isCollapsed || !s.rangeCount) return setSel(null);
			const range = s.getRangeAt(0);
			const host = (range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest("[data-orig]") as HTMLElement | null;
			if (!host || !data) return setSel(null);
			const pid = host.dataset.orig!;
			const pre = document.createRange();
			pre.selectNodeContents(host);
			pre.setEnd(range.startContainer, range.startOffset);
			const start = pre.toString().length;
			const exact = range.toString();
			const text = data.items[pid].text;
			if (!exact.trim() || text.slice(start, start + exact.length) !== exact) return setSel(null);
			const rect = range.getBoundingClientRect();
			setSel({ pid, x: rect.left + rect.width / 2, y: rect.top, exact, start, end: start + exact.length, prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(start + exact.length, start + exact.length + 32) });
		};
		document.addEventListener("mouseup", onUp);
		return () => document.removeEventListener("mouseup", onUp);
	}, [data]);

	const annoFor = (motivation: WebAnnotation["motivation"], body: string, color?: string): WebAnnotation | null => {
		if (!sel || !data) return null;
		const sid = data.items[sel.pid].sid;
		const it = data.items[sel.pid];
		return {
			type: "Annotation",
			motivation,
			body: body ? [{ type: "TextualBody", value: body, format: "text/markdown" }] : [],
			target: {
				source: `doc:${docId}`,
				selector: [
					{ type: "TextQuoteSelector", exact: sel.exact, prefix: sel.prefix, suffix: sel.suffix },
					{ type: "TextPositionSelector", start: sel.start, end: sel.end },
					...(sid ? [{ type: "FragmentSelector" as const, value: `sid=${sid}` }] : []),
					...(it.bbox ? [{ type: "PdfBoxSelector" as const, page: it.page, bbox: it.bbox }] : []),
				],
			},
			color,
		};
	};

	const saveAnno = async (a: WebAnnotation) => {
		await api.saveAnnotation({ docId, anno: a });
		window.getSelection()?.removeAllRanges();
		setSel(null);
		qc.invalidateQueries({ queryKey: ["reader", docId] });
	};

	if (q.isLoading) {
		return (
			<div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Reader 데이터를 불러오는 중
			</div>
		);
	}
	if (q.error || !payload || !data) {
		return (
			<div className="p-6 text-sm">
				<p className="text-destructive">Reader를 열 수 없습니다: {(q.error as Error)?.message}</p>
				<Button className="mt-3" variant="outline" onClick={() => go({ name: "processing", docId })}>
					처리 화면으로
				</Button>
			</div>
		);
	}

	const meta = data.meta;
	const title = L(meta.title) || data.doc.title_guess;
	const curItem = current ? data.items[current] : null;
	const terms = data.glossary.filter((g) => (curPart ? inRange(curPart.range, g.src) : true));
	const flow = curPart ? (data.logic.flows[curPart.id] ?? []) : [];
	const readClose = closeIds.filter((id) => paraIds.indexOf(id) <= paraIds.indexOf(current ?? "")).length;
	const threeTier = !!settings.data?.threeTierView;
	const orphans = payload.annotations.filter((a) => a.orphaned);

	let lastPart: string | null = null;
	const stream: React.ReactNode[] = [];
	for (const id of data.order) {
		const it = data.items[id];
		if (it.type === "para") {
			const part = partOf(id);
			if (part && part.id !== lastPart) {
				lastPart = part.id;
				stream.push(
					<div key={`part-${part.id}`} id={`part-${part.id}`} className="mt-8 mb-2 scroll-mt-20 border-b pb-2">
						<div className="text-[11px] font-semibold tracking-wide text-muted-foreground">
							{part.id} · {part.range}
							{part.skip && " · 생략 가능한 부분"}
						</div>
						<h2 className="text-base font-semibold">{L(part.title)}</h2>
						{L(part.claim) && (
							<p className="mt-0.5 text-sm text-muted-foreground">
								<MathText text={L(part.claim)} />
							</p>
						)}
					</div>,
				);
			}
			stream.push(
				<Para
					key={id}
					pid={id}
					item={it}
					entry={data.guide[id]}
					data={data}
					fileBase={payload.fileBase}
					mode={mode}
					threeTier={threeTier}
					notes={notesByPid[id] ?? []}
					figCaps={hostCaps[id] ?? []}
					capCrops={capCrops}
					fragCrops={(data.frag_crops[id] ?? []).map((f) => data.crops[f]).filter(Boolean)}
					busy={busy.has(id)}
					active={current === id}
					expanded={expanded.has(id)}
					onToggleExpand={() => setExpanded((s) => new Set(s).add(id))}
					onTier={(t) => setTier(id, t)}
					onRegen={(s) => regen(id, s)}
					onAsk={() => {
						setCurrent(id);
						setSide("chat");
					}}
					onRate={(stars) => api.rateExplanation({ docId, pid: id, stars })}
					onFocus={() => setCurrent(id)}
					onNoteClick={(a) => setMemo({ anno: a, draft: null, text: a.body.map((b) => b.value).join("\n") })}
				/>,
			);
			// end of a part: recall questions
			const part2 = partOf(id);
			const next = data.order.slice(data.order.indexOf(id) + 1).find((x) => data.items[x].type === "para");
			if (part2?.recall?.length && (!next || partOf(next)?.id !== part2.id) && mode !== "study") {
				stream.push(
					<Collapsible key={`recall-${part2.id}`} className="mx-4 mt-2 rounded-lg border border-dashed p-3">
						<CollapsibleTrigger className="text-xs font-semibold text-muted-foreground">되짚기 질문 ({part2.recall.length})</CollapsibleTrigger>
						<CollapsibleContent className="mt-2 space-y-2">
							{part2.recall.map((r, i) => (
								<details key={i} className="text-sm">
									<summary className="cursor-pointer">
										<MathText text={L(r.q)} />
									</summary>
									<div className="mt-1 pl-4 text-muted-foreground">
										<MathText text={L(r.a)} />
									</div>
								</details>
							))}
						</CollapsibleContent>
					</Collapsible>,
				);
			}
		} else if (it.type === "heading" && mode === "full") {
			stream.push(
				<div key={id} className={cn("orig mt-5 mb-1 px-4 font-semibold", (it.level ?? 1) <= 1 ? "text-lg" : "text-base")}>
					{it.text}
				</div>,
			);
		} else if (it.type === "caption" && looseCaps.has(id) && mode === "full") {
			stream.push(
				<div key={id} className="orig px-4 py-1 text-[0.9rem] text-muted-foreground">
					{it.text}
				</div>,
			);
		}
	}

	return (
		<div className="flex h-full flex-col">
			<header className="flex items-center gap-3 border-b px-4 py-2">
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold">{title}</div>
					<div className="truncate text-[11px] text-muted-foreground">
						{[L(meta.author), L(meta.source), L(meta.genre)].filter(Boolean).join(" · ")} · {paraIds.length}개 문단, 정독 {closeIds.length}개
					</div>
				</div>
				<ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as ViewMode)} size="sm" variant="outline" className="ml-auto">
					<ToggleGroupItem value="full">전체</ToggleGroupItem>
					<ToggleGroupItem value="study">정독만</ToggleGroupItem>
					<ToggleGroupItem value="gist">요약만</ToggleGroupItem>
				</ToggleGroup>
				<Button
					variant="outline"
					size="sm"
					onClick={async () => {
						try {
							const r = await api.exportHtml({ docId });
							toast.success("HTML로 내보냈습니다", { description: r.path, action: { label: "폴더 열기", onClick: () => api.showInFolder({ path: r.path }) } });
						} catch (e) {
							toast.error((e as Error).message);
						}
					}}
				>
					<Download /> HTML
				</Button>
				<ToggleGroup type="single" value={side ?? ""} onValueChange={(v) => setSide((v || null) as typeof side)} size="sm" variant="outline">
					<ToggleGroupItem value="pdf" title="PDF (p)">
						<FileText />
					</ToggleGroupItem>
					<ToggleGroupItem value="chat" title="질문">
						<MessageCircleQuestion />
					</ToggleGroupItem>
					<ToggleGroupItem value="notes" title="내 메모">
						<StickyNote />
					</ToggleGroupItem>
				</ToggleGroup>
			</header>
			<ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
				<ResizablePanel defaultSize="20%" minSize="14%" maxSize="30%">
					<aside className="h-full space-y-4 overflow-y-auto bg-sidebar p-3 text-sm" data-testid="margin">
						<div>
							<div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">논증 구조</div>
							<ul className="space-y-0.5">
								{data.parts.map((p) => (
									<li key={p.id}>
										<button
											onClick={() => jump(paraIds.find((id) => inRange(p.range, id)) ?? paraIds[0])}
											className={cn("w-full truncate rounded px-1.5 py-1 text-left text-xs hover:bg-accent", curPart?.id === p.id && "bg-accent font-medium", p.skip && "text-muted-foreground")}
										>
											{L(p.title)} <span className="text-muted-foreground">{p.range}</span>
										</button>
									</li>
								))}
							</ul>
						</div>
						{curPart && (
							<div className="rounded-lg border bg-card p-2.5">
								<div className="text-[11px] font-semibold tracking-wide text-muted-foreground">이 부분의 주장</div>
								<div className="mt-0.5 text-[13px] leading-snug">
									<MathText text={L(curPart.claim) || L(curPart.role)} />
								</div>
								{curPart.claim_p && (
									<button className="mt-1 text-[11px] text-primary hover:underline" onClick={() => jump(curPart.claim_p!)}>
										{curPart.claim_p}에서
									</button>
								)}
							</div>
						)}
						{flow.length > 0 && (
							<div>
								<div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">추론 단계</div>
								<ol className="space-y-1">
									{flow.map((s, i) => (
										<li key={i}>
											<button onClick={() => jump(s.p)} className={cn("flex w-full gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-accent", current === s.p && "bg-accent")}>
												<span className="font-mono text-muted-foreground">{i + 1}</span>
												<span>
													{s.rel && <span className="text-muted-foreground">{relKo(s.rel)}: </span>}
													<MathText text={L(s.x)} />
												</span>
											</button>
										</li>
									))}
								</ol>
							</div>
						)}
						{terms.length > 0 && (
							<div>
								<div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">용어</div>
								<ul className="space-y-1">
									{terms.slice(0, 14).map((t, i) => (
										<li key={i} className="text-xs">
											<button className="font-medium hover:underline" onClick={() => jump(t.src)}>
												{t.term}
											</button>
											<span className="text-muted-foreground">: </span>
											<MathText text={L(t.x)} className="text-muted-foreground" />
										</li>
									))}
								</ul>
							</div>
						)}
						<div>
							<div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">진행</div>
							<div className="h-1.5 overflow-hidden rounded bg-muted">
								<div className="h-full bg-study" style={{ width: `${closeIds.length ? (readClose / closeIds.length) * 100 : 0}%` }} />
							</div>
							<div className="mt-1 text-[11px] text-muted-foreground">
								정독 {readClose}/{closeIds.length} · j/k 다음·이전 정독, s 정독 전환, e 원문 펼치기, p PDF
							</div>
						</div>
					</aside>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel defaultSize={side ? "50%" : "80%"} minSize="35%">
					<div ref={scroller} className="h-full overflow-y-auto" data-testid="reader-stream">
						<div className="mx-auto max-w-3xl px-4 pt-6 pb-40">
							<h1 className="orig text-2xl leading-snug font-semibold">{title}</h1>
							<div className="mt-1 text-xs text-muted-foreground">{[L(meta.author), L(meta.source)].filter(Boolean).join(" · ")}</div>
							<div className="mt-4 rounded-xl bg-primary/8 p-4">
								<div className="text-[11px] font-semibold tracking-wide text-primary">한 문장 결론</div>
								<div className="mt-1 text-[1.05rem] leading-relaxed font-medium" data-testid="thesis">
									<MathText text={L(data.thesis)} />
								</div>
								<div className="mt-2 text-sm leading-relaxed text-muted-foreground">
									<MathText text={L(data.overview)} />
								</div>
							</div>
							<div className="mt-4">
								<ArgumentMap
									data={data}
									current={curPart?.id}
									onPick={(pid) => {
										const p = data.parts.find((x) => x.id === pid);
										if (p) jump(paraIds.find((id) => inRange(p.range, id)) ?? paraIds[0]);
									}}
								/>
							</div>
							{data.questions.length > 0 && (
								<div className="mt-4 rounded-xl border p-4">
									<div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
										<BookMarked className="size-4" /> 내 질문과 답
									</div>
									<div className="space-y-3">
										{data.questions.map((qq, i) => (
											<div key={i} className="text-sm">
												<div className="font-medium">
													<MathText text={L(qq.q)} />
												</div>
												<div className="mt-0.5 text-muted-foreground">
													<MathText text={L(qq.a)} />
												</div>
												<div className="mt-1 flex gap-1">
													{qq.p.map((p) => (
														<Badge key={p} variant="outline" className="cursor-pointer" onClick={() => jump(p)}>
															{p}
														</Badge>
													))}
												</div>
											</div>
										))}
									</div>
								</div>
							)}
							{data.check.errors.length > 0 && (
								<p className="mt-3 text-xs text-amber-700 dark:text-amber-400">검증에서 해결하지 못한 항목 {data.check.errors.length}개가 있습니다. 해당 문단에 "검증 실패" 표시가 붙어 있습니다.</p>
							)}
							<div className="mt-2 space-y-1">{stream}</div>
						</div>
					</div>
				</ResizablePanel>
				{side && (
					<>
						<ResizableHandle />
						<ResizablePanel defaultSize="30%" minSize="20%">
							<Tabs value={side} onValueChange={(v) => setSide(v as typeof side)} className="flex h-full flex-col gap-0">
								<TabsList className="m-2 grid w-auto grid-cols-3">
									<TabsTrigger value="pdf">PDF</TabsTrigger>
									<TabsTrigger value="chat">질문</TabsTrigger>
									<TabsTrigger value="notes">메모 {payload.annotations.length ? `(${payload.annotations.length})` : ""}</TabsTrigger>
								</TabsList>
								<TabsContent value="pdf" className="min-h-0 flex-1">
									<PdfPane url={payload.pdfUrl} page={curItem?.page ?? 1} bbox={curItem?.bbox} pageCount={data.doc.page_count} />
								</TabsContent>
								<TabsContent value="chat" className="min-h-0 flex-1">
									<ChatPanel docId={docId} pid={current} seed={chatSeed} onSeedUsed={() => setChatSeed(null)} />
								</TabsContent>
								<TabsContent value="notes" className="min-h-0 flex-1 overflow-y-auto p-3">
									<NotesList
										annos={payload.annotations}
										onJump={(a) => a.resolved && jump(a.resolved.pid)}
										onDelete={async (a) => {
											await api.deleteAnnotation({ docId, id: a.id });
											qc.invalidateQueries({ queryKey: ["reader", docId] });
										}}
										orphans={orphans}
									/>
								</TabsContent>
							</Tabs>
						</ResizablePanel>
					</>
				)}
			</ResizablePanelGroup>

			{sel && (
				<div className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-lg border bg-popover p-1 shadow-lg" style={{ left: sel.x, top: sel.y - 6 }} onMouseUp={(e) => e.stopPropagation()}>
					{["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8"].map((c) => (
						<button key={c} className="size-5 rounded-full border" style={{ background: c }} title="하이라이트" onClick={() => saveAnno(annoFor("highlighting", "", c)!)} />
					))}
					<Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setMemo({ anno: null, draft: annoFor("commenting", ""), text: "" })}>
						<NotebookPen /> 메모
					</Button>
					<Button
						size="sm"
						variant="ghost"
						className="h-7 text-xs"
						onClick={() => {
							setCurrent(sel.pid);
							setChatSeed(`"${sel.exact.slice(0, 200)}" 이 부분이 무슨 뜻인가요?`);
							setSide("chat");
							setSel(null);
						}}
					>
						<MessageCircleQuestion /> AI에게 묻기
					</Button>
				</div>
			)}
			{memo && (
				<div className="fixed right-6 bottom-6 z-50 w-96 rounded-xl border bg-popover p-3 shadow-xl">
					<div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
						<Highlighter className="size-4" /> {memo.anno ? "메모 수정" : "메모 남기기"}
					</div>
					<Textarea autoFocus value={memo.text} onChange={(e) => setMemo({ ...memo, text: e.target.value })} className="min-h-24 text-sm" />
					<div className="mt-2 flex justify-end gap-2">
						{memo.anno && (
							<Button
								size="sm"
								variant="ghost"
								className="mr-auto text-destructive"
								onClick={async () => {
									await api.deleteAnnotation({ docId, id: memo.anno!.id });
									setMemo(null);
									qc.invalidateQueries({ queryKey: ["reader", docId] });
								}}
							>
								<Trash2 /> 삭제
							</Button>
						)}
						<Button size="sm" variant="outline" onClick={() => setMemo(null)}>
							취소
						</Button>
						<Button
							size="sm"
							onClick={async () => {
								const base = memo.anno ?? memo.draft;
								if (!base) return;
								await saveAnno({ ...base, motivation: "commenting", body: [{ type: "TextualBody", value: memo.text, format: "text/markdown" }] });
								setMemo(null);
							}}
						>
							저장
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function NotesList({ annos, orphans, onJump, onDelete }: { annos: StoredAnnotation[]; orphans: StoredAnnotation[]; onJump: (a: StoredAnnotation) => void; onDelete: (a: StoredAnnotation) => void }) {
	const placed = annos.filter((a) => !a.orphaned);
	const item = (a: StoredAnnotation) => {
		const q = a.target.selector.find((s) => s.type === "TextQuoteSelector") as { exact: string } | undefined;
		return (
			<div key={a.id} className="group rounded-lg border p-2 text-xs">
				<button className="block w-full text-left" onClick={() => onJump(a)}>
					<div className="orig line-clamp-3 border-l-2 pl-2 text-[0.85rem]" style={{ borderColor: a.color ?? "var(--hl-user)" }}>
						{q?.exact}
					</div>
					{a.body.length > 0 && <div className="mt-1 whitespace-pre-wrap">{a.body.map((b) => b.value).join("\n")}</div>}
					<div className="mt-1 text-[10px] text-muted-foreground">
						{a.resolved?.pid} · {new Date(a.updatedAt).toLocaleString("ko-KR")}
					</div>
				</button>
				<button className="mt-1 hidden text-[10px] text-destructive group-hover:block" onClick={() => onDelete(a)}>
					삭제
				</button>
			</div>
		);
	};
	return (
		<div className="space-y-2">
			{placed.length === 0 && orphans.length === 0 && <p className="text-xs text-muted-foreground">원문에서 글자를 드래그하면 하이라이트와 메모를 남길 수 있습니다.</p>}
			{placed.map(item)}
			{orphans.length > 0 && (
				<>
					<div className="pt-2 text-[11px] font-semibold text-muted-foreground">위치를 잃은 메모 ({orphans.length})</div>
					{orphans.map(item)}
				</>
			)}
		</div>
	);
}
