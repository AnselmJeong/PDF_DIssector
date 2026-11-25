// LLM backend for Ollama's OpenAI-compatible API (Ollama Cloud at https://ollama.com/v1, or a local
// server at http://localhost:11434/v1). One configured model serves every role, so spec.model is
// ignored. Structured output goes through response_format json_schema, with the schema also stated in
// the system prompt because not every model honours the constraint. Calls stream so long generations
// don't hit gateway idle timeouts. Usage is logged with costUsd 0: Ollama bills by plan, not per token.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CallResult, CallSpec, Usage } from "./client";
import { LlmError } from "./client";

export const OLLAMA_CLOUD_URL = "https://ollama.com/v1";

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Msg = { role: "system" | "user" | "assistant"; content: string | Part[] };

/** Pull the JSON object out of a reply that may carry code fences or a preamble. */
export function parseJsonReply(text: string): unknown {
	const t = text.trim();
	try {
		return JSON.parse(t);
	} catch {
		/* fall through */
	}
	const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenced) {
		try {
			return JSON.parse(fenced[1]);
		} catch {
			/* fall through */
		}
	}
	const a = t.indexOf("{");
	const b = t.lastIndexOf("}");
	if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
	throw new Error("no JSON object");
}

export class OllamaClient {
	constructor(
		private baseUrl: string,
		private apiKey: string | null,
		private model: string,
		private logDir: string | null,
		private onUsage: (u: Usage, tag: string, logPath: string) => void,
		private timeoutMs = 25 * 60 * 1000,
		private fetchImpl: typeof fetch = fetch,
	) {}

