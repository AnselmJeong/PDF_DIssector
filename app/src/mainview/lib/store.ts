import { create } from "zustand";

export type View = { name: "library" } | { name: "processing"; docId: string } | { name: "reader"; docId: string; pid?: string } | { name: "settings" };

interface AppState {
	view: View;
	go: (v: View) => void;
	briefFor: string[] | null; // doc ids waiting for the brief dialog
	setBriefFor: (ids: string[] | null) => void;
	dark: boolean;
	toggleDark: () => void;
}

export const useApp = create<AppState>((set) => ({
	view: { name: "library" },
	go: (view) => set({ view }),
	briefFor: null,
	setBriefFor: (briefFor) => set({ briefFor }),
	dark: typeof window !== "undefined" && localStorage.getItem("pdfx-dark") === "1",
	toggleDark: () =>
		set((s) => {
			localStorage.setItem("pdfx-dark", s.dark ? "0" : "1");
			return { dark: !s.dark };
		}),
}));

export const L = (v: unknown, lang = "ko"): string => {
	if (v == null) return "";
	if (typeof v === "string") return v;
	if (typeof v === "object") {
		const o = v as Record<string, string>;
		return o[lang] ?? o.ko ?? o.en ?? Object.values(o)[0] ?? "";
	}
	return String(v);
};
