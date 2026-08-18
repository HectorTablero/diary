import 'fake-indexeddb/auto';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { createPluginDocument } from '@/db/pluginDocuments';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';
import en from './locales/en.json';
import { MarkdownView, parseBlocks, toggleTaskAtLine } from './MarkdownView';

/* The parser's own regression net (headings, lists, code, rule — unchanged by this pass) plus the
 * four constructs added on top of it: links, images, task checkboxes and `[[id]]` document
 * references. Rendering is exercised with the real Dexie-backed `useDocumentLabels` (via
 * fake-indexeddb) rather than a mock, matching this plugin's own testing style — see
 * NotebookDayWidget.test.tsx. Cache Storage is absent from jsdom, so `NotebookImage` always takes
 * its "not cached" branch and renders a plain `<img>`, which is exactly what these tests need. */

beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', { plugins: { notebook: en } }, true, true);
  await db.pluginDocuments.clear();
  await db.outbox.clear();
});

const render = (text: string, onToggleTask?: (next: string) => void) =>
  renderWithProviders(<MarkdownView text={text} people={[]} onToggleTask={onToggleTask} />, {
    toaster: false,
  });

describe('parseBlocks', () => {
  it('still reads headings, quotes, rules and code fences as before', () => {
    const blocks = parseBlocks('# Title\n\n> a quote\n\n---\n\n```\ncode\n```');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'quote', 'rule', 'code']);
  });

  it('records each bulleted line’s absolute source index, for the checkbox click handler', () => {
    const blocks = parseBlocks('intro\n\n- one\n- two\n- three');
    const bullets = blocks.find((b) => b.kind === 'bullets')!;
    expect(bullets.lines).toEqual(['one', 'two', 'three']);
    // Blank line at index 1 separates the paragraph (index 0) from the list starting at index 2.
    expect(bullets.lineNumbers).toEqual([2, 3, 4]);
  });

  it('is unmoved by a bulleted line that merely contains brackets', () => {
    // "[wow]" is not "[ ]" or "[x]" — the task pattern is applied at render time, not here, but the
    // line itself must not be mistaken for one either way.
    const blocks = parseBlocks('- [wow] not a task');
    expect(blocks[0].lines).toEqual(['[wow] not a task']);
  });
});

describe('toggleTaskAtLine', () => {
  it('flips an unchecked box to checked, leaving the rest of the document untouched', () => {
    const text = 'above\n- [ ] buy milk\nbelow';
    expect(toggleTaskAtLine(text, 1)).toBe('above\n- [x] buy milk\nbelow');
  });

  it('flips a checked box back to unchecked', () => {
    expect(toggleTaskAtLine('- [x] done', 0)).toBe('- [ ] done');
  });

  it('is a no-op past the end of the document', () => {
    const text = '- [ ] only line';
    expect(toggleTaskAtLine(text, 5)).toBe(text);
  });
});

describe('MarkdownView', () => {
  it('renders a Markdown link as a real, new-tab anchor', () => {
    render('See [the source](https://example.com/page).');
    const link = screen.getByRole('link', { name: 'the source' });
    expect(link).toHaveAttribute('href', 'https://example.com/page');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders an image by its src and alt text', () => {
    render('![a diagram](https://example.com/diagram.png)');
    const img = screen.getByRole('img', { name: 'a diagram' });
    expect(img).toHaveAttribute('src', 'https://example.com/diagram.png');
  });

  it('renders an unchecked task as a checkbox naming its own text, and toggles it on click', () => {
    const onToggleTask = vi.fn();
    render('- [ ] Buy milk', onToggleTask);

    const checkbox = screen.getByRole('checkbox', { name: 'Buy milk' });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(onToggleTask).toHaveBeenCalledWith('- [x] Buy milk');
  });

  it('renders a checked task as checked, struck through', () => {
    render('- [x] Already done');
    expect(screen.getByRole('checkbox', { name: 'Already done' })).toBeChecked();
  });

  it('disables the checkbox, rather than hiding it, when there is nowhere to write the change', () => {
    render('- [ ] read-only');
    expect(screen.getByRole('checkbox', { name: 'read-only' })).toBeDisabled();
  });

  it('resolves a [[id]] reference to the document’s current label, as a link to it', async () => {
    const target = await createPluginDocument('notebook', {
      parentId: '',
      title: 'Enneagram notes',
      body: '',
      sortKey: 'a0',
    });
    render(`See [[${target.id}]] for more.`);

    const link = await screen.findByRole('link', { name: 'Enneagram notes' });
    expect(link).toHaveAttribute('href', `/plugins/notebook?doc=${target.id}`);
  });

  it('shows a [[id]] that resolves to nothing as the literal text, never as a dead link', () => {
    render('See [[not-a-real-id]] for more.');
    expect(screen.getByText(/\[\[not-a-real-id\]\]/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /not-a-real-id/ })).not.toBeInTheDocument();
  });
});
