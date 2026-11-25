import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, on } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { MathText } from "./MathText";

type Msg = { role: "user" | "assistant"; text: string; pid?: string | null };

/** Questions about the paper. Answers quote the original first and keep the authors' claims apart (SKILL.md). */
export function ChatPanel({ docId, pid, seed, onSeedUsed }: { docId: string; pid: string | null; seed: string | null; onSeedUsed: () => void }) {
	const [msgs, setMsgs] = useState<Msg[]>([]);
	const [input, setInput] = useState("");
	const [stream, setStream] = useState<string | null>(null);
	const end = useRef<HTMLDivElement>(null);
	const live = useRef<{ id: string | null; waiting: boolean }>({ id: null, waiting: false });

	useEffect(() => {
		if (seed) {
			setInput(seed);
			onSeedUsed();
		}
	}, [seed, onSeedUsed]);

	useEffect(
		() =>
			on("chatDelta", (m) => {
				// deltas can arrive before askAbout() resolves: adopt the first stream while waiting
				if (live.current.waiting && !live.current.id) live.current.id = m.streamId;
				if (m.streamId !== live.current.id) return;
				setMsgs((cur) => {
					const last = cur[cur.length - 1];
					const next = [...cur];
					if (last?.role === "assistant") next[next.length - 1] = { ...last, text: last.text + m.text + (m.error ? `\n\n(오류: ${m.error})` : "") };
					return next;
				});
				if (m.done) {
					live.current = { id: null, waiting: false };
					setStream(null);
				}
			}),
		[],
	);

	useEffect(() => {
		// braces: newer engines return a Promise from scrollIntoView, and an effect must not return one
		end.current?.scrollIntoView({ block: "end" });
	}, [msgs]);

	const send = async () => {
		const q = input.trim();
		if (!q || stream) return;
		const history = msgs.map((m) => ({ role: m.role, text: m.text }));
		setMsgs([...msgs, { role: "user", text: q, pid }, { role: "assistant", text: "" }]);
		setInput("");
		live.current = { id: null, waiting: true };
		setStream("pending");
		try {
			const { streamId } = await api.askAbout({ docId, pid, question: q, history });
			if (live.current.waiting && !live.current.id) live.current.id = streamId;
		} catch (e) {
			live.current = { id: null, waiting: false };
			setStream(null);
			setMsgs((cur) => [...cur.slice(0, -1), { role: "assistant", text: `오류: ${(e as Error).message}` }]);
		}
	};

	return (
		<div className="flex h-full flex-col">
			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
				{msgs.length === 0 && (
					<p className="text-xs text-muted-foreground">
						논문에 대해 물어보세요. {pid ? `지금 보고 있는 ${pid} 문단을 함께 보냅니다.` : ""} 답은 원문 인용을 먼저 보여 주고, 저자의 주장과 AI의 설명을 구분합니다.
					</p>
				)}
				{msgs.map((m, i) => (
					<div key={i} className={cn("rounded-lg px-3 py-2 text-sm whitespace-pre-wrap", m.role === "user" ? "ml-6 bg-primary text-primary-foreground" : "mr-2 bg-muted")}>
						{m.role === "user" && m.pid && <div className="mb-0.5 text-[10px] opacity-75">{m.pid}에 대해</div>}
						{m.role === "assistant" && !m.text && stream ? <Loader2 className="size-4 animate-spin" /> : <MathText text={m.text} />}
					</div>
				))}
				<div ref={end} />
			</div>
			<div className="flex gap-2 border-t p-2">
				<Textarea
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault();
							void send();
						}
					}}
					placeholder={pid ? `${pid}에 대해 질문…` : "질문…"}
					className="min-h-10 resize-none text-sm"
					data-testid="chat-input"
				/>
				<Button size="icon" onClick={send} disabled={!!stream || !input.trim()}>
					<Send />
				</Button>
			</div>
		</div>
	);
}
