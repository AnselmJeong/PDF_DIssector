// Local HTTP server (127.0.0.1, random port, token-protected) for document files (PDF, crops, page images).
// With `rpc: true` (dev mode) it also serves the request handlers at POST /rpc/<name> and messages at GET /events (SSE).
import type { Backend } from "./backend";

export function startServer(backend: Backend, opts: { port?: number; rpc?: boolean; token?: string; staticDir?: string } = {}) {
	const token = opts.token ?? crypto.randomUUID().replace(/-/g, "");
	const listeners = new Set<ReadableStreamDefaultController<string>>();
	const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-token", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: opts.port ?? 0,
		idleTimeout: 255,
		async fetch(req) {
			const url = new URL(req.url);
			if (req.method === "OPTIONS") return new Response(null, { headers: cors });
			const tok = url.searchParams.get("t") ?? req.headers.get("x-token");
			const m = /^\/files\/([^/]+)\/(.+)$/.exec(url.pathname);
			if (m) {
				if (tok !== token) return new Response("forbidden", { status: 403, headers: cors });
				const res = backend.serveFile(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
				for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
				return res;
			}
			if (opts.rpc && url.pathname.startsWith("/rpc/") && req.method === "POST") {
				if (tok !== token) return new Response("forbidden", { status: 403, headers: cors });
				const name = url.pathname.slice(5) as keyof Backend["handlers"];
				const fn = backend.handlers[name] as ((p: unknown) => Promise<unknown>) | undefined;
				if (!fn) return Response.json({ error: `unknown request ${name}` }, { status: 404, headers: cors });
				try {
					const params = await req.json().catch(() => ({}));
					return Response.json({ result: (await fn(params)) ?? null }, { headers: cors });
				} catch (e) {
					return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
				}
			}
			if (opts.rpc && url.pathname === "/events") {
				if (tok !== token) return new Response("forbidden", { status: 403, headers: cors });
				let ctl: ReadableStreamDefaultController<string>;
				const stream = new ReadableStream<string>({
					start(c) {
						ctl = c;
						listeners.add(c);
						c.enqueue(": ok\n\n");
					},
					cancel() {
						listeners.delete(ctl);
					},
				});
				return new Response(stream, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
			}
			if (opts.staticDir) {
				const path = url.pathname === "/" ? "/index.html" : url.pathname;
				const f = Bun.file(opts.staticDir + path);
				if (await f.exists()) return new Response(f);
			}
			return new Response("not found", { status: 404, headers: cors });
		},
	});
	return {
		port: server.port,
		token,
		origin: `http://127.0.0.1:${server.port}`,
		broadcast(name: string, payload: unknown) {
			const msg = `event: message\ndata: ${JSON.stringify({ name, payload })}\n\n`;
			for (const l of listeners) {
				try {
					l.enqueue(msg);
				} catch {
					listeners.delete(l);
				}
			}
		},
		stop: () => server.stop(true),
	};
}
