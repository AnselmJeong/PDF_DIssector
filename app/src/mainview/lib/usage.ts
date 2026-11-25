// How LLM usage is shown. A Claude subscription is not billed per paper, so a dollar figure would
// mislead; there we show token counts instead and keep dollars for the API-key backend only.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/rpc";

/** True only when the app is set to bill an Anthropic API key. Unknown (still loading) counts as subscription. */
export function useApiBilling(): boolean {
	const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings({}) });
	return settings.data?.llmBackend === "api";
}

/** 1234 -> "1.2k", 2_500_000 -> "2.5M". */
export function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

/** One usage figure: dollars on the API backend, total tokens on the subscription. */
export function fmtUsage(u: { costUsd: number; tokensIn: number; tokensOut: number }, apiBilling: boolean, digits = 2): string {
	return apiBilling ? `$${u.costUsd.toFixed(digits)}` : `${fmtTokens(u.tokensIn + u.tokensOut)} 토큰`;
}
