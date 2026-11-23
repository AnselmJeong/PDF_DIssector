// Run the backend without Electrobun: HTTP RPC + SSE + files on http://127.0.0.1:<port>.
// Used for UI development in a browser and for Playwright tests:  bun src/bun/devServer.ts [--port 5174] [--data DIR]
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createBackend } from "./backend";
import { startServer } from "./server";

const arg = (name: string, def: string) => {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : def;
};
const dataDir = resolve(arg("--data", process.env.PDFX_DATA_DIR ?? join(homedir(), ".pdf-dissector-dev")));
let srv: ReturnType<typeof startServer> | null = null;
const backend = createBackend({
	dataDir,
	pickFiles: async () => (process.env.PDFX_PICK ? process.env.PDFX_PICK.split(",") : []),
	pickDir: async () => process.env.PDFX_EXPORT_DIR ?? dataDir,
	showInFolder: (p) => console.log("show in folder:", p),
	notify: (t, b) => console.log(`[notify] ${t}: ${b}`),
	send: (name, payload) => srv?.broadcast(name, payload),
});
srv = startServer(backend, { port: Number(arg("--port", "5174")), rpc: true, token: arg("--token", "dev"), staticDir: process.env.PDFX_STATIC });
backend.setServer(srv.origin, srv.token);
console.log(`PDF Dissector dev backend: ${srv.origin} (token ${srv.token}, data ${dataDir})`);
