import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenText, Clock, FlaskConical, Library as LibraryIcon, Loader2, Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, on } from "@/lib/rpc";
import { useApp } from "@/lib/store";
import { LibraryView } from "@/features/library/LibraryView";
import { BriefDialog } from "@/features/library/BriefDialog";
import { ProcessingView } from "@/features/processing/ProcessingView";
import { ReaderView } from "@/features/reader/ReaderView";
import { SettingsView } from "@/features/settings/SettingsView";
import { DataNotice } from "@/features/settings/DataNotice";
import type { DocSummary } from "../shared/types";

export default function App() {
	const { view, go, dark, toggleDark } = useApp();
	const qc = useQueryClient();
	const docs = useQuery({
		queryKey: ["docs"],
		queryFn: () => api.listDocs({}),
	});

	useEffect(() => {
		document.documentElement.classList.toggle("dark", dark);
	}, [dark]);

	useEffect(() => {
		const offs = [
			on("docsChanged", () => qc.invalidateQueries({ queryKey: ["docs"] })),
			on("jobProgress", (m) => {
				// update the library row in place so its progress bar moves without refetching the list
				qc.setQueryData<DocSummary[]>(["docs"], (old) =>
					old?.map((d) => (d.id === m.docId ? { ...d, status: "processing", stage: m.stage, progress: m.progress ?? d.progress, progressMsg: m.msg } : d)),
				);
				qc.invalidateQueries({ queryKey: ["job", m.docId] });
				if (m.status === "done" || m.status === "failed" || m.status === "skipped") qc.invalidateQueries({ queryKey: ["docs"] });
			}),
			on("jobDone", (m) => {
				qc.invalidateQueries({ queryKey: ["docs"] });
				qc.invalidateQueries({ queryKey: ["job", m.docId] });
				qc.invalidateQueries({ queryKey: ["reader", m.docId] });
				if (m.ok) toast.success("해설이 준비되었습니다", { action: { label: "열기", onClick: () => go({ name: "reader", docId: m.docId }) } });
				else toast.error(`처리 중단: ${m.error ?? ""}`);
			}),
		];
		return () => offs.forEach((f) => f());
	}, [qc, go]);

	const processing = (docs.data ?? []).filter((d) => d.status === "processing" || d.status === "queued");
	const nav = [
		{ key: "library", label: "라이브러리", icon: LibraryIcon, active: view.name === "library", onClick: () => go({ name: "library" }) },
		{ key: "settings", label: "설정", icon: SettingsIcon, active: view.name === "settings", onClick: () => go({ name: "settings" }) },
	];

	return (
		<div className="flex h-full">
			<aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar">
				<div className="flex items-center gap-2 px-4 pt-4 pb-3">
					<FlaskConical className="size-5 text-primary" />
					<div>
						<div className="text-sm font-semibold leading-tight">PDF Dissector</div>
						<div className="text-[11px] text-muted-foreground">논문 정독 가이드</div>
					</div>
				</div>
				<nav className="flex flex-col gap-0.5 px-2">
					{nav.map((n) => (
						<button
							key={n.key}
							onClick={n.onClick}
							className={cn("flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent", n.active && "bg-accent font-medium")}
						>
							<n.icon className="size-4" /> {n.label}
						</button>
					))}
				</nav>
				<div className="mt-4 px-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">처리 중</div>
				<div className="flex flex-col gap-0.5 px-2 pt-1">
					{processing.length === 0 && <div className="px-2.5 py-1 text-xs text-muted-foreground">없음</div>}
					{processing.map((d) => (
						<button
							key={d.id}
							onClick={() => go({ name: "processing", docId: d.id })}
							className={cn(
								"flex items-center gap-2 truncate rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-accent",
								view.name === "processing" && view.docId === d.id && "bg-accent",
							)}
						>
							{d.status === "queued" ? <Clock className="size-3.5 shrink-0 text-muted-foreground" /> : <Loader2 className="size-3.5 shrink-0 animate-spin" />}
							<span className="truncate">{d.title}</span>
							<span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
								{d.status === "queued" ? "대기" : d.progress != null ? `${Math.round(d.progress * 100)}%` : ""}
							</span>
						</button>
					))}
				</div>
				<div className="mt-4 px-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">최근 읽은 논문</div>
				<div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1">
					{(docs.data ?? [])
						.filter((d) => d.status === "done" || d.status === "needs_review")
						.slice(0, 12)
						.map((d) => (
							<button
								key={d.id}
								onClick={() => go({ name: "reader", docId: d.id })}
								className={cn(
									"flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-accent",
									view.name === "reader" && view.docId === d.id && "bg-accent",
								)}
							>
								<BookOpenText className="size-3.5 shrink-0" />
								<span className="truncate">{d.title}</span>
							</button>
						))}
				</div>
				<button onClick={toggleDark} className="m-2 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent">
					{dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />} {dark ? "밝은 화면" : "어두운 화면"}
				</button>
			</aside>
			<main className="min-w-0 flex-1">
				{view.name === "library" && <LibraryView />}
				{view.name === "processing" && <ProcessingView docId={view.docId} />}
				{view.name === "reader" && <ReaderView key={view.docId} docId={view.docId} initialPid={view.pid} />}
				{view.name === "settings" && <SettingsView />}
			</main>
			<BriefDialog />
			<DataNotice />
		</div>
	);
}
