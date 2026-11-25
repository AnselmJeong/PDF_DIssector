import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/rpc";
import type { Settings, UserRule } from "../../../shared/types";

const MODELS = [
	{ id: "claude-opus-5-5", label: "Claude Opus 5.5 ($4 / $20)" },
	{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 ($2 / $10)" },
	{ id: "claude-haiku-5-5", label: "Claude Haiku 5.5 ($0.10 / $0.50)" },
	{ id: "claude-fable-5-2", label: "Claude Fable 5.2 ($8 / $40)" },
];

export function SettingsView() {
	const qc = useQueryClient();
	const s = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings({}) });
	const rules = useQuery({ queryKey: ["rules"], queryFn: () => api.listRules({}) });
	const [key, setKey] = useState("");
	const [rule, setRule] = useState("");
	const [scope, setScope] = useState<UserRule["scope"]>("method");

	const save = async (patch: Partial<Settings>) => {
		await api.setSettings({ settings: patch });
		qc.invalidateQueries({ queryKey: ["settings"] });
	};
	if (!s.data) return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>;
	const st = s.data;

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
				<h1 className="text-lg font-semibold">설정</h1>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">Claude 연결 방식</CardTitle>
						<CardDescription>구독 방식은 이 Mac에 로그인된 Claude Code(Pro/Max 구독)로 호출하므로 API 요금이 따로 나가지 않고 구독 사용량에서 차감됩니다.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						<RadioGroup value={st.llmBackend} onValueChange={(v) => save({ llmBackend: v as Settings["llmBackend"] })} className="gap-2">
							<Label className="flex items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary">
								<RadioGroupItem value="subscription" className="mt-0.5" data-testid="backend-subscription" />
								<div>
									<div className="text-sm font-medium">Claude 구독 (Claude Code 로그인)</div>
									<div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
										{st.claudeOk ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <XCircle className="size-3.5 text-destructive" />}
										<span className="font-mono break-all">{st.claudeInfo}</span>
									</div>
									{!st.claudeOk && (
										<div className="mt-1 text-xs">
											Claude Code를 설치한 뒤 터미널에서 <code className="rounded bg-muted px-1">claude</code>를 실행해 로그인하세요.
										</div>
									)}
								</div>
							</Label>
							<Label className="flex items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary">
								<RadioGroupItem value="api" className="mt-0.5" />
								<div>
									<div className="text-sm font-medium">Anthropic API 키</div>
									<div className="text-xs text-muted-foreground">토큰 사용량만큼 API 계정에 청구됩니다.</div>
								</div>
							</Label>
						</RadioGroup>
					</CardContent>
				</Card>

				{st.llmBackend === "api" && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<KeyRound className="size-4" /> Anthropic API 키
						</CardTitle>
						<CardDescription>macOS 키체인에 저장되고, 화면(웹뷰)으로는 전달되지 않습니다. 해설 작성은 앱의 메인 프로세스에서만 호출합니다.</CardDescription>
					</CardHeader>
					<CardContent className="flex items-center gap-2">
						<div className="flex items-center gap-1.5 text-sm">
							{st.hasApiKey ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-destructive" />}
							{st.hasApiKey ? "저장됨" : "없음"}
						</div>
						<Input type="password" placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} className="ml-2 flex-1" data-testid="api-key" />
						<Button
							onClick={async () => {
								try {
									await api.setApiKey({ key });
									setKey("");
									toast.success("API 키를 저장했습니다");
									qc.invalidateQueries({ queryKey: ["settings"] });
								} catch (e) {
									toast.error((e as Error).message);
								}
							}}
							disabled={!key.trim()}
						>
							저장
						</Button>
						{st.hasApiKey && (
							<Button
								variant="ghost"
								onClick={async () => {
									await api.setApiKey({ key: null });
									qc.invalidateQueries({ queryKey: ["settings"] });
								}}
							>
								삭제
							</Button>
						)}
					</CardContent>
				</Card>
				)}

				<Card>
					<CardHeader>
						<CardTitle className="text-base">모델과 비용</CardTitle>
						<CardDescription>
							가격은 입력 / 출력 100만 토큰당 달러입니다.{" "}
							{st.llmBackend === "subscription" ? "구독 방식에서는 청구되지 않고, 화면의 비용은 API로 환산한 참고값입니다." : "원 개발자 시험에서 6쪽 논문이 약 13만 토큰을 썼습니다."}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{(
							[
								["writer", "해설 작성 (논문 이해, 문단 해설, 수식·그림)"],
								["reviewer", "검수·2차 검토·질문 답변"],
								["helper", "빠른 모드의 2차 검토"],
							] as const
						).map(([k, label]) => (
							<div key={k} className="grid grid-cols-[220px_1fr] items-center gap-3">
								<Label>{label}</Label>
								<Select value={st.models[k]} onValueChange={(v) => save({ models: { ...st.models, [k]: v } })}>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{MODELS.map((m) => (
											<SelectItem key={m.id} value={m.id}>
												{m.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						))}
						<div className="grid grid-cols-[220px_1fr] items-center gap-3">
							<Label htmlFor="cap">문서당 비용 상한 (USD, API 방식만)</Label>
							<Input id="cap" type="number" min={0} step={0.5} defaultValue={st.costCapUsd} onBlur={(e) => save({ costCapUsd: Number(e.target.value) || 0 })} className="w-32" />
						</div>
						<div className="grid grid-cols-[220px_1fr] items-center gap-3">
							<Label htmlFor="conc">문단 해설 동시 호출 수</Label>
							<Input id="conc" type="number" min={1} max={6} defaultValue={st.concurrency} onBlur={(e) => save({ concurrency: Math.min(6, Math.max(1, Number(e.target.value) || 3)) })} className="w-32" />
						</div>
						<div className="grid grid-cols-[220px_1fr] items-center gap-3">
							<Label htmlFor="pdocs">동시에 처리할 논문 수</Label>
							<Input id="pdocs" type="number" min={1} max={4} defaultValue={st.parallelDocs} onBlur={(e) => save({ parallelDocs: Math.min(4, Math.max(1, Number(e.target.value) || 2)) })} className="w-32" />
						</div>
						<div className="flex items-center justify-between rounded-lg border p-3">
							<div>
								<div className="text-sm font-medium">빠른 모드</div>
								<div className="text-xs text-muted-foreground">수식·그림 심화 해설을 건너뛰고, 2차 검토를 보조 모델로 합니다.</div>
							</div>
							<Switch checked={st.fastMode} onCheckedChange={(v) => save({ fastMode: v })} />
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">읽기 기본값</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-[220px_1fr] items-center gap-3">
							<Label>기본 정독 밀도</Label>
							<Select value={st.defaultDensity} onValueChange={(v) => save({ defaultDensity: v as Settings["defaultDensity"] })}>
								<SelectTrigger className="w-48">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="low">적게 (15%)</SelectItem>
									<SelectItem value="medium">보통 (25%)</SelectItem>
									<SelectItem value="high">많이 (40%)</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid grid-cols-[220px_1fr] items-center gap-3">
							<Label>해설 언어</Label>
							<Select value={st.notesLang} onValueChange={(v) => save({ notesLang: v as Settings["notesLang"] })}>
								<SelectTrigger className="w-48">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="ko">한국어</SelectItem>
									<SelectItem value="en">English</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="flex items-center justify-between rounded-lg border p-3">
							<div>
								<div className="text-sm font-medium">3단계로 보기</div>
								<div className="text-xs text-muted-foreground">정독 / 훑어보기 / 생략 가능을 따로 표시합니다 (기본은 정독과 Skim 2범주).</div>
							</div>
							<Switch checked={st.threeTierView} onCheckedChange={(v) => save({ threeTierView: v })} />
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">나의 방법론 규칙</CardTitle>
						<CardDescription>"이런 문단은 항상 정독" 같은 규칙을 남기면 이후 모든 논문의 해설 프롬프트에 들어갑니다.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{(rules.data ?? []).map((r) => (
							<div key={r.id} className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
								<span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{r.scope === "method" ? "방법" : r.scope === "genre" ? "장르" : "문체"}</span>
								<span className="flex-1">{r.text}</span>
								<Button
									variant="ghost"
									size="icon"
									className="size-7"
									onClick={async () => {
										await api.deleteRule({ id: r.id });
										qc.invalidateQueries({ queryKey: ["rules"] });
									}}
								>
									<Trash2 />
								</Button>
							</div>
						))}
						<div className="flex gap-2">
							<Select value={scope} onValueChange={(v) => setScope(v as UserRule["scope"])}>
								<SelectTrigger className="w-28">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="method">방법</SelectItem>
									<SelectItem value="genre">장르</SelectItem>
									<SelectItem value="style">문체</SelectItem>
								</SelectContent>
							</Select>
							<Input value={rule} onChange={(e) => setRule(e.target.value)} placeholder="예: 표본 크기 계산 문단은 항상 정독" />
							<Button
								variant="outline"
								disabled={!rule.trim()}
								onClick={async () => {
									await api.addRule({ scope, text: rule.trim() });
									setRule("");
									qc.invalidateQueries({ queryKey: ["rules"] });
								}}
							>
								<Plus /> 추가
							</Button>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">PDF 엔진</CardTitle>
						<CardDescription>원문 추출과 검증은 내장 Python 엔진(pdfx)이 합니다. 스캔본·복잡한 레이아웃은 MinerU(약 0.8GB)를 따로 설치하면 쓸 수 있습니다.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2 text-sm">
						<div className="flex items-center gap-1.5">
							{st.engineOk ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-destructive" />}
							<span className="font-mono text-xs break-all">{st.engineInfo}</span>
						</div>
						<div className="text-xs text-muted-foreground">
							MinerU 설치: 터미널에서 <code className="rounded bg-muted px-1">uv tool install "mineru&gt;=4,&lt;5" && mineru-kit models download --tier basic</code> 후 앱을 다시
							실행하면 자동으로 사용합니다 (uv tool로 설치한 전역 MinerU를 찾습니다).
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
