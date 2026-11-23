import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenText, CheckCircle2, CircleDashed, CircleSlash, Loader2, RotateCcw, Square, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Timeline, TimelineContent, TimelineDate, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle } from "@/components/reui/timeline";
import { api, fileUrl, on } from "@/lib/rpc";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useEffect } from "react";
import type { Stage, StageRecord } from "../../../shared/types";
import { STAGE_LABEL, STAGES } from "../../../shared/types";
import { STATUS } from "../library/LibraryView";

const ICON: Record<StageRecord["status"], React.ReactNode> = {
	pending: <CircleDashed className="size-4 text-muted-foreground" />,
	running: <Loader2 className="size-4 animate-spin text-primary" />,
	done: <CheckCircle2 className="size-4 text-emerald-600" />,
	failed: <XCircle className="size-4 text-destructive" />,
	skipped: <CircleSlash className="size-4 text-muted-foreground" />,
};

const fmtTime = (s: string | null) => (s ? new Date(s).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
const dur = (a: string | null, b: string | null) => {
	if (!a) return "";
	const ms = (b ? new Date(b) : new Date()).getTime() - new Date(a).getTime();
	return ms < 60000 ? `${Math.round(ms / 1000)}초` : `${Math.floor(ms / 60000)}분 ${Math.round((ms % 60000) / 1000)}초`;
};

export function ProcessingView({ docId }: { docId: string }) {
	const qc = useQueryClient();
	const { go } = useApp();
	const job = useQuery({ queryKey: ["job", docId], queryFn: () => api.getJob({ docId }), refetchInterval: (q) => (q.state.data?.running ? 3000 : false) });
	const docs = useQuery({ queryKey: ["docs"], queryFn: () => api.listDocs({}) });
	const doc = docs.data?.find((d) => d.id === docId);
	const [live, setLive] = useState<{ stage: Stage; pct: number; msg: string } | null>(null);

	useEffect(
		() =>
			on("jobProgress", (m) => {
				if (m.docId === docId) setLive({ stage: m.stage, pct: m.pct, msg: m.msg });
			}),
		[docId],
	);

	const stages = (job.data?.stages ?? []).filter((s) => s.stage !== "IMPORTED");
	const doneCount = stages.filter((s) => s.status === "done" || s.status === "skipped").length;
	const running = job.data?.running;
	const failed = stages.find((s) => s.status === "failed");

	const resume = async (from?: Stage) => {
		try {
			await api.startJob({ docId, from });
			qc.invalidateQueries({ queryKey: ["job", docId] });
			qc.invalidateQueries({ queryKey: ["docs"] });
		} catch (e) {
			toast.error((e as Error).message);
		}
	};

	return (
		<div className="flex h-full flex-col">
			<header className="flex items-start gap-3 border-b px-6 py-4">
				<div className="min-w-0">
					<h1 className="truncate text-lg font-semibold">{doc?.title ?? "처리"}</h1>
					<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
						{doc && <Badge className={cn("border-0", STATUS[doc.status].cls)}>{STATUS[doc.status].label}</Badge>}
						<span>
							{doneCount}/{stages.length} 단계
						</span>
						<span>· 비용 ${doc?.costUsd.toFixed(3) ?? "0"}</span>
						<span>
							· 토큰 {((doc?.tokensIn ?? 0) / 1000).toFixed(1)}k 입력 / {((doc?.tokensOut ?? 0) / 1000).toFixed(1)}k 출력
						</span>
					</div>
				</div>
				<div className="ml-auto flex gap-2">
					{running ? (
						<Button variant="outline" onClick={() => api.cancelJob({ docId })}>
							<Square /> 취소
						</Button>
					) : (
						<Button variant="outline" onClick={() => resume()}>
							<RotateCcw /> {failed ? "실패한 단계부터 다시" : "이어서 처리"}
						</Button>
					)}
					{(doc?.status === "done" || doc?.status === "needs_review") && (
						<Button onClick={() => go({ name: "reader", docId })}>
							<BookOpenText /> Reader 열기
						</Button>
					)}
				</div>
			</header>
			<div className="px-6 pt-3">
				<Progress value={(doneCount / Math.max(1, stages.length)) * 100} />
				{running && live && (
					<div className="mt-1.5 text-xs text-muted-foreground">
						{STAGE_LABEL[live.stage]}: {live.msg}
					</div>
				)}
			</div>
			<div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,420px)_1fr] gap-6 overflow-hidden px-6 py-4">
				<div className="overflow-y-auto pr-2">
					<Timeline defaultValue={doneCount}>
						{stages.map((s, i) => (
							<TimelineItem key={s.stage} step={i + 1} className="group-data-[orientation=vertical]/timeline:ms-8">
								<TimelineHeader>
									<TimelineSeparator className="group-data-[orientation=vertical]/timeline:-left-6 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem-0.25rem)] group-data-[orientation=vertical]/timeline:translate-y-6.5" />
									<TimelineDate className="text-[11px]">
										{fmtTime(s.startedAt)} {s.startedAt && `· ${dur(s.startedAt, s.finishedAt)}`}
										{s.costUsd > 0 && ` · $${s.costUsd.toFixed(3)}`}
										{s.attempts > 1 && ` · 시도 ${s.attempts}회`}
									</TimelineDate>
									<TimelineTitle className="flex items-center gap-2 text-sm">
										{STAGE_LABEL[s.stage]}
										{!running && (s.status === "done" || s.status === "failed") && s.stage !== "BRIEFED" && (
											<button className="text-[11px] font-normal text-muted-foreground underline-offset-2 hover:underline" onClick={() => resume(s.stage)}>
												여기서부터 다시
											</button>
										)}
									</TimelineTitle>
									<TimelineIndicator className="flex size-6 items-center justify-center border-none bg-background group-data-[orientation=vertical]/timeline:-left-6">
										{ICON[s.status]}
									</TimelineIndicator>
								</TimelineHeader>
								<TimelineContent className="text-xs">
									{s.msg && <div className={cn(s.status === "failed" && "text-destructive")}>{s.msg}</div>}
									{s.detail && (
										<Collapsible>
											<CollapsibleTrigger className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline">원문 출력 보기</CollapsibleTrigger>
											<CollapsibleContent>
												<pre className="mt-1 max-h-60 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{s.detail}</pre>
											</CollapsibleContent>
										</Collapsible>
									)}
								</TimelineContent>
							</TimelineItem>
						))}
					</Timeline>
				</div>
				<div className="min-h-0 overflow-y-auto">
					<Tabs defaultValue="inspect">
						<TabsList>
							<TabsTrigger value="inspect">페이지 검수</TabsTrigger>
							<TabsTrigger value="findings">2차 검토 ({job.data?.findings.length ?? 0})</TabsTrigger>
						</TabsList>
						<TabsContent value="inspect">
							<InspectPanel docId={docId} />
						</TabsContent>
						<TabsContent value="findings">
							<div className="space-y-2">
								{(job.data?.findings ?? []).length === 0 && <p className="text-sm text-muted-foreground">아직 2차 검토 결과가 없습니다.</p>}
								{(job.data?.findings ?? []).map((f, i) => (
									<Card key={i} className="gap-1 py-3">
										<CardContent className="px-4 text-xs">
											<div className="flex items-center gap-2">
												<Badge variant={f.severity === "misleading" ? "destructive" : "secondary"}>{f.severity === "misleading" ? "오해 소지" : "경미"}</Badge>
												<span className="font-mono">{f.where}</span>
												<Badge variant="outline" className="ml-auto">
													{f.status === "fixed" ? "반영됨" : "남음"}
												</Badge>
											</div>
											<div className="mt-1.5">{f.problem}</div>
											<div className="mt-1 text-muted-foreground">고칠 방향: {f.fix}</div>
										</CardContent>
									</Card>
								))}
							</div>
						</TabsContent>
					</Tabs>
				</div>
			</div>
		</div>
	);
}

