// Bridge to the Python engine (pdfx). Light commands go through one long-running `serve` process
// (JSON lines over stdio); heavy ones (segment) run as one-off `run` processes so cancel = kill.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";

export interface EngineLocation {
	python: string;
	engineDir: string; // folder that contains the `pdfx` package
}

export function locateEngine(opts: { pythonOverride?: string | null; resourcesDir?: string | null } = {}): EngineLocation {
	const candidates: string[] = [];
	if (process.env.PDFX_ENGINE_DIR) candidates.push(process.env.PDFX_ENGINE_DIR);
	if (opts.resourcesDir) candidates.push(join(opts.resourcesDir, "app", "engine"));
	// dev: app/src/bun/pipeline -> ../../../../engine
	candidates.push(resolve(import.meta.dir, "../../../../engine"));
	candidates.push(resolve(process.cwd(), "../engine"), resolve(process.cwd(), "engine"));
	const engineDir = candidates.find((d) => existsSync(join(d, "pdfx", "__main__.py")));
	if (!engineDir) throw new Error(`pdfx engine not found (looked in: ${candidates.join(", ")})`);
	const pyCandidates = [
		opts.pythonOverride ?? "",
		process.env.PDFX_PYTHON ?? "",
		join(engineDir, "python", "bin", "python3"), // bundled python-build-standalone
		join(engineDir, ".venv", "bin", "python"),
	].filter(Boolean);
	const python = pyCandidates.find((p) => existsSync(p)) ?? "python3";
	return { python, engineDir };
}

/**
 * MinerU is installed globally as a uv tool (`uv tool install "mineru>=4,<5"`), not in the engine's Python.
 * Apps launched from Finder get a minimal PATH without ~/.local/bin, so mineru_backend.available() could not
 * find `mineru-kit`. Add the usual user bin folders to PATH and point MINERU_PYTHON at the uv tool's
 * interpreter when it exists (an explicit MINERU_PYTHON from the environment wins).
 */
