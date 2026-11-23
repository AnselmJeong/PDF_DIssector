import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";
import App from "./App";

window.addEventListener("error", (e) => console.error(`[pdf-dissector] ${e.message} ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => console.error(`[pdf-dissector] unhandled: ${String(e.reason?.stack ?? e.reason)}`));

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={qc}>
			<TooltipProvider delayDuration={250}>
				<App />
				<Toaster richColors position="bottom-right" />
			</TooltipProvider>
		</QueryClientProvider>
	</StrictMode>,
);
