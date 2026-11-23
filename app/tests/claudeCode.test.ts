import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeClient } from "../src/bun/llm/claudeCode";

// A stand-in for the `claude` CLI: records its argv and stdin, answers in stream-json.
function fakeClaude(dir: string) {
	const bin = join(dir, "claude");
	writeFileSync(
		bin,
		`#!/bin/sh
printf '%s\\n' "$@" > "${dir}/argv.txt"
cat > "${dir}/stdin.txt"
echo '{"type":"system","subtype":"init"}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"안녕"}}}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"{\\"n\\":3}","structured_output":{"n":3},"total_cost_usd":0.01,"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100,"cache_creation_input_tokens":0}}'
`,
	);
	chmodSync(bin, 0o755);
	return bin;
}

test("claude -p backend: flags, stdin message, structured output, usage, streaming", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cc-"));
	const usage: number[] = [];
	process.env.ANTHROPIC_API_KEY = "should-not-leak";
	const c = new ClaudeCodeClient(fakeClaude(dir), join(dir, "cwd"), null, (u) => usage.push(u.tokensIn));
	const r = await c.call<{ n: number }>({
		model: "claude-opus-5-5",
		system: "SYS",
		context: "PAPER",
		prompt: "Q",
		images: [{ mediaType: "image/png", base64: "AAAA", label: "page 1" }],
		schema: { type: "object", properties: { n: { type: "integer" } }, required: ["n"], additionalProperties: false },
		effort: "high",
		tag: "T",
	});
	expect(r.value).toEqual({ n: 3 });
	expect(usage).toEqual([110]);
	const argv = readFileSync(join(dir, "argv.txt"), "utf8").split("\n");
	for (const f of ["-p", "--json-schema", "--no-session-persistence", "--strict-mcp-config", "--system-prompt-file"]) expect(argv).toContain(f);
	expect(argv[argv.indexOf("--model") + 1]).toBe("claude-opus-5-5");
	expect(argv[argv.indexOf("--effort") + 1]).toBe("high");
	const msg = JSON.parse(readFileSync(join(dir, "stdin.txt"), "utf8"));
	expect(msg.message.content.map((b: { type: string }) => b.type)).toEqual(["text", "text", "image", "text"]);
	const deltas: string[] = [];
	const s = await c.streamText({ model: "claude-sonnet-5-5", system: "S", prompt: "hi", history: [{ role: "user", text: "a" }, { role: "assistant", text: "b" }], tag: "C" }, (t) => deltas.push(t));
	expect(deltas).toEqual(["안녕"]);
	expect(s.text).toBe('{"n":3}');
	expect(readFileSync(join(dir, "argv.txt"), "utf8")).toContain("--include-partial-messages");
	delete process.env.ANTHROPIC_API_KEY;
});
