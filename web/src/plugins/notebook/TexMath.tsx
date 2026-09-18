import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * One formula in the preview, typeset by KaTeX — once KaTeX is here.
 *
 * ## Loaded on sight, not on enable
 *
 * KaTeX is heavier than this whole plugin (see renderMath.ts), and most people will never type a
 * formula, so there is no setting and no bundle cost: the first `TexMath` that mounts asks for the
 * renderer, and every one after it shares that one request. A notebook without math never mounts one,
 * so it never downloads a byte of it. The editor is the one other thing that asks, and by the same
 * rule — only once the document being edited has a formula in it, because telling a formula that
 * won't typeset from one that will takes KaTeX itself (see `useInvalidFormulas` in
 * FormulaPreview.tsx).
 *
 * ## Until then, and if it can't
 *
 * The formula is shown exactly as it was typed, delimiters and all — the same "never silently
 * rewrite what can't be resolved" rule an unresolved `[[id]]` follows. That covers the moment before
 * KaTeX arrives, a device that is offline the first time it previews math (the renderer is
 * runtime-cached rather than precached, so from then on it works offline too), and LaTeX KaTeX can't
 * parse, which is shown in the destructive colour with KaTeX's reason as its tooltip.
 *
 * ## The one place this plugin inserts markup
 *
 * MarkdownView renders every other construct as React elements and never sets HTML. KaTeX's output
 * can't be built that way — it is thousands of nested spans positioned by its own stylesheet — so
 * it goes in through `dangerouslySetInnerHTML`. What makes that safe is the input, not the output:
 * with `trust: false` (see renderMath.ts) KaTeX refuses every command that could produce a link, an
 * image, a class or a style, and escapes everything else, which is the property it is built and
 * tested to guarantee for untrusted LaTeX.
 */

type Renderer = typeof import('./renderMath');

let renderer: Renderer | null = null;
let pending: Promise<Renderer> | null = null;

/** The renderer, fetched at most once at a time. A failed fetch is forgotten rather than kept, so the
    next formula that mounts — after the connection is back — asks again instead of inheriting it. */
function loadRenderer(): Promise<Renderer> {
  pending ??= import('./renderMath').then(
    (module) => (renderer = module),
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

/** The renderer once it is here, `null` until then — and asked for only while `wanted`, so a caller
    that may or may not have math to show can hold the hook unconditionally and pay nothing when it
    has none. A failed fetch leaves it `null`; the caller's fallback is whatever it shows meanwhile. */
export function useMathRenderer(wanted = true): Renderer | null {
  const [loaded, setLoaded] = useState(renderer);
  useEffect(() => {
    if (loaded || !wanted) return;
    let live = true;
    loadRenderer().then(
      (module) => {
        if (live) setLoaded(module);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [loaded, wanted]);
  return loaded;
}

export function TexMath({
  tex,
  display,
  source,
  explain = false,
}: {
  /** The LaTeX, without its delimiters. */
  tex: string;
  /** Set on a line of its own and centred (`$$`, `\[`, ` ```math `), rather than in the running text. */
  display: boolean;
  /** Exactly what was typed, delimiters included — what is shown until, or instead of, the result. */
  source: string;
  /** Say why a formula can't be typeset in a line beneath it rather than in a `title`, for a surface
      where a native tooltip can never appear — the editor's hover preview is one already, and it
      ignores the pointer. */
  explain?: boolean;
}) {
  const { t } = useTranslation();
  const loaded = useMathRenderer();
  const result = useMemo(() => loaded?.renderMath(tex, display), [loaded, tex, display]);

  /* A display formula is a block, but it can sit inside a paragraph (`text $$x$$ text`), where a
     `<div>` would be invalid markup — so it is a block-level `<span>` everywhere. It scrolls
     sideways on its own rather than pushing the page wider than a phone. */
  const box = display && 'my-3 block overflow-x-auto overflow-y-hidden';

  if (result && 'html' in result) {
    return <span className={cn(box)} dangerouslySetInnerHTML={{ __html: result.html }} />;
  }

  const reason = result && t('plugins.notebook.mathInvalid', { reason: result.error });
  const shown = (
    <span
      title={explain ? undefined : reason || undefined}
      className={cn(
        box,
        display && 'whitespace-pre-wrap',
        result ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {source}
    </span>
  );
  if (!explain || !reason) return shown;
  return (
    <>
      {shown}
      <span className="mt-1 block text-xs text-muted-foreground">{reason}</span>
    </>
  );
}
