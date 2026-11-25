import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookOpenText, Clock, FileUp, Loader2, MoreHorizontal, Play, RotateCcw, Search, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, isDesktop, uploadPdf } from "@/lib/rpc";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { DocStatus, DocSummary } from "../../../shared/types";
import { STAGE_LABEL } from "../../../shared/types";

export const STATUS: Record<DocStatus, { label: string; cls: string }> = {
	imported: { label: "브리핑 대기", cls: "bg-secondary text-secondary-foreground" },
	queued: { label: "대기 중", cls: "bg-secondary text-secondary-foreground" },
	processing: { label: "처리 중", cls: "bg-primary/15 text-primary" },
	awaiting_fixes: { label: "보정 확인 대기", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
	needs_review: { label: "검토 필요", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
	done: { label: "완료", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
	failed: { label: "실패", cls: "bg-destructive/15 text-destructive" },
	canceled: { label: "취소됨", cls: "bg-secondary text-muted-foreground" },
};

type Filter = "all" | "active" | "done" | "attention";

export function LibraryView() {
	const qc = useQueryClient();
	const { go, setBriefFor } = useApp();
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<Filter>("all");
	const [genre, setGenre] = useState<string | null>(null);
	const [drag, setDrag] = useState(false);
	const docs = useQuery({ queryKey: ["docs"], queryFn: () => api.listDocs({}) });
	const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings({}) });

	const importPaths = useMutation({
		mutationFn: (paths: string[]) => api.importPdfs({ paths }),
		onSuccess: ({ docIds }) => {
			qc.invalidateQueries({ queryKey: ["docs"] });
			if (docIds.length) setBriefFor(docIds);
			else toast.error("PDF 파일을 찾지 못했습니다");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const pick = async () => {
		const { paths } = await api.pickPdfs({});
		if (paths.length) importPaths.mutate(paths);
	};

	const dropFiles = useMutation({
		mutationFn: async (files: File[]) => {
			const ids: string[] = [];
			const errors: string[] = [];
			for (const f of files) {
				try {
					ids.push(await uploadPdf(f));
				} catch (e) {
					errors.push((e as Error).message);
				}
			}
			return { ids, errors };
		},
		onSuccess: ({ ids, errors }) => {
			qc.invalidateQueries({ queryKey: ["docs"] });
			for (const m of errors) toast.error(m);
			if (ids.length) setBriefFor(ids);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const onDrop = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setDrag(false);
		const files = Array.from(e.dataTransfer.files);
		const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
		if (!pdfs.length) {
			toast.error(files.length ? "PDF 파일만 넣을 수 있습니다" : "끌어다 놓은 파일을 읽지 못했습니다");
			return;
		}
		if (pdfs.length < files.length) toast.warning(`PDF가 아닌 파일 ${files.length - pdfs.length}개는 건너뜁니다`);
		dropFiles.mutate(pdfs);
	};

	// Files dropped outside the drop zone must not make the webview navigate to them.
	useEffect(() => {
		const stop = (e: DragEvent) => e.preventDefault();
		window.addEventListener("dragover", stop);
		window.addEventListener("drop", stop);
		return () => {
			window.removeEventListener("dragover", stop);
			window.removeEventListener("drop", stop);
		};
	}, []);

	const busy = importPaths.isPending || dropFiles.isPending;

	const genres = useMemo(() => [...new Set((docs.data ?? []).map((d) => d.genre).filter(Boolean))] as string[], [docs.data]);
	const rows = useMemo(() => {
		const q = query.trim().toLowerCase();
		return (docs.data ?? []).filter((d) => {
			if (q && ![d.title, d.authors, d.journal, d.genre, d.doi, d.fileName].some((x) => (x ?? "").toLowerCase().includes(q))) return false;
			if (genre && d.genre !== genre) return false;
			if (filter === "active") return d.status === "processing" || d.status === "queued" || d.status === "imported";
			if (filter === "done") return d.status === "done";
			if (filter === "attention") return d.status === "needs_review" || d.status === "awaiting_fixes" || d.status === "failed" || d.status === "canceled";
			return true;
		});
	}, [docs.data, query, filter, genre]);

	const total = (docs.data ?? []).reduce((a, d) => a + d.costUsd, 0);

	return (
		<div className="flex h-full flex-col">
			<header className="flex items-center gap-3 border-b px-6 py-4">
				<div>
					<h1 className="text-lg font-semibold">라이브러리</h1>
					<p className="text-xs text-muted-foreground">
						논문 {docs.data?.length ?? 0}편 · 누적 API 비용 ${total.toFixed(2)}
					</p>
				</div>
				<div className="ml-auto flex items-center gap-2">
					<div className="relative">
						<Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
						<Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제목, 저자, 저널, DOI 검색" className="w-72 pl-8" />
					</div>
					<Button onClick={pick} disabled={busy}>
						{busy ? <Loader2 className="animate-spin" /> : <FileUp />} PDF 추가
					</Button>
				</div>
			</header>

			<div className="flex flex-col gap-3 px-6 pt-4">
				{settings.data && (settings.data.llmBackend === "api" ? !settings.data.hasApiKey : !settings.data.claudeOk) && (
					<Alert>
						<AlertTriangle />
						<AlertTitle>{settings.data.llmBackend === "api" ? "Anthropic API 키가 없습니다" : "Claude Code 로그인을 찾지 못했습니다"}</AlertTitle>
						<AlertDescription>
							해설 작성에는 Claude 연결이 필요합니다.{" "}
							<button className="underline" onClick={() => go({ name: "settings" })}>
								설정에서 연결 방식을 확인하세요.
							</button>
						</AlertDescription>
					</Alert>
				)}
				{settings.data && !settings.data.engineOk && (
					<Alert variant="destructive">
						<AlertTriangle />
						<AlertTitle>PDF 엔진(Python)을 실행할 수 없습니다</AlertTitle>
						<AlertDescription className="font-mono text-xs">{settings.data.engineInfo}</AlertDescription>
					</Alert>
				)}
				<div
					onDragOver={(e) => {
						e.preventDefault();
						setDrag(true);
					}}
					onDragLeave={(e) => {
						if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false);
					}}
					onDrop={onDrop}
					onClick={() => !busy && void pick()}
					data-testid="dropzone"
					className={cn(
						"flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-6 py-7 text-center transition",
						drag ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40",
					)}
				>
					<FileUp className="size-6 text-muted-foreground" />
					<div className="text-sm font-medium">논문 PDF를 여기에 끌어다 놓거나 클릭해서 고르세요</div>
					<div className="text-xs text-muted-foreground">여러 편을 한 번에 넣을 수 있습니다. 원문은 바뀌지 않고, 해설은 한국어로 붙습니다.</div>
					{!isDesktop && <div className="text-[11px] text-muted-foreground">(브라우저 개발 모드)</div>}
				</div>
				<div className="flex items-center gap-3">
					<ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} variant="outline" size="sm">
						<ToggleGroupItem value="all">전체</ToggleGroupItem>
						<ToggleGroupItem value="active">진행 중</ToggleGroupItem>
						<ToggleGroupItem value="done">완료</ToggleGroupItem>
						<ToggleGroupItem value="attention">확인 필요</ToggleGroupItem>
					</ToggleGroup>
					{genres.length > 0 && (
						<div className="flex flex-wrap items-center gap-1.5">
							{genres.map((g) => (
								<Badge key={g} variant={genre === g ? "default" : "outline"} className="cursor-pointer" onClick={() => setGenre(genre === g ? null : g)}>
									{g}
								</Badge>
							))}
						</div>
					)}
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-auto px-6 py-3">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-[38%]">제목</TableHead>
							<TableHead>저널 · 연도</TableHead>
							<TableHead>장르</TableHead>
							<TableHead>상태</TableHead>
							<TableHead className="text-right">정독 비율</TableHead>
							<TableHead className="text-right">비용</TableHead>
							<TableHead>추가일</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.length === 0 && (
							<TableRow>
								<TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
									{docs.isLoading ? "불러오는 중…" : "아직 논문이 없습니다."}
								</TableCell>
							</TableRow>
						)}
						{rows.map((d) => (
							<DocRow key={d.id} d={d} />
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}

function DocRow({ d }: { d: DocSummary }) {
	const qc = useQueryClient();
	const { go, setBriefFor } = useApp();
	const st = STATUS[d.status];
	const open = () => {
		if (d.status === "done" || d.status === "needs_review") go({ name: "reader", docId: d.id });
		else if (d.status === "imported") setBriefFor([d.id]);
		else go({ name: "processing", docId: d.id });
	};
	const restart = async () => {
		try {
			await api.startJob({ docId: d.id });
			qc.invalidateQueries({ queryKey: ["docs"] });
			toast.success("처리 대기열에 넣었습니다");
		} catch (e) {
			toast.error((e as Error).message);
		}
	};
	const del = async () => {
		if (!confirm(`"${d.title}"을(를) 라이브러리에서 지웁니다. 해설과 메모도 함께 지워집니다.`)) return;
		await api.deleteDoc({ docId: d.id });
		qc.invalidateQueries({ queryKey: ["docs"] });
	};
	return (
		<TableRow className="cursor-pointer" onClick={open} data-testid={`doc-${d.id}`}>
			<TableCell>
				<div className="line-clamp-2 font-medium">{d.title}</div>
				<div className="truncate text-xs text-muted-foreground">{d.authors ?? d.fileName}</div>
			</TableCell>
			<TableCell className="text-xs">
				{[d.journal, d.year].filter(Boolean).join(" · ") || "-"}
				{d.pageCount ? <div className="text-muted-foreground">{d.pageCount}쪽</div> : null}
			</TableCell>
			<TableCell className="max-w-40 truncate text-xs">{d.genre ?? "-"}</TableCell>
			<TableCell>
				<Badge className={cn("border-0", st.cls)}>
					{d.status === "processing" && <Loader2 className="animate-spin" />}
					{d.status === "queued" && <Clock />}
					{st.label}
					{d.status === "queued" && d.queuePosition ? ` (${d.queuePosition}번째)` : ""}
				</Badge>
				{d.status === "processing" && <JobProgress d={d} />}
				{d.status === "failed" && d.error && <div className="mt-1 line-clamp-2 max-w-56 text-[11px] text-destructive">{d.error}</div>}
			</TableCell>
			<TableCell className="text-right text-xs">{d.closeShare != null ? `${Math.round(d.closeShare * 100)}%` : "-"}</TableCell>
			<TableCell className="text-right text-xs">${d.costUsd.toFixed(2)}</TableCell>
			<TableCell className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString("ko-KR")}</TableCell>
			<TableCell onClick={(e) => e.stopPropagation()}>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon" className="size-7">
							<MoreHorizontal />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{(d.status === "done" || d.status === "needs_review") && (
							<DropdownMenuItem onClick={() => go({ name: "reader", docId: d.id })}>
								<BookOpenText /> 읽기
							</DropdownMenuItem>
						)}
						<DropdownMenuItem onClick={() => go({ name: "processing", docId: d.id })}>
							<Play /> 처리 과정 보기
						</DropdownMenuItem>
						{(d.status === "failed" || d.status === "canceled") && (
							<DropdownMenuItem onClick={restart}>
								<RotateCcw /> 이어서 처리
							</DropdownMenuItem>
						)}
						{d.status === "imported" && <DropdownMenuItem onClick={() => setBriefFor([d.id])}>브리핑하고 시작</DropdownMenuItem>}
						{(d.status === "processing" || d.status === "queued") && (
							<DropdownMenuItem onClick={() => api.cancelJob({ docId: d.id }).then(() => qc.invalidateQueries({ queryKey: ["docs"] }))}>
								<Square /> {d.status === "queued" ? "대기 취소" : "처리 취소"}
							</DropdownMenuItem>
						)}
						<DropdownMenuSeparator />
						<DropdownMenuItem className="text-destructive" onClick={del}>
							<Trash2 /> 삭제
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</TableCell>
		</TableRow>
	);
}

/** Per-paper progress while processing: a thin bar, the current stage and its latest message. */
function JobProgress({ d }: { d: DocSummary }) {
	const pct = Math.round((d.progress ?? 0) * 100);
	return (
		<div className="mt-1.5 w-44" data-testid={`progress-${d.id}`}>
			<div className="flex items-center justify-between text-[11px] text-muted-foreground">
				<span className="truncate">{STAGE_LABEL[d.stage]}</span>
				<span className="tabular-nums">{pct}%</span>
			</div>
			<div className="mt-0.5 h-1 overflow-hidden rounded-full bg-secondary">
				<div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
			</div>
			{d.progressMsg && <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{d.progressMsg}</div>}
		</div>
	);
}
