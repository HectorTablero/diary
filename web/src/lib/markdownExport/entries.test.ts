import type { EntryDto } from '@diary/shared';
import { describe, expect, it } from 'vitest';
import { buildEntriesMarkdown } from './entries';

/* The rule under test is a subtraction: a link is only worth a line of its own when the entry's own
   text does not already say it. Over a year of entries the repetition is most of the document, and
   it buries the handful of links that genuinely add something — the person an entry is about
   without naming, the tag picked from the picker and never typed.
 *
 * What each case pins down is where the line sits. Too eager and a mention is lost from an entry
 * that never names the person; too shy and the export is back to repeating itself. */

const entry = (over: Partial<EntryDto> & { content: string }): EntryDto => ({
  id: 'e1',
  dateKey: '2026-09-01',
  importance: 3,
  tags: [],
  people: [],
  threads: [],
  saidTo: [],
  hiddenFor: [],
  parentId: null,
  orderKey: 'a0',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  ...over,
});

const tag = (name: string) => ({ id: `tag-${name}`, name, color: '#000000' });
const person = (name: string) => ({ id: `person-${name}`, name });

/** Just the day's own block. The preamble explains the rule in the same words the lines use, so a
    document-wide `not.toContain('Tags:')` would only ever be testing the explanation. */
const build = (over: Partial<EntryDto> & { content: string }) => {
  const markdown = buildEntriesMarkdown([entry(over)], { from: null, to: null });
  return markdown.slice(markdown.indexOf('## 2026-09-01'));
};

const whole = (over: Partial<EntryDto> & { content: string }) =>
  buildEntriesMarkdown([entry(over)], { from: null, to: null });

describe('buildEntriesMarkdown — tags and mentions', () => {
  it('says nothing about a mention the entry already writes as a token', () => {
    const markdown = build({
      content: 'Coffee with @Ana about the #move.',
      tags: [tag('move')],
      people: [person('Ana')],
    });
    expect(markdown).not.toContain('Mentions:');
    expect(markdown).not.toContain('Tags:');
  });

  it('lists the ones the text never names', () => {
    const markdown = build({
      content: 'Long call about the flat.',
      tags: [tag('housing')],
      people: [person('Ana')],
    });
    expect(markdown).toContain('  Tags: #housing');
    expect(markdown).toContain('  Mentions: Ana');
  });

  it('lists only the half that is missing', () => {
    const markdown = build({
      content: 'Coffee with @Ana, who is moving.',
      tags: [tag('housing')],
      people: [person('Ana'), person('Bruno')],
    });
    expect(markdown).toContain('  Tags: #housing');
    expect(markdown).toContain('  Mentions: Bruno');
    // Bruno alone, not "Ana, Bruno" — the sentence already introduced Ana.
    expect(markdown).not.toMatch(/Mentions:.*Ana/);
  });

  it('counts a plain word as naming, and does so past accents and capitals', () => {
    const markdown = build({
      content: 'Ana María came round; we talked about Housing.',
      tags: [tag('housing')],
      people: [person('Ana María')],
    });
    expect(markdown).not.toContain('Mentions:');
    expect(markdown).not.toContain('Tags:');
  });

  it('does not count a name buried inside a longer word', () => {
    const markdown = build({
      content: 'Anabel sent the contract over.',
      people: [person('Ana')],
    });
    expect(markdown).toContain('  Mentions: Ana');
  });

  it('explains the omission at the top, so a missing line is not read as no tags at all', () => {
    const markdown = whole({ content: 'Nothing much.' });
    expect(markdown).toContain('## Tags and mentions');
    expect(markdown.indexOf('## Tags and mentions')).toBeLessThan(
      markdown.indexOf('## Importance scale'),
    );
  });
});
