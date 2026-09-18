import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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

type ListBlock = Extract<ReturnType<typeof parseBlocks>[number], { kind: 'list' }>;

const listAt = (blocks: ReturnType<typeof parseBlocks>, index: number): ListBlock => {
  const block = blocks[index];
  if (block?.kind !== 'list') throw new Error(`block ${index} is ${block?.kind}, not a list`);
  return block;
};

describe('parseBlocks', () => {
  it('still reads headings, quotes, rules and code fences as before', () => {
    const blocks = parseBlocks('# Title\n\n> a quote\n\n---\n\n```\ncode\n```');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'quote', 'rule', 'code']);
  });

  it('records each bulleted line’s absolute source index, for the checkbox click handler', () => {
    const blocks = parseBlocks('intro\n\n- one\n- two\n- three');
    const list = listAt(blocks, 1);
    expect(list.items.map((item) => item.text)).toEqual(['one', 'two', 'three']);
    // Blank line at index 1 separates the paragraph (index 0) from the list starting at index 2.
    expect(list.items.map((item) => item.lineNumber)).toEqual([2, 3, 4]);
  });

  it('is unmoved by a bulleted line that merely contains brackets', () => {
    // "[wow]" is not "[ ]" or "[x]" — the task pattern is applied at render time, not here, but the
    // line itself must not be mistaken for one either way.
    const blocks = parseBlocks('- [wow] not a task');
    expect(listAt(blocks, 0).items[0].text).toBe('[wow] not a task');
  });
});

describe('parseBlocks — nested lists', () => {
  /** A list as nested arrays of item text, so a tree reads at a glance in an assertion. */
  type Shape = (string | Shape)[];
  const shape = (list: ListBlock): Shape =>
    list.items.flatMap((item) => [item.text, ...item.children.map(shape)]);

  it('nests an indented item inside the one above it', () => {
    const blocks = parseBlocks('- text\n  - text inside\n- after');
    expect(blocks).toHaveLength(1);
    expect(shape(listAt(blocks, 0))).toEqual(['text', ['text inside'], 'after']);
  });

  it('nests by "further than the line above", however far that is', () => {
    for (const indent of [' ', '  ', '    ', '\t']) {
      const blocks = parseBlocks(`- a\n${indent}- b\n${indent}${indent}- c`);
      expect(shape(listAt(blocks, 0))).toEqual(['a', ['b', ['c']]]);
    }
  });

  it('closes every deeper list when an item comes back out', () => {
    const blocks = parseBlocks('- a\n  - b\n    - c\n- d');
    expect(shape(listAt(blocks, 0))).toEqual(['a', ['b', ['c']], 'd']);
  });

  it('keeps an item that comes back only part of the way out in the nested list it is still inside', () => {
    const blocks = parseBlocks('- a\n    - b\n  - c');
    expect(shape(listAt(blocks, 0))).toEqual(['a', ['b', 'c']]);
  });

  it('nests a numbered list inside a bulleted one, and the other way round', () => {
    const blocks = parseBlocks('1. first\n   - a detail\n2. second');
    const list = listAt(blocks, 0);
    expect(list.ordered).toBe(true);
    expect(shape(list)).toEqual(['first', ['a detail'], 'second']);
    expect(list.items[0].children[0].ordered).toBe(false);
  });

  it('keeps a change of marker at the top level as two lists, as before', () => {
    const blocks = parseBlocks('- a\n1. b');
    expect(blocks.map((block) => block.kind === 'list' && block.ordered)).toEqual([false, true]);
  });

  it('remembers where a numbered list starts', () => {
    expect(listAt(parseBlocks('3. third\n4. fourth'), 0).start).toBe(3);
  });

  it('gives a nested task its own line number, so ticking it flips the right line', () => {
    const blocks = parseBlocks('- [ ] parent\n  - [ ] child');
    expect(listAt(blocks, 0).items[0].children[0].items[0].lineNumber).toBe(1);
  });
});

