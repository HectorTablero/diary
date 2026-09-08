import { describe, expect, it } from 'vitest';
import {
  documentReferenceAt,
  highlightSource,
  referencedDocumentIds,
  type HighlightKind,
  type HighlightSpan,
} from './syntax';

/* The editor's overlay is a second copy of the document, laid out on top of the first one. Every
 * test here is ultimately about that: the two copies must be the same text, and the decoration must
 * land on the characters it names. The first `describe` is the one that matters — a span list that
 * doesn't reassemble into the input is a highlight that has slid off the prose, which is a bug you
 * see rather than one you debug. */

const ANA = { id: 'p1', name: 'Ana' };
const PEOPLE = [ANA, { id: 'p2', name: 'Ana María' }];

const paint = (text: string) => highlightSource(text, PEOPLE);
const rebuild = (spans: HighlightSpan[]) => spans.map((span) => span.text).join('');
const kinds = (spans: HighlightSpan[]) => spans.map((span) => [span.kind, span.text]);
const textOf = (spans: HighlightSpan[], kind: HighlightKind) =>
  spans.filter((span) => span.kind === kind).map((span) => span.text);

const SAMPLES = [
  '',
  '\n',
  '\n\n\n',
  'Just a sentence.',
  'Met @Ana for coffee.',
  'Met @Ana María, not @Ana.',
  '@Nobody is a person this app has never heard of.',
  '# A heading with @Ana in it',
  '###### Six levels',
  '#not a heading',
  '> Something quoted, with **weight**.',
  '> - a bullet inside a quote',
  '- one\n- two\n- three',
  '1. first\n2) second',
  '- [ ] unticked, with @Ana\n- [x] ticked\n- [X] also ticked',
  '---',
  '   ***   ',
  '___',
  'Some `code with **stars**` inline.',
  '```\nconst x = 1;\n**not bold**\n```',
  '```ts\nunclosed fence\n',
  'A [link](https://example.com) and an ![image](https://example.com/a.png).',
  'An ![](empty-alt.png) too.',
  'See [[68a1f2c3d4e5f60718293a4b]] for the rest.',
  'Two: [[aaa]] and [[bbb]] and [[aaa]] again.',
  'A stray [[ and a stray ]] and a lone [x].',
  '**@Ana** wrote _this_ and *that*.',
  'Mixed: # not a heading mid-line, - not a bullet mid-line.',
  'Trailing spaces   \nand a tab\tinside.',
  'Emoji 🌱 and accents café, with @Ana.',
];

