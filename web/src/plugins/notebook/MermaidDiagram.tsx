import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { lazyModule } from './lazyModule';
import type { RenderedDiagram } from './renderDiagram';
import { useDarkMode } from './useDarkMode';

/**
 * A ` ```mermaid ` block in the preview, drawn by Mermaid — once Mermaid is here.
 *
 * ## Loaded on sight
 *
 * Same rule as formulas (see TexMath.tsx): Mermaid is fetched the first time a diagram is shown,
 * never for a notebook without one. Until it arrives — and on a device that is offline the first time
 * it previews a diagram — the block shows its source exactly as typed, as the code block it would
 * otherwise be. A diagram Mermaid can't parse shows the same source, outlined in the destructive
 * colour, with Mermaid's reason underneath.
 *
 * ## Size: fit the column, but not at any cost
 *
 * A diagram is shrunk to fit the column only down to 75% of its natural size — past that its labels
 * would drop below ~10px — and then it keeps that size and scrolls sideways, the way a wide code block
 * does. Refitting is a style change on the SVG, not a re-render; only a gantt, which Mermaid lays out
 * to a width, is drawn again when the column changes size.
 *
 * ## Light and dark
 *
 * Mermaid bakes colours into the SVG it returns, so it can't follow the theme through CSS. The block
 * re-renders when the theme flips instead (see useDarkMode.ts and mermaidTheme.ts).
 *
 * ## The markup it inserts
 *
 * Like KaTeX's, Mermaid's output can only go in as markup. What makes that safe is
 * `securityLevel: 'strict'` (renderDiagram.ts): labels are sanitised with DOMPurify and every
 * interactive feature that could run script — `click` callbacks, `javascript:` links — is disabled.
 */

const useDiagramRenderer = lazyModule(() => import('./renderDiagram'));

/** The smallest a diagram is drawn, as a fraction of its natural size, before it scrolls instead. */
const MIN_SCALE = 0.75;

/** Width changes are only worth a re-render (for a gantt) in steps, not per pixel of a resize. */
const WIDTH_STEP = 16;

function fit(box: HTMLElement) {
  const svg = box.querySelector('svg');
  const natural = svg?.viewBox?.baseVal?.width;
  if (!svg || !natural) return;
  svg.removeAttribute('height');
  svg.style.maxWidth = 'none';
  svg.style.height = 'auto';
  svg.style.display = 'block';
  svg.style.marginInline = 'auto';
  svg.style.width = `${Math.min(natural, Math.max(box.clientWidth, natural * MIN_SCALE))}px`;
}

export function MermaidDiagram({ source }: { source: string }) {
  const { t } = useTranslation();
  const dark = useDarkMode();
  const renderer = useDiagramRenderer();
  const boxRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [result, setResult] = useState<RenderedDiagram | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      setWidth(Math.round(box.clientWidth / WIDTH_STEP) * WIDTH_STEP);
      if (drawingRef.current) fit(drawingRef.current);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  /* Drawn as soon as Mermaid is here, measured or not: the width matters only to a gantt, and 0 —
     a box not laid out yet, or inside something hidden — just means Mermaid's own default. Once the
     box is measured a gantt is drawn again to fit; everything else is a cache hit. */
  useEffect(() => {
    if (!renderer) return;
    let live = true;
    void renderer.renderDiagram(source, width).then((next) => {
      if (live) setResult(next);
    });
    return () => {
      live = false;
    };
  }, [renderer, source, width, dark]);

  useLayoutEffect(() => {
    if (drawingRef.current) fit(drawingRef.current);
  }, [result]);

  const failed = result && 'error' in result ? result.error : null;

  return (
    <div ref={boxRef} className="my-3">
      {result && 'svg' in result ? (
        <div
          ref={drawingRef}
          className="overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: result.svg }}
        />
      ) : (
        <>
          <pre
            className={cn(
              'overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-6',
              failed && 'ring-1 ring-destructive/60',
            )}
          >
            <code>{source}</code>
          </pre>
          {failed && (
            <div className="mt-2 text-xs">
              <p className="text-destructive">{t('plugins.notebook.diagramInvalid')}</p>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-muted-foreground">
                {failed}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
