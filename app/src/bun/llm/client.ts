// Claude API wrapper for the main process. The API key never leaves this process.
// Every call: structured JSON output (output_config.format) or plain text, prompt caching on the stable prefix,
// usage and cost accounting, and a request/response log under WORK/llm_log/.
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// $ per 1M tokens: input, output, cache read. Cache writes bill at 1.25x input.
export const PRICING: Record<string, { in: number; out: number; cacheRead: number }> = {
	"claude-fable-5-2": { in: 8, out: 40, cacheRead: 0.2 },
	"claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2 },
	"claude-opus-5": { in: 5, out: 25, cacheRead: 0.5 },
	"claude-opus-4-8": { in: 5, out: 25, cacheRead: 0.5 },
	"claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1 },
	"claude-sonnet-5": { in: 2, out: 10, cacheRead: 0.2 },
	"claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01 },
};

export type Usage = { tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number; costUsd: number; model: string };

export function costOf(model: string, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }) {
	const p = PRICING[model] ?? PRICING["claude-opus-5-5"];
	const cr = u.cache_read_input_tokens ?? 0;
	const cw = u.cache_creation_input_tokens ?? 0;
	return (u.input_tokens * p.in + cw * p.in * 1.25 + cr * p.cacheRead + u.output_tokens * p.out) / 1e6;
}

export type ImagePart = { mediaType: "image/png" | "image/jpeg"; base64: string; label?: string };

export interface CallSpec {
	model: string;
	system: string; // stable: cached
	context?: string; // stable per document (paragraph dump): cached
	prompt: string; // varies per call
	images?: ImagePart[];
	schema?: Record<string, unknown>; // JSON schema -> structured output
	effort?: "low" | "medium" | "high" | "xhigh" | "max";
	maxTokens?: number;
	tag: string; // for the log file name
	history?: { role: "user" | "assistant"; text: string }[];
}

export interface CallResult<T> {
	value: T;
	text: string;
	usage: Usage;
	stopReason: string | null;
}

export class LlmError extends Error {}

export class LlmClient {
	private client: Anthropic;
	constructor(
		apiKey: string,
		private logDir: string | null,
		private onUsage: (u: Usage, tag: string, logPath: string) => void,
	) {
		this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 15 * 60 * 1000 });
	}

	private build(spec: CallSpec) {
		const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: spec.system, cache_control: { type: "ephemeral" } }];
		const first: Anthropic.Beta.BetaContentBlockParam[] = [];
		if (spec.context) first.push({ type: "text", text: spec.context, cache_control: { type: "ephemeral" } });
		for (const im of spec.images ?? []) {
			if (im.label) first.push({ type: "text", text: im.label });
			first.push({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.base64 } });
		}
		const messages: Anthropic.Beta.BetaMessageParam[] = [];
		if (spec.history?.length) {
			// context goes with the first user turn so the cached prefix stays stable across chat turns
			const [h0, ...rest] = spec.history;
			messages.push({ role: "user", content: [...first, { type: "text", text: h0.text }] });
			for (const h of rest) messages.push({ role: h.role, content: h.text });
			messages.push({ role: "user", content: spec.prompt });
		} else {
			messages.push({ role: "user", content: [...first, { type: "text", text: spec.prompt }] });
		}
		const body: Anthropic.Beta.MessageCreateParamsStreaming = {
			model: spec.model,
			max_tokens: spec.maxTokens ?? 32000,
			system,
			messages,
			stream: true,
			betas: ["server-side-fallback-2026-07-01"],
			...(spec.model.startsWith("claude-haiku") ? {} : { fallbacks: "default" as const }),
			output_config: {
				...(spec.effort ? { effort: spec.effort } : {}),
				...(spec.schema ? { format: { type: "json_schema" as const, schema: spec.schema } } : {}),
			},
		};
		return body;
	}

	private log(tag: string, body: unknown, res: unknown) {
		if (!this.logDir) return "";
		mkdirSync(this.logDir, { recursive: true });
		const path = join(this.logDir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${tag}.json`);
		const scrub = JSON.parse(
			JSON.stringify(body, (k, v) => (k === "data" && typeof v === "string" && v.length > 200 ? `<base64 ${v.length} chars>` : v)),
		);
		writeFileSync(path, JSON.stringify({ request: scrub, response: res }, null, 1));
		return path;
	}

	private usageOf(msg: Anthropic.Beta.BetaMessage, model: string): Usage {
		const u = msg.usage;
		const served = msg.model || model;
		return {
			tokensIn: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
			tokensOut: u.output_tokens,
			cacheRead: u.cache_read_input_tokens ?? 0,
			cacheWrite: u.cache_creation_input_tokens ?? 0,
			costUsd: costOf(served, u),
			model: served,
		};
	}

	async call<T = unknown>(spec: CallSpec): Promise<CallResult<T>> {
		const body = this.build(spec);
		const stream = this.client.beta.messages.stream(body);
		const msg = await stream.finalMessage();
		const usage = this.usageOf(msg, spec.model);
		const text = msg.content
			.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
			.map((b) => b.text)
			.join("");
		const logPath = this.log(spec.tag, body, { stop_reason: msg.stop_reason, usage: msg.usage, model: msg.model, text });
		this.onUsage(usage, spec.tag, logPath);
		if (msg.stop_reason === "refusal") throw new LlmError(`모델이 요청을 거절했습니다 (${spec.tag})`);
		if (msg.stop_reason === "max_tokens") throw new LlmError(`출력이 max_tokens에서 잘렸습니다 (${spec.tag})`);
		let value: unknown = text;
		if (spec.schema) {
			try {
				value = JSON.parse(text);
			} catch {
				throw new LlmError(`JSON 출력 파싱 실패 (${spec.tag}): ${text.slice(0, 200)}`);
			}
		}
		return { value: value as T, text, usage, stopReason: msg.stop_reason };
	}

	/** Streaming text (chat). onDelta receives text pieces. */
	async streamText(spec: CallSpec, onDelta: (t: string) => void): Promise<CallResult<string>> {
		const body = this.build({ ...spec, schema: undefined });
		const stream = this.client.beta.messages.stream(body);
		stream.on("text", (t) => onDelta(t));
		const msg = await stream.finalMessage();
		const usage = this.usageOf(msg, spec.model);
		const text = msg.content
			.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
			.map((b) => b.text)
			.join("");
		const logPath = this.log(spec.tag, body, { stop_reason: msg.stop_reason, usage: msg.usage, text });
		this.onUsage(usage, spec.tag, logPath);
		return { value: text, text, usage, stopReason: msg.stop_reason };
	}
}

/** For tests: a client that replays canned answers keyed by tag prefix. */
export class ReplayClient {
	calls: CallSpec[] = [];
	constructor(private answers: (spec: CallSpec) => unknown) {}
	async call<T = unknown>(spec: CallSpec): Promise<CallResult<T>> {
		this.calls.push(spec);
		const value = this.answers(spec) as T;
		return {
			value,
			text: JSON.stringify(value),
			usage: { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, model: spec.model },
			stopReason: "end_turn",
		};
	}
	async streamText(spec: CallSpec, onDelta: (t: string) => void): Promise<CallResult<string>> {
		const v = String(this.answers(spec));
		onDelta(v);
		return { value: v, text: v, usage: { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, model: spec.model }, stopReason: "end_turn" };
	}
}

export type Llm = Pick<LlmClient, "call" | "streamText">;
