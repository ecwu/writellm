import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

const workerUrl = new URL(
  '../../../../node_modules/pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

export function SourcePdfPreview({
  sourceId,
  sourceVersionId,
}: {
  sourceId: string;
  sourceVersionId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [documentProxy, setDocumentProxy] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(
    null,
  );
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const url = `writellm-source://${encodeURIComponent(sourceId)}/__original__/${encodeURIComponent(sourceVersionId)}.pdf`;
  useEffect(() => {
    const current = ++generation.current;
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | null = null;
    setDocumentProxy(null);
    setPage(1);
    setError('');
    void import('pdfjs-dist')
      .then((pdfjs) => {
        if (current !== generation.current) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const loading = pdfjs.getDocument({ url });
        task = loading;
        return loading.promise.then((pdf) => {
          if (current === generation.current) setDocumentProxy(pdf);
          else void loading.destroy();
        });
      })
      .catch(() => {
        if (current === generation.current)
          setError('The original PDF preview is unavailable. Try again.');
      });
    return () => {
      generation.current += 1;
      void task?.destroy();
    };
  }, [url]);
  useEffect(() => {
    if (!documentProxy || !canvasRef.current || !textRef.current) return;
    const current = generation.current;
    let renderTask: import('pdfjs-dist').RenderTask | null = null;
    void documentProxy
      .getPage(page)
      .then(async (pdfPage) => {
        if (current !== generation.current || !canvasRef.current || !textRef.current) return;
        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('canvas');
        renderTask = pdfPage.render({ canvas, canvasContext: context, viewport });
        const text = await pdfPage.getTextContent();
        if (current === generation.current && textRef.current)
          textRef.current.textContent = text.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ');
        await renderTask.promise;
      })
      .catch((reason) => {
        if (reason?.name !== 'RenderingCancelledException' && current === generation.current)
          setError('This PDF page could not be displayed safely.');
      });
    return () => renderTask?.cancel();
  }, [documentProxy, page, scale]);
  if (error) return <div role="alert">{error}</div>;
  if (!documentProxy) return <p role="status">Loading original PDF preview…</p>;
  return (
    <section className="min-w-0" aria-label="Original PDF preview">
      <div className="my-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label="Previous PDF page"
          disabled={page <= 1}
          onClick={() => setPage((value) => value - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span>
          Page {page} of {documentProxy.numPages}
        </span>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label="Next PDF page"
          disabled={page >= documentProxy.numPages}
          onClick={() => setPage((value) => value + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label="Zoom out"
          disabled={scale <= 0.5}
          onClick={() => setScale((value) => Math.max(0.5, value - 0.25))}
        >
          <ZoomOut aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label="Reset zoom"
          onClick={() => setScale(1)}
        >
          <RotateCcw aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label="Zoom in"
          disabled={scale >= 2}
          onClick={() => setScale((value) => Math.min(2, value + 0.25))}
        >
          <ZoomIn aria-hidden="true" />
        </Button>
      </div>
      <section
        className="max-h-[min(65vh,48rem)] overflow-auto bg-muted p-4 [&_canvas]:mx-auto [&_canvas]:block [&_canvas]:max-w-none [&_canvas]:bg-white"
        aria-label="PDF page viewport"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the bounded PDF viewport must be keyboard-scrollable.
        tabIndex={0}
      >
        <canvas ref={canvasRef} aria-label={`PDF page ${page}`} />
        <section
          ref={textRef}
          className="absolute size-px overflow-hidden whitespace-nowrap [clip-path:inset(50%)]"
          aria-label={`Text of PDF page ${page}`}
        />
      </section>
    </section>
  );
}
