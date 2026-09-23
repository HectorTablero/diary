import { describe, expect, it } from 'vitest';
import type { PluginDocumentDto } from '@diary/shared';
import { documentLabel } from './model';
import { documentPreview } from './preview';

/* The row under a document is a glance at its words: every case here is some piece of markup that
 * used to show up in it verbatim, and the words it should have been instead. */

const preview = (body: string, label = '', labels = new Map<string, string>(), max?: number) =>
  documentPreview(body, label, labels, max);

describe('documentPreview', () => {
  it('drops emphasis, code and heading marks but keeps their words', () => {
    expect(preview('# Plan\nSome **bold**, _italic_, *also* and `code`.')).toBe(
      'Plan Some bold, italic, also and code.',
    );
  });

  it('drops list bullets, checkboxes and quote markers', () => {
    expect(preview('- one\n- [x] two\n1. three\n> four')).toBe('one two three four');
  });

  it('keeps a link or image by its words, never its target', () => {
    expect(preview('See [the docs](https://example.com) and ![a cat](cat.png).')).toBe(
      'See the docs and a cat.',
    );
  });

  it('shows a reference as the title it points at, and leaves out one it cannot resolve', () => {
    const labels = new Map([['abc123', 'Reading list']]);
    expect(preview('Linked to [[abc123]] and [[gone]] here.', '', labels)).toBe(
      'Linked to Reading list and here.',
    );
  });

  it('strips formula delimiters and eases the LaTeX inside', () => {
    expect(preview(String.raw`Energy $E = mc^{2}$ and \(\alpha \cdot \beta\)`)).toBe(
      'Energy E = mc^2 and α · β',
    );
    expect(preview('$$\n\\frac{a}{b} \\text{ m}\n$$')).toBe('a/b m');
  });

  it('leaves a price alone, the same way the editor does', () => {
    expect(preview('Lunch was $5 and $10 tip')).toBe('Lunch was $5 and $10 tip');
  });

  it('leaves out a diagram and rules, and keeps a fenced code block as text', () => {
    expect(
      preview('Before\n```mermaid\ngraph TD; A-->B\n```\n---\n```\nlet x = 1\n```\nAfter'),
    ).toBe('Before let x = 1 After');
  });

  it('drops the line the label was taken from, once', () => {
    expect(preview('# Title\nbody\nTitle', 'Title')).toBe('body Title');
  });

  it('truncates to the visible length', () => {
    const result = preview(`**${'word '.repeat(50)}**`, '', undefined, 20);
    expect(result).toHaveLength(20);
    expect(result.endsWith('…')).toBe(true);
  });

  it('is empty for a document with nothing but markup', () => {
    expect(preview('---\n\n- [ ] \n')).toBe('');
  });
});

describe('documentLabel', () => {
  const doc = (body: string, title = '') => ({ title, body }) as PluginDocumentDto;

  it('labels an untitled document by the words of its first line', () => {
    expect(documentLabel(doc('## **Ideas** for _later_\nmore'), 'Untitled')).toBe(
      'Ideas for later',
    );
  });

  it('skips a first line that is nothing but markup', () => {
    expect(documentLabel(doc('---\n- [ ] \n> Actual words'), 'Untitled')).toBe('Actual words');
  });

  it('leaves an explicit title exactly as typed', () => {
    expect(documentLabel(doc('body', '**Mine**'), 'Untitled')).toBe('**Mine**');
  });

  it('keeps the labelled line out of the preview once it is plain text', () => {
    const d = doc('# **Ideas**\nthe rest');
    expect(documentPreview(d.body, documentLabel(d, 'Untitled'))).toBe('the rest');
  });
});
