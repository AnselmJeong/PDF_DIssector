import "./index.css"; // first: declares the cascade-layer order for Tailwind + Astryx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Theme } from "@astryxdesign/core/theme";
import { themes, defaultThemeSlug } from "../astryx-themes";
import { useApp } from "@/lib/store";
import App from "./App";

window.addEventListener("error", (e) => console.error(`[pdf-dissector] ${e.message} ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => console.error(`[pdf-dissector] unhandled: ${String(e.reason?.stack ?? e.reason)}`));

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });

function Themed({ children }: { children: React.ReactNode }) {
	const dark = useApp((s) => s.dark);
	return (
		<Theme theme={themes[defaultThemeSlug]} mode={dark ? "dark" : "light"}>
			{children}
		</Theme>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={qc}>
			<Themed>
				<TooltipProvider delayDuration={250}>
					<App />
					<Toaster richColors position="bottom-right" />
				</TooltipProvider>
			</Themed>
		</QueryClientProvider>
	</StrictMode>,
);
