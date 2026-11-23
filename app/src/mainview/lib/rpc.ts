// Webview side of the typed RPC. Inside Electrobun: Electroview RPC. In a plain browser (UI development,
// Playwright): the same requests over HTTP to `bun src/bun/devServer.ts`, messages over SSE.
import type { BunRequests, WebviewMessages } from "../../shared/types";

type Req = { [K in keyof BunRequests]: (p: BunRequests[K]["params"]) => Promise<BunRequests[K]["response"]> };
type Listener<K extends keyof WebviewMessages> = (m: WebviewMessages[K]) => void;

const listeners: { [K in keyof WebviewMessages]?: Set<Listener<K>> } = {};

function dispatch<K extends keyof WebviewMessages>(name: K, payload: WebviewMessages[K]) {
	(listeners[name] as Set<Listener<K>> | undefined)?.forEach((l) => l(payload));
}

export function on<K extends keyof WebviewMessages>(name: K, l: Listener<K>) {
	const set = (listeners[name] ??= new Set() as never) as Set<Listener<K>>;
	set.add(l);
	return () => {
		set.delete(l);
	};
}

const inElectrobun = typeof window !== "undefined" && "__electrobun" in window;

let call: <K extends keyof BunRequests>(name: K, params: BunRequests[K]["params"]) => Promise<BunRequests[K]["response"]>;
let fileServer: { origin: string; token: string } | null = null;

if (inElectrobun) {
	const { Electroview } = await import("electrobun/view");
	const messageHandlers = Object.fromEntries(
		(["jobProgress", "jobDone", "chatDelta", "docsChanged"] as const).map((n) => [n, (m: never) => dispatch(n, m)]),
	);
	const rpc = Electroview.defineRPC<{
		bun: { requests: BunRequests; messages: Record<string, never> };
		webview: { requests: Record<string, never>; messages: WebviewMessages };
	}>({
		maxRequestTime: 15 * 60 * 1000,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		handlers: { requests: {}, messages: messageHandlers as any },
	});
	new Electroview({ rpc });
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	call = (name, params) => (rpc as any).request[name](params ?? {});
	fileServer = await call("serverInfo", {});
	console.info(`[pdf-dissector] rpc ok, file server ${fileServer.origin}`);
} else {
	const qs = new URLSearchParams(location.search);
	const origin = qs.get("backend") ?? import.meta.env.VITE_BACKEND ?? "http://127.0.0.1:5174";
	const token = qs.get("t") ?? import.meta.env.VITE_TOKEN ?? "dev";
	fileServer = { origin, token };
	call = async (name, params) => {
		const r = await fetch(`${origin}/rpc/${name}`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-token": token },
			body: JSON.stringify(params ?? {}),
		});
		const j = await r.json();
		if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
		return j.result;
	};
	const es = new EventSource(`${origin}/events?t=${token}`);
	es.addEventListener("message", (ev) => {
		const { name, payload } = JSON.parse((ev as MessageEvent).data);
		dispatch(name, payload);
	});
}

export const api = new Proxy({} as Req, {
	get: (_t, name: string) => (params: unknown) => call(name as keyof BunRequests, (params ?? {}) as never),
});

/** URL for a document file path returned by the backend ("/files/<doc>/..."). */
export function fileUrl(path: string) {
	if (!path) return path;
	if (/^(https?:|data:)/.test(path)) return path;
	const sep = path.includes("?") ? "&" : "?";
	return `${fileServer?.origin ?? ""}${path}${sep}t=${fileServer?.token ?? ""}`;
}

export const isDesktop = inElectrobun;
