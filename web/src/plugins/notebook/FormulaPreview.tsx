import { useEffect, useMemo, useState, type CSSProperties, type RefObject } from 'react';
import type { HighlightSpan } from './syntax';
import { TexMath, useMathRenderer } from './TexMath';

/**
 * What the editor knows about the formulas in it beyond where they are: whether each one typesets,
 * and what it looks like when it does.
 *
 * The editor only ever shows LaTeX — it cannot typeset in place, because a fraction is taller and
 * narrower than the characters that spell it and the overlay may not change a single advance width
 * (see the rule at the top of syntax.ts). So a formula that won't typeset is painted in the
 * destructive colour instead of the formula one (`useInvalidFormulas`), and the typeset result floats
 * under the one the mouse is over (`useFormulaHover`) — both without switching to the preview.
 *
 * ## KaTeX in the editor
 *
 * Both need KaTeX itself: there is no telling `\frca` from `\frac` short of asking the thing that
 * knows every command. So the editor fetches it as soon as the document being edited has a formula
 * in it — on a phone too, where the hover never happens but the colour still does. That is the same
 * rule the preview follows (only someone writing math pays for it), applied one screen earlier; a
 * document without a formula still never asks.
 *
 * ## Why the hit test is by hand
 *
 * The textarea is on top and takes every pointer event; the overlay that knows where the formulas are
 * is underneath it with `pointer-events: none`, which also hides it from `elementsFromPoint`. So the
 * overlay tags each formula's span (`data-formula`, its index in the span list) and this asks those
 * spans for their rects directly. Formulas are few, so that is a handful of rect reads per move — and
 * the state only changes when the formula under the pointer does.
 *
 * ## Mouse only
 *
 * A tap on a phone also fires pointer events, and would pin a preview over the text being edited
 * until the next tap somewhere else. There is no hover on a touchscreen to begin with, so this
 * answers to `pointerType === 'mouse'` alone and leaves touch to the preview mode.
 */

/**
 * The span indexes of every formula KaTeX can't typeset — what the overlay paints red.
 *
 * Empty until KaTeX has arrived, and on a device that couldn't fetch it: a formula nobody has
 * checked is shown as a formula, never as a mistake. Every formula is re-checked on every keystroke,
 * which is affordable only because `renderMath` keeps its answers — the one being typed in is the
 * only one that costs anything.
 */
export function useInvalidFormulas(spans: readonly HighlightSpan[]): ReadonlySet<number> {
  const hasMath = useMemo(() => spans.some((span) => span.kind === 'math'), [spans]);
  const renderer = useMathRenderer(hasMath);
  return useMemo(() => {
    const invalid = new Set<number>();
    if (!renderer) return invalid;
    spans.forEach((span, index) => {
      if (span.kind !== 'math') return;
      if ('error' in renderer.renderMath(span.text, span.display === true)) invalid.add(index);
    });
    return invalid;
  }, [renderer, spans]);
}

interface Hovered {
  /** Index into the span list, which is also what `data-formula` holds. */
  index: number;
  /** Where to hang the preview, relative to the overlay — see `anchor`. */
  position: CSSProperties;
}

/** A place the preview can hang from: under the whole formula, never over it, and on whichever side
    of the editor has more room, so a formula near the right edge opens leftwards instead of off the
    page. */
function anchor(formula: DOMRect, origin: DOMRect): CSSProperties {
  const top = formula.bottom - origin.top;
  return formula.left - origin.left > origin.width / 2
    ? { top, right: origin.right - formula.right }
    : { top, left: formula.left - origin.left };
}

function formulaAt(layer: HTMLElement, x: number, y: number): Hovered | null {
  for (const element of layer.querySelectorAll<HTMLElement>('[data-formula]')) {
    /* Per fragment rather than the bounding box: an inline formula that wraps is two short boxes,
       and the rectangle around both would claim the prose in between them. */
    const inside = [...element.getClientRects()].some(
      (rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
    );
    if (inside) {
      return {
        index: Number(element.dataset.formula),
        position: anchor(element.getBoundingClientRect(), layer.getBoundingClientRect()),
      };
    }
  }
  return null;
}

/** The same formula in the same place — every mouse move inside one lands here, and none of them
    should re-render the editor. */
const samePlace = (a: Hovered | null, b: Hovered | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.index === b.index &&
    a.position.top === b.position.top &&
    a.position.left === b.position.left &&
    a.position.right === b.position.right);

export function useFormulaHover(
  layerRef: RefObject<HTMLElement | null>,
  spans: readonly HighlightSpan[],
) {
  const [hovered, setHovered] = useState<Hovered | null>(null);

  // Typing moves every formula after the caret, so an anchor measured before it is stale.
  useEffect(() => setHovered(null), [spans]);

  const onPointerMove = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse' || !layerRef.current) return;
    // A button held down is a selection being dragged, and a preview would sit on top of it.
    const hit = event.buttons ? null : formulaAt(layerRef.current, event.clientX, event.clientY);
    setHovered((current) => (samePlace(current, hit) ? current : hit));
  };

  const onPointerLeave = () => setHovered(null);

  const span = hovered ? spans[hovered.index] : undefined;
  return {
    formula:
      hovered && span?.kind === 'math'
        ? { tex: span.text, display: span.display === true, position: hovered.position }
        : null,
    onPointerMove,
    onPointerLeave,
  };
}

export function FormulaPreview({
  tex,
  display,
  position,
}: {
  tex: string;
  display: boolean;
  position: CSSProperties;
}) {
  return (
    /* Hidden from assistive technology like the overlay it belongs to: the LaTeX is already in the
       textarea, and the typeset form is the preview mode's to announce. `pointer-events-none` so that
       moving onto it doesn't count as leaving the textarea and hide it again. */
    <div
      aria-hidden="true"
      style={position}
      className="pointer-events-none absolute z-40 mt-1 max-w-[min(32rem,100%)] overflow-hidden rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-md [&_.katex-display]:my-0"
    >
      <TexMath tex={tex} display={display} source={tex} explain />
    </div>
  );
}
