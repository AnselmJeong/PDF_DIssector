// LLM backend that runs the Claude Code CLI in print mode (`claude -p`), so calls use the user's
// Claude subscription login instead of an API key. Structured output goes through --json-schema,
// images and long prompts through --input-format stream-json on stdin, chat streaming through
// --include-partial-messages. No tools, no MCP servers, no settings or CLAUDE.md are loaded.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CallResult, CallSpec, Usage } from "./client";
import { LlmError } from "./client";

export function locateClaude(override?: string | null): string | null {
	const cands = [
		override ?? "",
		process.env.PDFX_CLAUDE ?? "",
		join(homedir(), ".local", "bin", "claude"),
		join(homedir(), ".claude", "local", "claude"),
		"/opt/homebrew/bin/claude",
		"/usr/local/bin/claude",
	].filter(Boolean);
	const hit = cands.find((p) => existsSync(p));
	if (hit) return hit;
	// apps launched from Finder get a minimal PATH: ask a login shell
	const r = Bun.spawnSync(["/bin/zsh", "-lc", "command -v claude"], { stdout: "pipe", stderr: "pipe" });
	const p = r.stdout.toString().trim();
	return r.exitCode === 0 && p && existsSync(p) ? p : null;
}

export function claudeVersion(bin: string): string | null {
	const r = Bun.spawnSync([bin, "--version"], { stdout: "pipe", stderr: "pipe" });
	return r.exitCode === 0 ? r.stdout.toString().trim() : null;
}

type Event = Record<string, unknown>;

export class ClaudeCodeClient {
	constructor(
		private bin: string,
		private workDir: string, // an empty folder the CLI runs in
		private logDir: string | null,
		private onUsage: (u: Usage, tag: string, logPath: string) => void,
		private timeoutMs = 25 * 60 * 1000,
	) {
		mkdirSync(workDir, { recursive: true });
	}

	private args(spec: CallSpec, sysFile: string, stream: boolean, schema?: Record<string, unknown>) {
		const a = [
			"-p",
			"--model",
			spec.model,
			"--tools",
			"",
			"--strict-mcp-config",
			"--no-session-persistence",
			"--setting-sources",
			"",
			"--system-prompt-file",
			sysFile,
			"--input-format",
			"stream-json",
			"--output-format",
			"stream-json",
			"--verbose",
		];
		if (spec.effort) a.push("--effort", spec.effort);
		if (schema) a.push("--json-schema", JSON.stringify(schema));
		if (stream) a.push("--include-partial-messages");
		return a;
	}

	/** One user turn: cached context first, images, then the varying prompt (history folded into text). */
	private userMessage(spec: CallSpec) {
		const content: Record<string, unknown>[] = [];
		if (spec.context) content.push({ type: "text", text: spec.context });
		for (const im of spec.images ?? []) {
			if (im.label) content.push({ type: "text", text: im.label });
			content.push({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.base64 } });
		}
		let prompt = spec.prompt;
		if (spec.history?.length) {
			const h = spec.history.map((m) => `${m.role === "user" ? "Reader" : "You"}: ${m.text}`).join("\n\n");
			prompt = `Conversation so far:\n${h}\n\nReader's new question:\n${spec.prompt}`;
		}
		content.push({ type: "text", text: prompt });
		return JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
	}

	private async run(spec: CallSpec, schema: Record<string, unknown> | undefined, onDelta?: (t: string) => void) {
		const sysFile = join(this.workDir, `system-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
		writeFileSync(sysFile, spec.system);
		const env = { ...process.env };
		// never fall back to API billing: the subscription login is the point of this backend
		delete env.ANTHROPIC_API_KEY;
		delete env.ANTHROPIC_AUTH_TOKEN;
		const proc = Bun.spawn([this.bin, ...this.args(spec, sysFile, !!onDelta, schema)], {
			cwd: this.workDir,
			env,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		proc.stdin.write(this.userMessage(spec));
		await proc.stdin.end();
		const timer = setTimeout(() => proc.kill(), this.timeoutMs);
		let result: Event | null = null;
		let text = "";
		const dec = new TextDecoder();
		let buf = "";
		for await (const chunk of proc.stdout) {
			buf += dec.decode(chunk, { stream: true });
			let i: number;
			while ((i = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, i).trim();
				buf = buf.slice(i + 1);
				if (!line) continue;
				let e: Event;
				try {
					e = JSON.parse(line);
				} catch {
					continue;
				}
				if (e.type === "stream_event" && onDelta) {
					const ev = e.event as { type?: string; delta?: { type?: string; text?: string } };
					if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) onDelta(ev.delta.text);
				} else if (e.type === "result") {
					result = e;
				}
			}
		}
		const stderr = await new Response(proc.stderr).text();
		await proc.exited;
		clearTimeout(timer);
		try {
			(await import("node:fs")).unlinkSync(sysFile);
		} catch {
			/* already gone */
		}
		if (!result) throw new LlmError(`Claude Code가 결과 없이 끝났습니다 (${spec.tag}): ${stderr.slice(-800) || `exit ${proc.exitCode}`}`);
		const r = result as Event & { is_error?: boolean; result?: string; structured_output?: unknown; total_cost_usd?: number; usage?: Record<string, number>; subtype?: string };
		const u = r.usage ?? {};
		const usage: Usage = {
			tokensIn: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
			tokensOut: u.output_tokens ?? 0,
			cacheRead: u.cache_read_input_tokens ?? 0,
			cacheWrite: u.cache_creation_input_tokens ?? 0,
			costUsd: r.total_cost_usd ?? 0, // API-equivalent cost; a subscription is not billed per call
			model: spec.model,
		};
		text = typeof r.result === "string" ? r.result : "";
		const logPath = this.log(spec.tag, spec, r);
		this.onUsage(usage, spec.tag, logPath);
		if (r.is_error) throw new LlmError(`Claude Code 오류 (${spec.tag}): ${text || r.subtype || stderr.slice(-500)}`);
		return { r, text, usage };
	}

	private log(tag: string, spec: CallSpec, res: unknown) {
		if (!this.logDir) return "";
		mkdirSync(this.logDir, { recursive: true });
		const path = join(this.logDir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${tag}.json`);
		const request = { model: spec.model, effort: spec.effort, prompt: spec.prompt, images: (spec.images ?? []).length, context_chars: spec.context?.length ?? 0 };
		writeFileSync(path, JSON.stringify({ backend: "claude-code", request, response: res }, null, 1));
		return path;
	}

	async call<T = unknown>(spec: CallSpec): Promise<CallResult<T>> {
		const { r, text, usage } = await this.run(spec, spec.schema);
		let value: unknown = text;
		if (spec.schema) {
			value = r.structured_output;
			if (value == null) {
				try {
					value = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
				} catch {
					throw new LlmError(`구조화 출력이 없습니다 (${spec.tag}): ${text.slice(0, 200)}`);
				}
			}
		}
		return { value: value as T, text, usage, stopReason: "end_turn" };
	}

	async streamText(spec: CallSpec, onDelta: (t: string) => void): Promise<CallResult<string>> {
		const { text, usage } = await this.run({ ...spec, schema: undefined }, undefined, onDelta);
		return { value: text, text, usage, stopReason: "end_turn" };
	}
}