	build(spec: CallSpec) {
		let system = spec.system;
		if (spec.schema) {
			system +=
				"\n\nReply with a single JSON object only (no prose, no code fences) that validates against this JSON Schema:\n" +
				JSON.stringify(spec.schema);
		}
		const first: Part[] = [];
		if (spec.context) first.push({ type: "text", text: spec.context });
		for (const im of spec.images ?? []) {
			if (im.label) first.push({ type: "text", text: im.label });
			first.push({ type: "image_url", image_url: { url: `data:${im.mediaType};base64,${im.base64}` } });
		}
		const messages: Msg[] = [{ role: "system", content: system }];
		if (spec.history?.length) {
			const [h0, ...rest] = spec.history;
			messages.push({ role: "user", content: [...first, { type: "text", text: h0.text }] });
			for (const h of rest) messages.push({ role: h.role, content: h.text });
			messages.push({ role: "user", content: spec.prompt });
		} else {
			messages.push({ role: "user", content: [...first, { type: "text", text: spec.prompt }] });
		}
		const body: Record<string, unknown> = {
			model: this.model,
			messages,
			stream: true,
			stream_options: { include_usage: true },
		};
		if (spec.maxTokens) body.max_tokens = spec.maxTokens;
		if (spec.schema) body.response_format = { type: "json_schema", json_schema: { name: spec.tag.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60) || "out", schema: spec.schema } };
		return body;
	}

	private async post(body: Record<string, unknown>, tag: string): Promise<Response> {
		const url = this.baseUrl.replace(/\/+$/, "") + "/chat/completions";
		const headers: Record<string, string> = { "content-type": "application/json" };
		if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
		let last = "";
		for (let attempt = 0; attempt < 4; attempt++) {
			if (attempt) await Bun.sleep(1000 * 2 ** attempt);
			let res: Response;
			try {
				res = await this.fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs) });
			} catch (e) {
				last = (e as Error).message;
				continue;
			}
			if (res.ok) return res;
			last = `HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`;
			if (res.status === 401 || res.status === 403) throw new LlmError(`Ollama 인증 실패 (${tag}): API 키를 확인하세요. ${last}`);
			if (res.status !== 429 && res.status < 500) break;
		}
		throw new LlmError(`Ollama 호출 실패 (${tag}): ${last}`);
	}

	private async run(spec: CallSpec, onDelta?: (t: string) => void) {
		const body = this.build(spec);
		const res = await this.post(body, spec.tag);
		let text = "";
		let finish: string | null = null;
		let usage: { prompt_tokens?: number; completion_tokens?: number } = {};
		let served = this.model;
		const dec = new TextDecoder();
		let buf = "";
		const handle = (line: string) => {
			if (!line.startsWith("data:")) return;
			const data = line.slice(5).trim();
			if (!data || data === "[DONE]") return;
			let e: {
				model?: string;
				error?: { message?: string } | string;
				usage?: typeof usage;
				choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
			};
			try {
				e = JSON.parse(data);
			} catch {
				return;
			}
			if (e.error) throw new LlmError(`Ollama 오류 (${spec.tag}): ${typeof e.error === "string" ? e.error : e.error.message}`);
			if (e.model) served = e.model;
			if (e.usage) usage = e.usage;
			const c = e.choices?.[0];
			const piece = c?.delta?.content;
			if (piece) {
				text += piece;
				onDelta?.(piece);
			}
			if (c?.finish_reason) finish = c.finish_reason;
		};
		for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
			buf += dec.decode(chunk, { stream: true });
			let i: number;
			while ((i = buf.indexOf("\n")) >= 0) {
				handle(buf.slice(0, i).trim());
				buf = buf.slice(i + 1);
			}
		}
		handle(buf.trim());
		const u: Usage = {
			tokensIn: usage.prompt_tokens ?? 0,
			tokensOut: usage.completion_tokens ?? 0,
			cacheRead: 0,
			cacheWrite: 0,
			costUsd: 0,
			model: served,
		};
		const logPath = this.log(spec.tag, body, { finish_reason: finish, usage, model: served, text });
		this.onUsage(u, spec.tag, logPath);
		if (finish === "length") throw new LlmError(`출력이 최대 토큰에서 잘렸습니다 (${spec.tag})`);
		return { text, usage: u, finish };
	}

	private log(tag: string, body: unknown, res: unknown) {
		if (!this.logDir) return "";
		mkdirSync(this.logDir, { recursive: true });
		const path = join(this.logDir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${tag}.json`);
		const scrub = JSON.parse(
			JSON.stringify(body, (k, v) => (k === "url" && typeof v === "string" && v.startsWith("data:") ? `<image ${v.length} chars>` : v)),
		);
		writeFileSync(path, JSON.stringify({ backend: "ollama", baseUrl: this.baseUrl, request: scrub, response: res }, null, 1));
		return path;
	}

	async call<T = unknown>(spec: CallSpec): Promise<CallResult<T>> {
		const { text, usage, finish } = await this.run(spec);
		let value: unknown = text;
		if (spec.schema) {
			try {
				value = parseJsonReply(text);
			} catch {
				throw new LlmError(`JSON 출력 파싱 실패 (${spec.tag}): ${text.slice(0, 200)}`);
			}
		}
		return { value: value as T, text, usage, stopReason: finish };
	}

	async streamText(spec: CallSpec, onDelta: (t: string) => void): Promise<CallResult<string>> {
		const { text, usage, finish } = await this.run({ ...spec, schema: undefined }, onDelta);
		return { value: text, text, usage, stopReason: finish };
	}
}

/** Model ids the server offers: OpenAI-style GET {base}/models, falling back to Ollama's native /api/tags. */
export async function listOllamaModels(baseUrl: string, apiKey: string | null, fetchImpl: typeof fetch = fetch): Promise<string[]> {
	const base = baseUrl.trim().replace(/\/+$/, "") || OLLAMA_CLOUD_URL;
	const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
	const get = async (url: string) => {
		const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) });
		if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
		return (await res.json()) as { data?: { id?: string }[]; models?: { name?: string; model?: string }[] };
	};
	let ids: string[] = [];
	let err: Error | null = null;
	try {
		ids = ((await get(`${base}/models`)).data ?? []).map((m) => m.id ?? "").filter(Boolean);
	} catch (e) {
		err = e as Error;
	}
	if (!ids.length && /\/v1$/.test(base)) {
		try {
			ids = ((await get(`${base.replace(/\/v1$/, "")}/api/tags`)).models ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean);
		} catch (e) {
			err ??= e as Error;
		}
	}
	if (!ids.length && err) throw new LlmError(`Ollama 모델 목록을 불러오지 못했습니다: ${err.message}`);
	return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
