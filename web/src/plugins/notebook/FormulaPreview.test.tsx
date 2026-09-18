import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import en from './locales/en.json';
import { MentionTextarea } from './MentionTextarea';

/* The editor's hover preview, driven the way a mouse drives it.
 *
 * jsdom lays nothing out, so every element reports an empty rect and no pointer is ever "over" a
 * formula. The one rect the hit test reads — each formula span's own — is stubbed to a box at
 * (10, 10)–(60, 30), which is all FormulaPreview needs to believe the pointer is on it. */

const INSIDE = { clientX: 30, clientY: 20 };
const OUTSIDE = { clientX: 200, clientY: 200 };

beforeEach(() => {
  i18n.addResourceBundle('en', 'translation', { plugins: { notebook: en } }, true, true);
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    const box = { left: 10, top: 10, right: 60, bottom: 30, width: 50, height: 20, x: 10, y: 10 };
    return (this.hasAttribute('data-formula') ? [box] : []) as unknown as DOMRectList;
  });
});

afterEach(() => vi.restoreAllMocks());

const editor = (value: string) =>
  render(
    <MentionTextarea
      value={value}
      onChange={() => {}}
      people={[]}
      documents={[]}
      documentLabels={new Map()}
      documentLabelsLoading={false}
    />,
  );

const mouse = (point: { clientX: number; clientY: number }, extra: object = {}) =>
  fireEvent.pointerMove(screen.getByRole('combobox'), { pointerType: 'mouse', ...point, ...extra });

describe('FormulaPreview', () => {
  it('floats the typeset formula under the mouse', async () => {
    const { container } = editor('Euler: $e^{i\\pi}$');
    mouse(INSIDE);
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
  });

  it('goes away when the mouse moves off the formula, or out of the editor', async () => {
    const { container } = editor('$x^2$');
    mouse(INSIDE);
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());

    mouse(OUTSIDE);
    expect(container.querySelector('.katex')).toBeNull();

    mouse(INSIDE);
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
    fireEvent.pointerLeave(screen.getByRole('combobox'), { pointerType: 'mouse' });
    expect(container.querySelector('.katex')).toBeNull();
  });

  /* A tap fires pointer events too, and would otherwise pin a preview over the text being edited. */
  it('ignores a finger', () => {
    const { container } = editor('$x^2$');
    fireEvent.pointerMove(screen.getByRole('combobox'), { pointerType: 'touch', ...INSIDE });
    expect(container.querySelector('[aria-hidden="true"].absolute.z-40')).toBeNull();
  });

  it('stays out of the way of a selection being dragged', () => {
    const { container } = editor('$x^2$');
    mouse(INSIDE, { buttons: 1 });
    expect(container.querySelector('[aria-hidden="true"].absolute.z-40')).toBeNull();
  });

  it('says why a formula cannot be typeset, in words rather than a tooltip', async () => {
    editor('$\\frac{a}{$');
    mouse(INSIDE);
    expect(await screen.findByText(/Couldn't typeset this formula/)).toBeInTheDocument();
  });

  it('paints a formula KaTeX cannot typeset red, and leaves the others their own colour', async () => {
    const { container } = editor('Bad $\\frca{a}{b}$ and good $\\frac{a}{b}$.');
    const [bad, good] = container.querySelectorAll('[data-formula]');
    // Unchecked until KaTeX is here — and an unchecked formula is a formula, not a mistake.
    expect(good).toHaveClass('text-violet-700');
    await waitFor(() => expect(bad).toHaveClass('text-destructive'));
    expect(bad).not.toHaveClass('text-violet-700');
    expect(good).toHaveClass('text-violet-700');
    expect(good).not.toHaveClass('text-destructive');
  });

  it('has nothing to show in a document without math', () => {
    const { container } = editor('Just prose, and $5 for a coffee.');
    mouse(INSIDE);
    expect(container.querySelector('[data-formula]')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"].absolute.z-40')).toBeNull();
  });
});