function InspectPanel({ docId }: { docId: string }) {
	const qc = useQueryClient();
	const job = useQuery({ queryKey: ["job", docId], queryFn: () => api.getJob({ docId }) });
	const overlays = job.data?.overlays ?? [];
	const fixes = job.data?.fixes ?? [];
	const [page, setPage] = useState<number | null>(null);
	const shown = overlays.find((o) => o.page === page) ?? overlays[0];
	const toggle = async (i: number, enabled: boolean) => {
		await api.setFixEnabled({ docId, index: i, enabled });
		qc.invalidateQueries({ queryKey: ["job", docId] });
	};
	if (!overlays.length) return <p className="text-sm text-muted-foreground">페이지 검수 단계가 끝나면 문단 경계를 그린 페이지와 보정 목록이 여기에 나옵니다.</p>;
	return (
		<div className="grid grid-cols-[1fr_minmax(260px,340px)] gap-4">
			<div>
				<div className="mb-2 flex flex-wrap gap-1">
					{overlays.map((o) => (
						<Button key={o.page} size="sm" variant={shown?.page === o.page ? "default" : "outline"} onClick={() => setPage(o.page)}>
							{o.page}쪽
						</Button>
					))}
				</div>
				{shown && <img src={fileUrl(`/files/${docId}/pages/${shown.path.split("/").pop()}`)} alt={`${shown.page}쪽 검수 이미지`} className="w-full rounded border" />}
			</div>
			<Card className="h-fit gap-2 py-4">
				<CardHeader className="px-4">
					<CardTitle className="text-sm">AI가 제안한 보정 {fixes.length}건</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2 px-4">
					{fixes.map((f, i) => (
						<div key={i} className="flex items-start gap-2 rounded border p-2 text-xs">
							<Switch checked={f.enabled !== false} onCheckedChange={(v) => toggle(i, v)} />
							<div className="min-w-0">
								<div className="font-mono">
									{f.op} {(f.ids ?? [f.id]).filter(Boolean).join(", ")} {f.to ? `→ ${f.to}` : ""}
									{f.page ? ` p.${f.page}` : ""}
								</div>
								<div className="text-muted-foreground">{f.why}</div>
							</div>
						</div>
					))}
					{fixes.length > 0 && (
						<Button
							size="sm"
							variant="outline"
							className="w-full"
							onClick={async () => {
								if (!confirm("보정을 다시 적용하면 문단 번호가 바뀌어 해설을 처음부터 다시 씁니다 (API 비용 발생). 계속할까요?")) return;
								await api.reapplyFixes({ docId });
								qc.invalidateQueries({ queryKey: ["job", docId] });
							}}
						>
							선택한 보정으로 다시 적용
						</Button>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

export { STAGES };
