import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileText, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Stepper, StepperContent, StepperIndicator, StepperItem, StepperNav, StepperSeparator, StepperTitle, StepperTrigger } from "@/components/reui/stepper";
import { api } from "@/lib/rpc";
import { useApp } from "@/lib/store";
import type { Brief, Density, Purpose } from "../../../shared/types";

const PURPOSES: { value: Purpose; label: string; hint: string }[] = [
	{ value: "whole argument", label: "전체 논증", hint: "질문 → 설계 → 결과 → 해석의 흐름을 다 따라갑니다 (추천)" },
	{ value: "core claims only", label: "핵심 주장만", hint: "결론과 그 근거가 되는 결과에 정독을 모읍니다" },
	{ value: "method and design only", label: "방법론·연구 설계", hint: "무작위 배정, 결과 지표, 통계 모형, 비뚤림 통제를 정독합니다" },
	{ value: "evidence to cite", label: "인용할 근거", hint: "효과 크기·신뢰구간과 그 조건을 정확히 짚습니다" },
	{ value: "exam or journal club", label: "시험·저널클럽 준비", hint: "강점·한계와 되짚기 질문을 넉넉히 만듭니다" },
];
const FAMILIAR = ["처음 보는 분야", "분야는 알지만 이 논문은 처음", "이 분야 연구자"];
const DENSITY: { value: Density; label: string }[] = [
	{ value: "low", label: "적게 (약 15%)" },
	{ value: "medium", label: "보통 (약 25%)" },
	{ value: "high", label: "많이 (약 40%)" },
];