export function mineruEnv(env: NodeJS.ProcessEnv = process.env, home = homedir()): Record<string, string> {
	const binDirs = [env.UV_TOOL_BIN_DIR, env.XDG_BIN_HOME, join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"].filter(
		(d): d is string => !!d,
	);
	const path = [...(env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(":").filter(Boolean)];
	for (const d of binDirs.reverse()) if (!path.includes(d)) path.unshift(d);
	const out: Record<string, string> = { PATH: path.join(":") };
	if (!env.MINERU_PYTHON) {
		const toolDirs = [env.UV_TOOL_DIR, env.XDG_DATA_HOME && join(env.XDG_DATA_HOME, "uv", "tools"), join(home, ".local", "share", "uv", "tools")];
		const py = toolDirs.filter((d): d is string => !!d).map((d) => join(d, "mineru", "bin", "python")).find((p) => existsSync(p));
		if (py) out.MINERU_PYTHON = py;
	}
	return out;
}

type Pending = {
	resolve: (v: unknown) => void;
	reject: (e: Error) => void;
	onProgress?: (p: Progress) => void;
};
export type Progress = { stage: string; pct: number; msg: string };

export class EngineError extends Error {
	constructor(
		message: string,
		public trace?: string,
	) {
		super(message);
	}
}

export class PdfxBridge {
	private proc: Subprocess<"pipe", "pipe", "pipe"> | null = null;
	private pending = new Map<number, Pending>();
	private nextId = 1;
	private ready: Promise<void> | null = null;
	private running = new Map<string, Subprocess>(); // key -> one-off process (for cancel)

	constructor(public loc: EngineLocation) {}

	private env() {
		const pp = [this.loc.engineDir, join(this.loc.engineDir, "site-packages"), process.env.PYTHONPATH].filter(Boolean).join(":");
		return { ...process.env, ...mineruEnv(), PYTHONPATH: pp, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" };
	}

	private start() {
		if (this.ready) return this.ready;
		this.ready = new Promise<void>((res, rej) => {
			const proc = Bun.spawn([this.loc.python, "-m", "pdfx", "serve"], {
				cwd: this.loc.engineDir,
				env: this.env(),
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			});
			this.proc = proc;
			let started = false;
			const timer = setTimeout(() => !started && rej(new EngineError("pdfx serve did not start in 30 s")), 30000);
			this.readLines(proc.stdout, (msg) => {
				if (msg.event === "ready") {
					started = true;
					clearTimeout(timer);
					res();
					return;
				}
				const p = this.pending.get(msg.id as number);
				if (!p) return;
				if (msg.event === "progress") {
					p.onProgress?.({ stage: String(msg.stage), pct: Number(msg.pct), msg: String(msg.msg) });
					return;
				}
				this.pending.delete(msg.id as number);
				if (msg.ok) p.resolve(msg.result);
				else p.reject(new EngineError(String(msg.error), msg.trace as string | undefined));
			});
			void (async () => {
				const err = await new Response(proc.stderr).text().catch(() => "");
				await proc.exited;
				if (!started) {
					clearTimeout(timer);
					rej(new EngineError(`pdfx serve exited: ${err.slice(-2000)}`));
				}
				for (const p of this.pending.values()) p.reject(new EngineError(`pdfx serve exited: ${err.slice(-1000)}`));
				this.pending.clear();
				this.proc = null;
				this.ready = null;
			})();
		});
		return this.ready;
	}

	private readLines(stream: ReadableStream<Uint8Array>, onMsg: (m: Record<string, unknown>) => void) {
		void (async () => {
			const dec = new TextDecoder();
			let buf = "";
			for await (const chunk of stream) {
				buf += dec.decode(chunk, { stream: true });
				let i: number;
				while ((i = buf.indexOf("\n")) >= 0) {
					const line = buf.slice(0, i).trim();
					buf = buf.slice(i + 1);
					if (!line) continue;
					try {
						onMsg(JSON.parse(line));
					} catch {
						/* not protocol output */
					}
				}
			}
		})();
	}

	async call<T = unknown>(cmd: string, args: Record<string, unknown> = {}, onProgress?: (p: Progress) => void): Promise<T> {
		await this.start();
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
			this.proc!.stdin.write(JSON.stringify({ id, cmd, args }) + "\n");
			this.proc!.stdin.flush();
		});
	}

	/** Run one command in its own process; `key` lets cancel() kill it. */
	async runOnce<T = unknown>(cmd: string, args: Record<string, unknown>, key: string, onProgress?: (p: Progress) => void): Promise<T> {
		const proc = Bun.spawn([this.loc.python, "-m", "pdfx", "run", cmd, JSON.stringify(args)], {
			cwd: this.loc.engineDir,
			env: this.env(),
			stdout: "pipe",
			stderr: "pipe",
		});
		this.running.set(key, proc);
		let result: Record<string, unknown> | null = null;
		const done = new Promise<void>((res) => {
			this.readLines(proc.stdout, (m) => {
				if (m.event === "progress") onProgress?.({ stage: String(m.stage), pct: Number(m.pct), msg: String(m.msg) });
				else result = m;
			});
			void proc.exited.then(() => setTimeout(res, 20));
		});
		const stderr = await new Response(proc.stderr).text();
		await done;
		this.running.delete(key);
		if (proc.signalCode) throw new EngineError("canceled");
		const r = result as Record<string, unknown> | null;
		if (!r) throw new EngineError(`pdfx run ${cmd} produced no result: ${stderr.slice(-2000)}`);
		if (!r.ok) throw new EngineError(String(r.error));
		return r.result as T;
	}

	cancel(key: string) {
		const p = this.running.get(key);
		if (p) p.kill();
	}

	stop() {
		this.proc?.kill();
		for (const p of this.running.values()) p.kill();
	}
}
