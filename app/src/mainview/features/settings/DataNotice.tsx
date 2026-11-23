import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/rpc";

/** First-run notice: the paper's text is sent to the Anthropic API (plan section 5.1). */
export function DataNotice() {
	const qc = useQueryClient();
	const s = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings({}) });
	const open = !!s.data && !s.data.acceptedDataNotice;
	return (
		<Dialog open={open}>
			<DialogContent showCloseButton={false} className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<ShieldAlert className="size-5" /> 처음 쓰기 전에
					</DialogTitle>
					<DialogDescription asChild>
						<div className="space-y-2 text-sm">
							<p>PDF Dissector는 해설을 쓰기 위해 논문 본문, 페이지 이미지, 그림을 Claude로 보냅니다. 기본값은 이 Mac에 로그인된 Claude Code(구독)를 쓰며 구독 사용량에서 차감됩니다. API 키 방식을 고르면 그 계정에 청구됩니다.</p>
							<p>원문 PDF와 해설, 메모는 이 컴퓨터에만 저장됩니다. 내보낸 HTML에는 원문이 들어 있으니 개인 학습용으로만 쓰세요.</p>
							<p>공개 원문(PMC) 연동을 위해 논문의 DOI로 Europe PMC를 조회합니다.</p>
						</div>
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						onClick={async () => {
							await api.setSettings({ settings: { acceptedDataNotice: true } });
							qc.invalidateQueries({ queryKey: ["settings"] });
						}}
					>
						이해했습니다
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
