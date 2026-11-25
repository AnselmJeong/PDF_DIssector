// Electrobun main process: window, menu, typed RPC, local file server.
import Electrobun, { ApplicationMenu, BrowserView, BrowserWindow, PATHS, Updater, Utils } from "electrobun/main";
import type { BunRequests, WebviewMessages } from "../shared/types";
import { createBackend } from "./backend";
import { startServer } from "./server";

type AppRPC = {
	bun: { requests: BunRequests; messages: Record<string, never> };
	webview: { requests: Record<string, never>; messages: WebviewMessages };
};

const DEV_SERVER_URL = "http://localhost:5173";

let win: BrowserWindow | null = null;

const backend = createBackend({
	dataDir: Utils.paths.userData,
	resourcesDir: PATHS.RESOURCES_FOLDER,
	pickFiles: () => Utils.openFileDialog({ allowedFileTypes: "pdf", canChooseFiles: true, canChooseDirectory: false, allowsMultipleSelection: true }),
	pickDir: async () => (await Utils.openFileDialog({ canChooseFiles: false, canChooseDirectory: true, allowsMultipleSelection: false }))[0] ?? null,
	showInFolder: (p) => Utils.showItemInFolder(p),
	notify: (title, body) => Utils.showNotification({ title, body }),
	send: (name, payload) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(win?.webview.rpc as any)?.send?.[name]?.(payload);
	},
});

const server = startServer(backend);
backend.setServer(server.origin, server.token);
console.log(`[pdf-dissector] data ${Utils.paths.userData}; files ${server.origin}`);
backend.bridge
	.call<{ version: string; python: string }>("ping")
	.then((r) => console.log(`[pdf-dissector] engine ok: pdfx ${r.version}, python ${r.python}`))
	.catch((e: Error) => console.error(`[pdf-dissector] engine error: ${e.message}`));

const handlers = Object.fromEntries(
	Object.entries(backend.handlers).map(([k, fn]) => [
		k,
		async (p: unknown) => {
			if (process.env.PDFX_DEBUG_RPC) console.log(`[rpc] ${k}`);
			try {
				return await (fn as (x: unknown) => Promise<unknown>)(p ?? {});
			} catch (e) {
				console.error(`[rpc] ${k} failed: ${(e as Error).message}`);
				throw e;
			}
		},
	]),
);

const rpc = BrowserView.defineRPC<AppRPC>({
	maxRequestTime: 15 * 60 * 1000,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	handlers: { requests: handlers as any, messages: {} },
});

async function mainViewUrl() {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			return DEV_SERVER_URL;
		} catch {
			/* no Vite dev server: use bundled views */
		}
	}
	return "views://mainview/index.html";
}

ApplicationMenu.setApplicationMenu([
	{ submenu: [{ label: "PDF Dissector 종료", role: "quit" }] },
	{
		label: "Edit",
		submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
	},
]);

win = new BrowserWindow({
	title: "PDF Dissector",
	url: await mainViewUrl(),
	frame: { width: 1440, height: 920, x: 120, y: 80 },
	rpc,
});

Electrobun.events.on("before-quit", () => {
	backend.stop();
	server.stop();
});
