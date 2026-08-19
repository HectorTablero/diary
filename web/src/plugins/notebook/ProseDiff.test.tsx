import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';
import { diffView } from './history';
import en from './locales/en.json';
import { ProseDiff } from './ProseDiff';

/* What a reader — and a screen reader — actually gets out of the history screen.
 *
 * The shape of the diff is `history.test.ts`'s business. What is left for here is the part that is
 * only true once it is rendered: that a paragraph is a paragraph, that a change inside one is marked
 * with the elements HTML has for a change, and that neither the change nor the hidden middle of a
 * long document depends on being able to see a colour. */

beforeEach(() => {
  i18n.addResourceBundle('en', 'translation', { plugins: { notebook: en } }, true, true);
});

const render = (before: string, after: string, context?: number) =>
  renderWithProviders(<ProseDiff blocks={diffView(before, after, context)} />, { toaster: false });

describe('ProseDiff', () => {
  /* The whole point of the rewrite. Everything below is a consequence of this one being true. */
  it('keeps a rewritten sentence inside the paragraph it belongs to', () => {
    const { container } = render(
      'First one. Second one. Third one.',
      'First one. Second ones. Third one.',
    );

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].textContent).toBe('First one. Second one. Second ones. Third one.');
    expect(paragraphs[0].querySelector('del')?.textContent).toBe('Second one. ');
    expect(paragraphs[0].querySelector('ins')?.textContent).toBe('Second ones. ');
  });

  /* `<del>` and `<ins>` rather than two coloured spans: a screen reader has something to announce,
     and a sighted reader who cannot use the colour still has the strike-through and the underline. */
  it('marks changes with the elements HTML has for them, not with colour alone', () => {
    const { container } = render('One.', 'Two.');
    expect(container.querySelector('del')).toBeInTheDocument();
    expect(container.querySelector('ins')).toBeInTheDocument();
    expect(container.querySelector('del')).toHaveClass('line-through');
    expect(container.querySelector('ins')).toHaveClass('underline');
  });

  it('draws each paragraph of the document as a paragraph', () => {
    const { container } = render('One.\nTwo.\nThree.', 'One.\nTwo.\nThree.');
    expect(container.querySelectorAll('p')).toHaveLength(3);
  });

  it('keeps the blank line between two paragraphs, so the document keeps its shape', () => {
    const { container } = render('One.\n\nTwo.', 'One.\n\nTwo.');
    expect([...container.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'One.',
      '',
      'Two.',
    ]);
  });

  /* The ellipsis standing in for an untouched middle is meaningless read aloud, so it carries a
     label — otherwise two paragraphs from opposite ends of a document are announced back to back as
     though they had always been neighbours. */
  it('says out loud that a stretch of unchanged text was hidden', () => {
    const long = `${Array.from({ length: 20 }, (_, i) => `Line ${i}.`).join('\n')}\n`;
    render(long, `${long}And one more.`);
    expect(screen.getByText(en.diffUnchangedHidden)).toBeInTheDocument();
  });

  it('shows nothing of the sort when there was no stretch to hide', () => {
    render('One.\nTwo.', 'One.\nTwo, revised.');
    expect(screen.queryByText(en.diffUnchangedHidden)).not.toBeInTheDocument();
  });
});