export function BriefDialog() {
	const { briefFor, setBriefFor, go } = useApp();
	const qc = useQueryClient();
	const docId = briefFor?.[0] ?? null;
	const [step, setStep] = useState(1);
	const [purpose, setPurpose] = useState<Purpose>("whole argument");
	const [familiar, setFamiliar] = useState(FAMILIAR[1]);
	const [density, setDensity] = useState<Density>("medium");
	const [questions, setQuestions] = useState("");
	const [pages, setPages] = useState("");
	const [busy, setBusy] = useState(false);
	const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings({}) });
	const probe = useQuery({ queryKey: ["probe", docId], queryFn: () => api.probe({ docId: docId! }), enabled: !!docId });
	const docs = useQuery({ queryKey: ["docs"], queryFn: () => api.listDocs({}) });
	const doc = docs.data?.find((d) => d.id === docId);

	useEffect(() => {
		setStep(1);
		setPages("");
		setQuestions("");
		if (settings.data) setDensity(settings.data.defaultDensity);
	}, [docId, settings.data]);

	const close = () => setBriefFor(briefFor && briefFor.length > 1 ? briefFor.slice(1) : null);

	const start = async (useDefaults: boolean) => {
		if (!docId) return;
		setBusy(true);
		const brief: Brief = useDefaults
			? { purpose: "whole argument", familiarity: "", density: "medium", questions: [], notesLang: "ko" }
			: {
					purpose,
					familiarity: familiar,
					density,
					questions: questions
						.split("\n")
						.map((q) => q.trim())
						.filter(Boolean),
					notesLang: settings.data?.notesLang ?? "ko",
					pages: pages.trim() || null,
				};
		try {
			await api.setBrief({ docId, brief });
			await api.startJob({ docId });
			qc.invalidateQueries({ queryKey: ["docs"] });
			const multiple = (briefFor?.length ?? 0) > 1;
			close();
			if (!multiple) go({ name: "processing", docId });
			toast.success(useDefaults ? "기본값(전체 논증, 보통 밀도)으로 시작했습니다" : "처리를 시작했습니다");
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setBusy(false);
		}
	};

	const steps = ["파일 확인", "읽는 목적", "친숙도·밀도", "궁금한 점", "시작"];

	return (
		<Dialog open={!!docId} onOpenChange={(o) => !o && close()}>
			<DialogContent className="sm:max-w-2xl" data-testid="brief-dialog">
				<DialogHeader>
					<DialogTitle>읽기 전에 짧게 물어볼게요</DialogTitle>
					<DialogDescription>답에 따라 어떤 문단을 정독으로 고를지가 달라집니다. 잘 모르겠으면 "알아서"를 누르세요.</DialogDescription>
				</DialogHeader>
				<Stepper value={step} onValueChange={setStep} className="space-y-5">
					<StepperNav>
						{steps.map((t, i) => (
							<StepperItem key={t} step={i + 1} completed={step > i + 1} className="relative flex-1 items-start">
								<StepperTrigger className="flex grow flex-col items-start gap-1.5">
									<StepperIndicator className="size-6 text-xs data-[state=active]:bg-primary data-[state=completed]:bg-primary data-[state=active]:text-primary-foreground data-[state=completed]:text-primary-foreground">
										{step > i + 1 ? <Check className="size-3.5" /> : i + 1}
									</StepperIndicator>
									<StepperTitle className="text-xs">{t}</StepperTitle>
								</StepperTrigger>
								{i < steps.length - 1 && <StepperSeparator className="absolute top-3 left-8 h-px w-[calc(100%-2.5rem)] bg-border" />}
							</StepperItem>
						))}
					</StepperNav>

					<div className="min-h-56">
						<StepperContent value={1}>
							<div className="flex gap-3 rounded-lg border p-4">
								<FileText className="mt-0.5 size-5 text-muted-foreground" />
								<div className="text-sm">
									<div className="font-medium">{doc?.fileName ?? "…"}</div>
									{probe.isLoading && (
										<div className="mt-1 flex items-center gap-1.5 text-muted-foreground">
											<Loader2 className="size-3.5 animate-spin" /> PDF 확인 중
										</div>
									)}
									{probe.data && (
										<ul className="mt-1 space-y-0.5 text-muted-foreground">
											<li>{probe.data.pages}쪽</li>
											<li>{probe.data.scanned ? "스캔본으로 보입니다: 텍스트 층이 거의 없습니다." : "텍스트 층이 있는 PDF입니다."}</li>
											{probe.data.scanned && !probe.data.mineru && <li className="text-destructive">스캔본은 MinerU 설치가 필요합니다 (설정 참고).</li>}
											{probe.data.meta?.Title && <li>제목(메타데이터): {probe.data.meta.Title}</li>}
										</ul>
									)}
									{probe.error && <div className="mt-1 text-destructive">{(probe.error as Error).message}</div>}
								</div>
							</div>
							<div className="mt-4 space-y-1.5">
								<Label htmlFor="pages">처리할 페이지 (선택)</Label>
								<Input id="pages" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="예: 1-12 (부록·보충자료를 빼고 싶을 때)" />
							</div>
						</StepperContent>
						<StepperContent value={2}>
							<RadioGroup value={purpose} onValueChange={(v) => setPurpose(v as Purpose)} className="gap-2">
								{PURPOSES.map((p) => (
									<Label key={p.value} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary">
										<RadioGroupItem value={p.value} className="mt-0.5" />
										<div>
											<div className="text-sm font-medium">{p.label}</div>
											<div className="text-xs text-muted-foreground">{p.hint}</div>
										</div>
									</Label>
								))}
							</RadioGroup>
						</StepperContent>
						<StepperContent value={3}>
							<div className="space-y-4">
								<div className="space-y-2">
									<Label>이 분야와 논문에 얼마나 익숙한가요?</Label>
									<RadioGroup value={familiar} onValueChange={setFamiliar} className="gap-2">
										{FAMILIAR.map((f) => (
											<Label key={f} className="flex items-center gap-2 font-normal">
												<RadioGroupItem value={f} /> {f}
											</Label>
										))}
									</RadioGroup>
								</div>
								<div className="space-y-2">
									<Label>정독할 문단의 양</Label>
									<RadioGroup value={density} onValueChange={(v) => setDensity(v as Density)} className="flex gap-4">
										{DENSITY.map((d) => (
											<Label key={d.value} className="flex items-center gap-2 font-normal">
												<RadioGroupItem value={d.value} /> {d.label}
											</Label>
										))}
									</RadioGroup>
								</div>
							</div>
						</StepperContent>
						<StepperContent value={4}>
							<Label htmlFor="qs">답을 알고 싶은 질문 (한 줄에 하나, 선택)</Label>
							<Textarea
								id="qs"
								className="mt-2 min-h-32"
								value={questions}
								onChange={(e) => setQuestions(e.target.value)}
								placeholder={"예: 1차 결과 지표는 무엇이고 효과 크기는 얼마인가?\n눈가림은 어떻게 했나?"}
							/>
							<p className="mt-2 text-xs text-muted-foreground">질문마다 답과 근거 문단을 찾아 Reader 맨 위에 보여 줍니다.</p>
						</StepperContent>
						<StepperContent value={5}>
							<div className="space-y-2 rounded-lg border p-4 text-sm">
								<div>
									<span className="text-muted-foreground">목적:</span> {PURPOSES.find((p) => p.value === purpose)?.label}
								</div>
								<div>
									<span className="text-muted-foreground">친숙도:</span> {familiar}
								</div>
								<div>
									<span className="text-muted-foreground">정독 밀도:</span> {DENSITY.find((d) => d.value === density)?.label}
								</div>
								<div>
									<span className="text-muted-foreground">질문:</span> {questions.split("\n").filter((q) => q.trim()).length}개
								</div>
								<p className="pt-2 text-xs text-muted-foreground">
									추출 → 페이지 검수 → 논문 이해 → 해설 작성 → 수식·그림 해설 → 검증 → 2차 검토 순으로 진행합니다. 10쪽 논문 기준 몇 분이 걸리고, 토큰 사용량은 처리 화면에 단계별로 표시됩니다
									{settings.data?.llmBackend === "api" ? ` (문서당 상한 $${settings.data.costCapUsd})` : " (Claude 구독 사용)"}.
								</p>
							</div>
						</StepperContent>
					</div>
				</Stepper>
				<DialogFooter className="sm:justify-between">
					<Button variant="ghost" onClick={() => start(true)} disabled={busy}>
						<Sparkles /> 알아서 (기본값으로 시작)
					</Button>
					<div className="flex gap-2">
						<Button variant="outline" disabled={step === 1} onClick={() => setStep(step - 1)}>
							이전
						</Button>
						{step < steps.length ? (
							<Button onClick={() => setStep(step + 1)}>다음</Button>
						) : (
							<Button onClick={() => start(false)} disabled={busy} data-testid="brief-start">
								{busy && <Loader2 className="animate-spin" />} 시작
							</Button>
						)}
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