describe('highlightSource', () => {
  it.each(SAMPLES)('reassembles into exactly the source: %j', (source) => {
    expect(rebuild(paint(source))).toBe(source);
  });

  it('never emits an empty span', () => {
    for (const source of SAMPLES) {
      expect(paint(source).every((span) => span.text.length > 0)).toBe(true);
    }
  });

  it('merges neighbouring runs of the same kind, so prose is a handful of nodes', () => {
    const prose = Array.from({ length: 40 }, (_, i) => `Line ${i} of ordinary prose.`).join('\n');
    expect(paint(prose)).toHaveLength(1);
  });

  it('tints a mention that resolves and leaves one that does not as prose', () => {
    expect(textOf(paint('Met @Ana and @Nobody.'), 'person')).toEqual(['@Ana']);
    expect(rebuild(paint('Met @Ana and @Nobody.'))).toContain('@Nobody');
  });

  it('prefers the longer name, the same way the diary does', () => {
    expect(textOf(paint('@Ana María said so'), 'person')).toEqual(['@Ana María']);
  });

  it('leaves # alone mid-line, because the notebook has no tags', () => {
    expect(paint('a #tag-shaped thing')).toEqual([{ kind: 'text', text: 'a #tag-shaped thing' }]);
  });

  it('separates a heading marker from the heading itself', () => {
    const spans = paint('## Writing with **weight** and @Ana');
    expect(kinds(spans)).toEqual([
      ['syntax', '## '],
      ['text', 'Writing with '],
      ['syntax', '**'],
      ['strong', 'weight'],
      ['syntax', '**'],
      ['text', ' and '],
      ['person', '@Ana'],
    ]);
    /* Everything but the hashes is the heading, including the bold word and the mention — which is
       why this is a modifier and not a kind of its own. */
    expect(spans.filter((span) => span.heading).map((span) => span.text)).toEqual([
      'Writing with ',
      '**',
      'weight',
      '**',
      ' and ',
      '@Ana',
    ]);
  });

  it('marks a quoted line quoted, down to what is inside it', () => {
    const spans = paint('> Something @Ana said.');
    expect(spans.filter((span) => span.quoted).map((span) => span.text)).toEqual([
      'Something ',
      '@Ana',
      ' said.',
    ]);
    // The marker is punctuation, not quoted words — same rule as the hashes and the checkbox.
    expect(spans.find((span) => span.text === '> ')?.quoted).toBeUndefined();
  });

  it('carries the id of a document reference, where it is, and keeps the token whole', () => {
    const spans = paint('see [[abc]] there');
    expect(spans).toContainEqual({ kind: 'document', text: '[[abc]]', id: 'abc', start: 4 });
  });

  /* The offset is what tells two references to the same document apart, which is the only way the
     editor can reveal the raw id of the one the caret is actually in. */
  it('gives two references to the same document their own offsets', () => {
    const starts = paint('[[a]] and [[a]]')
      .filter((span) => span.kind === 'document')
      .map((span) => span.start);
    expect(starts).toEqual([0, 10]);
  });

  it('reads a code span as code, marks apart, and does not look inside it', () => {
    expect(kinds(paint('use `**stars**` here'))).toEqual([
      ['text', 'use '],
      ['syntax', '`'],
      ['code', '**stars**'],
      ['syntax', '`'],
      ['text', ' here'],
    ]);
  });

  it('names both emphases, so the editor can give both a shape', () => {
    expect(kinds(paint('**@Ana** and *plain* and _also_'))).toEqual([
      ['syntax', '**'],
      ['person', '@Ana'],
      ['syntax', '**'],
      ['text', ' and '],
      ['syntax', '*'],
      ['emphasis', 'plain'],
      ['syntax', '*'],
      ['text', ' and '],
      ['syntax', '_'],
      ['emphasis', 'also'],
      ['syntax', '_'],
    ]);
  });

  it('splits a link into what is shown and where it goes', () => {
    expect(kinds(paint('[home](https://example.com)'))).toEqual([
      ['syntax', '['],
      ['label', 'home'],
      ['syntax', ']('],
      ['url', 'https://example.com'],
      ['syntax', ')'],
    ]);
  });

  it('does the same for an image, whose alt text may be empty', () => {
    expect(kinds(paint('![a cat](a.png)'))).toEqual([
      ['syntax', '!['],
      ['label', 'a cat'],
      ['syntax', ']('],
      ['url', 'a.png'],
      ['syntax', ')'],
    ]);
    // With nothing between them, the two syntax runs are one span — see `push`.
    expect(kinds(paint('![](a.png)'))).toEqual([
      ['syntax', '![]('],
      ['url', 'a.png'],
      ['syntax', ')'],
    ]);
  });

  it('takes a fence whole, newlines and all, and stops at the closing one', () => {
    const spans = paint('before\n```\nx **y**\n```\nafter');
    expect(textOf(spans, 'code')).toEqual(['\nx **y**\n']);
    expect(textOf(spans, 'syntax')).toEqual(['```', '```']);
  });

  it('runs an unclosed fence to the end of the document', () => {
    expect(textOf(paint('```\none\ntwo'), 'code')).toEqual(['\none\ntwo']);
  });

  /* A ticked item is struck through, not flattened: it is still a task, its mentions are still
     mentions and its references are still links, exactly as the preview keeps them clickable. */
  it('marks a ticked task struck while keeping everything inside it live', () => {
    const spans = paint('- [x] done with @Ana and [[abc]]');
    expect(kinds(spans)).toEqual([
      ['syntax', '- [x] '],
      ['text', 'done with '],
      ['person', '@Ana'],
      ['text', ' and '],
      ['document', '[[abc]]'],
    ]);
    // The box itself stays upright — the preview draws it as a real checkbox.
    expect(spans.filter((span) => span.struck).map((span) => span.text)).toEqual([
      'done with ',
      '@Ana',
      ' and ',
      '[[abc]]',
    ]);
  });

  it('leaves an unticked task, and the line after a ticked one, unstruck', () => {
    const spans = paint('- [x] done\n- [ ] not done\nand prose');
    expect(spans.filter((span) => span.struck).map((span) => span.text)).toEqual(['done']);
  });

  it('reads a rule as syntax rather than as a bullet', () => {
    expect(kinds(paint('---'))).toEqual([['syntax', '---']]);
  });
});

describe('referencedDocumentIds', () => {
  it('deduplicates, keeping the order they appear in', () => {
    expect(referencedDocumentIds('[[b]] then [[a]] then [[b]]')).toEqual(['b', 'a']);
  });

  it('finds nothing in a document without references', () => {
    expect(referencedDocumentIds('a [link](url) and a [x] box')).toEqual([]);
  });
});

describe('documentReferenceAt', () => {
  const TEXT = 'see [[abc]] here';

  it('answers for a caret anywhere inside the token, including both edges', () => {
    // '[' is at 4, ']' ends at 11.
    for (const caret of [4, 5, 8, 11]) {
      expect(documentReferenceAt(TEXT, caret)?.id).toBe('abc');
    }
  });

  it('answers with nothing on either side of it', () => {
    expect(documentReferenceAt(TEXT, 3)).toBeNull();
    expect(documentReferenceAt(TEXT, 12)).toBeNull();
  });

  it('picks the token the caret is in when there are several', () => {
    const many = '[[a]] [[b]] [[c]]';
    expect(documentReferenceAt(many, 8)?.id).toBe('b');
    expect(documentReferenceAt(many, 14)?.id).toBe('c');
  });

  /* Half-typed `[[` is the suggestion list's business, and it is already naming every document it
     would link to. A second label saying the same thing would only be in the way. */
  it('ignores a reference that has not been closed yet', () => {
    expect(documentReferenceAt('see [[ab', 8)).toBeNull();
  });
});
