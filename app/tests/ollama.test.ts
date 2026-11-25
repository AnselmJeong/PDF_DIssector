import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listOllamaModels, OllamaClient, parseJsonReply } from "../src/bun/llm/ollama";
import { createBackend } from "../src/bun/backend";

const sse = (events: unknown[]) =>
	new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", {
		headers: { "content-type": "text/event-stream" },
	});

function fakeFetch(reply: (body: Record<string, unknown>, headers: Record<string, string>) => Response) {
	const seen: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
	const f = (async (url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body));
		const headers = init.headers as Record<string, string>;
		seen.push({ url, body, headers });
		return reply(body, headers);
	}) as unknown as typeof fetch;
	return { f, seen };
}

test("ollama backend: request shape, structured output, usage, streaming", async () => {
	const { f, seen } = fakeFetch(() =>
		sse([
			{ model: "gpt-oss:120b", choices: [{ delta: { content: '```json\n{"n":' } }] },
			{ choices: [{ delta: { content: "3}\n```" }, finish_reason: "stop" }] },
			{ choices: [], usage: { prompt_tokens: 120, completion_tokens: 7 } },
		]),
	);
	const usage: { in: number; out: number; cost: number; model: string }[] = [];
	const c = new OllamaClient("https://ollama.com/v1/", "sk-test", "gpt-oss:120b", null, (u) => usage.push({ in: u.tokensIn, out: u.tokensOut, cost: u.costUsd, model: u.model }), 60_000, f);
	const r = await c.call<{ n: number }>({
		model: "claude-opus-5-5", // ignored: the configured Ollama model serves every role
		system: "SYS",
		context: "CTX",
		prompt: "count",
		images: [{ mediaType: "image/png", base64: "AAAA", label: "Figure 1" }],
		schema: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
		maxTokens: 1000,
		tag: "UNDERSTAND_x",
	});
	expect(r.value).toEqual({ n: 3 });
	expect(usage).toEqual([{ in: 120, out: 7, cost: 0, model: "gpt-oss:120b" }]);
	const req = seen[0];
	expect(req.url).toBe("https://ollama.com/v1/chat/completions");
	expect(req.headers.authorization).toBe("Bearer sk-test");
	expect(req.body.model).toBe("gpt-oss:120b");
	expect(req.body.stream).toBe(true);
	expect(req.body.max_tokens).toBe(1000);
	expect((req.body.response_format as { type: string }).type).toBe("json_schema");
	const msgs = req.body.messages as { role: string; content: unknown }[];
	expect(msgs[0].role).toBe("system");
	expect(String(msgs[0].content)).toContain('"required":["n"]');
	const parts = msgs[1].content as { type: string; text?: string; image_url?: { url: string } }[];
	expect(parts.map((p) => p.type)).toEqual(["text", "text", "image_url", "text"]);
	expect(parts[2].image_url?.url).toBe("data:image/png;base64,AAAA");

	// chat streaming with history
	const { f: f2, seen: seen2 } = fakeFetch(() => sse([{ choices: [{ delta: { content: "안" } }] }, { choices: [{ delta: { content: "녕" }, finish_reason: "stop" }] }]));
	const c2 = new OllamaClient("http://localhost:11434/v1", null, "llama3", null, () => {}, 60_000, f2);
	const deltas: string[] = [];
	const s = await c2.streamText({ model: "x", system: "S", prompt: "q2", history: [{ role: "user", text: "q1" }, { role: "assistant", text: "a1" }], tag: "CHAT" }, (t) => deltas.push(t));
	expect(s.text).toBe("안녕");
	expect(deltas).toEqual(["안", "녕"]);
	expect(seen2[0].headers.authorization).toBeUndefined();
	expect((seen2[0].body.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
	expect(seen2[0].body.response_format).toBeUndefined();
});

test("ollama backend: errors", async () => {
	const { f } = fakeFetch(() => new Response("unauthorized", { status: 401 }));
	const c = new OllamaClient("https://ollama.com/v1", "bad", "m", null, () => {}, 60_000, f);
	await expect(c.call({ model: "m", system: "s", prompt: "p", tag: "t" })).rejects.toThrow("인증 실패");

	const { f: f2 } = fakeFetch(() => sse([{ choices: [{ delta: { content: "{" }, finish_reason: "length" }] }]));
	const c2 = new OllamaClient("https://ollama.com/v1", "k", "m", null, () => {}, 60_000, f2);
	await expect(c2.call({ model: "m", system: "s", prompt: "p", tag: "t" })).rejects.toThrow("잘렸습니다");

	const { f: f3 } = fakeFetch(() => sse([{ choices: [{ delta: { content: "not json" }, finish_reason: "stop" }] }]));
	const c3 = new OllamaClient("https://ollama.com/v1", "k", "m", null, () => {}, 60_000, f3);
	await expect(c3.call({ model: "m", system: "s", prompt: "p", tag: "t", schema: { type: "object" } })).rejects.toThrow("파싱 실패");
});

test("parseJsonReply tolerates preambles and fences", () => {
	expect(parseJsonReply('{"a":1}')).toEqual({ a: 1 });
	expect(parseJsonReply('Here you go:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
	expect(parseJsonReply('Sure. {"a":{"b":3}} done')).toEqual({ a: { b: 3 } });
});

test("backend: ollama settings, key storage and readiness", async () => {
	process.env.PDFX_NO_KEYCHAIN = "1";
	delete process.env.OLLAMA_API_KEY;
	const dir = mkdtempSync(join(tmpdir(), "ol-"));
	const be = createBackend({
		dataDir: join(dir, "data"),
		pickFiles: async () => [],
		pickDir: async () => dir,
		showInFolder: () => {},
		notify: () => {},
		send: () => {},
	});
	const h = be.handlers;
	let s = await h.getSettings({});
	expect(s.ollama).toEqual({ baseUrl: "https://ollama.com/v1", model: "" });
	expect(s.hasOllamaKey).toBe(false);
	await h.setSettings({ settings: { llmBackend: "ollama", ollama: { baseUrl: "https://ollama.com/v1", model: "gpt-oss:120b" } } });
	expect((await h.setOllamaKey({ key: " sk-o " })).hasOllamaKey).toBe(true);
	s = await h.getSettings({});
	expect(s.llmBackend).toBe("ollama");
	expect(s.ollama.model).toBe("gpt-oss:120b");
	expect(s.hasOllamaKey).toBe(true);
	expect(s.hasApiKey).toBe(false); // separate from the Anthropic key
	expect((await h.setOllamaKey({ key: null })).hasOllamaKey).toBe(false);
});

test("listOllamaModels: /v1/models, then /api/tags fallback", async () => {
	const urls: string[] = [];
	const cloud = (async (url: string, init: RequestInit) => {
		urls.push(url);
		expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
		return Response.json({ object: "list", data: [{ id: "kimi-k3" }, { id: "glm-5.3" }, { id: "glm-5.3" }] });
	}) as unknown as typeof fetch;
	expect(await listOllamaModels("https://ollama.com/v1/", "k", cloud)).toEqual(["glm-5.3", "kimi-k3"]);
	expect(urls).toEqual(["https://ollama.com/v1/models"]);

	const local = (async (url: string) =>
		url.endsWith("/v1/models") ? new Response("nope", { status: 404 }) : Response.json({ models: [{ name: "llama3:8b" }] })) as unknown as typeof fetch;
	expect(await listOllamaModels("http://localhost:11434/v1", null, local)).toEqual(["llama3:8b"]);

	const down = (async () => new Response("bad", { status: 401 })) as unknown as typeof fetch;
	await expect(listOllamaModels("https://ollama.com/v1", "x", down)).rejects.toThrow("불러오지 못했습니다");
});
