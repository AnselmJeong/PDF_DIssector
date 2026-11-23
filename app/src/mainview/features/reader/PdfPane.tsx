import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import { fileUrl } from "@/lib/rpc";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

/** The original PDF page with the current paragraph's bbox highlighted (plan section 6.3 ④ right pane). */
export function PdfPane({ url, page, bbox, pageCount }: { url: string; page: number; bbox?: number[] | null; pageCount: number }) {
	const [shown, setShown] = useState(page);
	const [width, setWidth] = useState(480);
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => setShown(page), [page]);
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth - 16)));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	return (
		<div ref={box} className="flex h-full flex-col">
			<div className="flex items-center gap-1 border-b px-2 py-1.5 text-xs">
				<Button variant="ghost" size="icon" className="size-7" disabled={shown <= 1} onClick={() => setShown(shown - 1)}>
					<ChevronLeft />
				</Button>
				<span>
					{shown} / {pageCount}쪽
				</span>
				<Button variant="ghost" size="icon" className="size-7" disabled={shown >= pageCount} onClick={() => setShown(shown + 1)}>
					<ChevronRight />
				</Button>
				{shown !== page && (
					<button className="ml-auto text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShown(page)}>
						현재 문단 쪽으로
					</button>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-auto p-2">
				<Document file={fileUrl(url)} loading={<div className="p-4 text-xs text-muted-foreground">PDF 불러오는 중…</div>} error={<div className="p-4 text-xs text-destructive">PDF를 열 수 없습니다.</div>}>
					<div className="relative mx-auto w-fit shadow">
						<Page pageNumber={shown} width={width} renderAnnotationLayer={false} renderTextLayer />
						{bbox && shown === page && (
							<div
								className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/10"
								style={{ left: `${bbox[0] * 100}%`, top: `${bbox[1] * 100}%`, width: `${(bbox[2] - bbox[0]) * 100}%`, height: `${(bbox[3] - bbox[1]) * 100}%` }}
							/>
						)}
					</div>
				</Document>
			</div>
		</div>
	);
}