describe('parseBlocks — math', () => {
  const mathBlocks = (text: string) =>
    parseBlocks(text).filter((block) => block.kind === 'math') as { tex: string }[];

  it('reads a $$ block spanning lines, delimiters on lines of their own', () => {
    expect(mathBlocks('$$\n\\frac{a}{b}\n$$').map((b) => b.tex)).toEqual(['\n\\frac{a}{b}\n']);
  });

  it('reads a one-line $$ block and a \\[ block', () => {
    expect(mathBlocks('$$ x^2 $$').map((b) => b.tex)).toEqual([' x^2 ']);
    expect(mathBlocks('\\[\ny = mx\n\\]').map((b) => b.tex)).toEqual(['\ny = mx\n']);
  });

  it('reads a ```math fence as math, not code', () => {
    const blocks = parseBlocks('```math\ne^{i\\pi} = -1\n```');
    expect(blocks).toEqual([
      { kind: 'math', tex: 'e^{i\\pi} = -1', source: '```math\ne^{i\\pi} = -1\n```' },
    ]);
  });

  it('ends a paragraph where a formula starts, the way Obsidian reads it', () => {
    const blocks = parseBlocks('The sum is\n$$\nn^2\n$$\nand that is all.');
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'math', 'paragraph']);
  });

  /* A half-typed formula must not turn the rest of the document into LaTeX that cannot parse. */
  it('leaves a $$ that never closes as ordinary text', () => {
    const blocks = parseBlocks('$$\nstill typing\n\n# A heading');
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'heading']);
  });

  it('leaves a line that only starts with a display formula to the inline grammar', () => {
    expect(parseBlocks('$$x$$ and then prose').map((block) => block.kind)).toEqual(['paragraph']);
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

  it('renders a nested item as a list inside its parent item', () => {
    render('- text\n  - text inside\n- after');
    const inner = screen.getByText('text inside').closest('ul')!;
    const parentItem = inner.parentElement!;
    expect(parentItem.tagName).toBe('LI');
    expect(parentItem).toHaveTextContent(/^text/);
    // Two items at the top, not three: the nested one is not a sibling of the others.
    expect(parentItem.parentElement!.children).toHaveLength(2);
  });

  it('keeps a nested task’s checkbox writing to its own line', () => {
    const onToggleTask = vi.fn();
    render('- [ ] parent\n  - [ ] child', onToggleTask);
    fireEvent.click(screen.getByRole('checkbox', { name: 'child' }));
    expect(onToggleTask).toHaveBeenCalledWith('- [ ] parent\n  - [x] child');
  });

  it('numbers an ordered list from wherever it starts', () => {
    render('3. third\n4. fourth');
    expect(screen.getByRole('list')).toHaveAttribute('start', '3');
  });
});

describe('MarkdownView — math', () => {
  it('typesets inline math with KaTeX once the renderer arrives', async () => {
    const { container } = render('Euler: $e^{i\\pi} + 1 = 0$, famously.');
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
    // Nothing of the source is left once it has rendered — the delimiters included.
    expect(container).not.toHaveTextContent('$');
  });

  it('typesets a display block as a display formula', async () => {
    const { container } = render('$$\n\\sum_{k=1}^{n} k\n$$');
    await waitFor(() => expect(container.querySelector('.katex-display')).not.toBeNull());
  });

  it('shows LaTeX it cannot parse as written, marked, with the reason', async () => {
    render('Oops: $\\frac{a}{$');
    await waitFor(() =>
      expect(screen.getByText('$\\frac{a}{$')).toHaveAttribute(
        'title',
        expect.stringContaining("Couldn't typeset this formula"),
      ),
    );
  });

  it('leaves prices alone', () => {
    const { container } = render('It was $5 and then $10.');
    expect(screen.getByText('It was $5 and then $10.')).toBeInTheDocument();
    expect(container.querySelector('.katex')).toBeNull();
  });

  it('never reads an underscore inside a formula as emphasis', () => {
    const { container } = render('Take $a_1 + b_2$ as given.');
    expect(container.querySelector('em')).toBeNull();
  });
});
