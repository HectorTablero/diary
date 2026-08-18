import type { PluginDocumentDto } from '@diary/shared';
import { describe, expect, it } from 'vitest';
import { baseTextBefore, diffView, netGained, replay, revisionFor } from './history';

/** A revision row carrying the patch from `from` to `to`, as putDocumentRevision would store it. */
const revision = (dateKey: string, from: string, to: string): PluginDocumentDto => {
  const { patch, added, removed } = revisionFor(from, to);
  return {
    id: `rev-${dateKey}`,
    pluginId: 'notebook',
    dateKey,
    documentId: 'doc-1',
    parentId: '',
    title: '',
    body: patch,
    sortKey: '',
    added,
    removed,
    createdAt: `${dateKey}T09:00:00.000Z`,
    updatedAt: `${dateKey}T09:00:00.000Z`,
  };
};

/* A thought as it actually grows: written one day, extended the next, partly cut the third. */
const MON = 'Time well spent.';
const TUE = 'Time well spent.\n\nLearning, enjoyment, investment.';
const WED = 'Time well spent?\n\nLearning and enjoyment.';

const chain = [
  revision('2026-08-10', '', MON),
  revision('2026-08-11', MON, TUE),
  revision('2026-08-12', TUE, WED),
];

describe('replay', () => {
  it('reconstructs the text as of the end of each day', () => {
    expect(replay(chain).map((d) => d.text)).toEqual([MON, TUE, WED]);
  });

  it('ends at the document body, which is what makes the chain the past and the row the present', () => {
    expect(replay(chain).at(-1)?.text).toBe(WED);
  });

  it('is empty for a document that was created and never written in', () => {
    expect(replay([])).toEqual([]);
  });
});

describe('baseTextBefore', () => {
  /* The load-bearing one. Today's revision is rewritten on every save, so the base it diffs against
     must be where the *day* started — never where the last save left off, which would make a day's
     patch record only its final keystroke. */
  it('is the text as of the day before, excluding that day itself', () => {
    expect(baseTextBefore(chain, '2026-08-12')).toBe(TUE);
    expect(baseTextBefore(chain, '2026-08-11')).toBe(MON);
    expect(baseTextBefore(chain, '2026-08-10')).toBe('');
  });

  it('is the whole chain for a day after every revision', () => {
    expect(baseTextBefore(chain, '2026-09-01')).toBe(WED);
  });

  it('re-saving the same day keeps one revision holding the whole day of work', () => {
    const base = baseTextBefore(chain, '2026-08-12');
    const firstSave = revisionFor(base, 'Time well spent?');
    const secondSave = revisionFor(base, WED);
    // Both are patches from Tuesday, not from each other: the second replaces the first outright.
    expect(
      replay([...chain.slice(0, 2), { ...chain[2], body: firstSave.patch }]).at(-1)?.text,
    ).toBe('Time well spent?');
    expect(
      replay([...chain.slice(0, 2), { ...chain[2], body: secondSave.patch }]).at(-1)?.text,
    ).toBe(WED);
  });
});

describe('revisionFor', () => {
  /* Both sides, counted from the diff rather than from the two lengths. A net figure would report a
     day of rewriting as nothing at all, which is the opposite of what happened. */
  it('counts what was written and what was taken out', () => {
    expect(revisionFor('', 'abcdef')).toMatchObject({ added: 6, removed: 0 });
    expect(revisionFor('abcdef', '')).toMatchObject({ added: 0, removed: 6 });
  });

  it('counts a rewrite as both, never as the difference between them', () => {
    const { added, removed } = revisionFor('a long thought', 'short');
    expect(added).toBe(5);
    expect(removed).toBe(14);
  });

  it('leaves untouched lines out of both counts', () => {
    const { added, removed } = revisionFor('keep\ndrop', 'keep\nnew line');
    expect(added).toBe('new line'.length);
    expect(removed).toBe('drop'.length);
  });

  it('reports no change when an edit was typed and undone', () => {
    expect(revisionFor(TUE, TUE)).toMatchObject({ added: 0, removed: 0, changed: false });
    expect(revisionFor(TUE, WED).changed).toBe(true);
  });
});

describe('netGained', () => {
  /* The calendar's reading, and the one that has already been changed once. It is net growth, not
     how much was written — the day card is where both sides of a day's work are reported. */
  it('is what was written less what was cut', () => {
    expect(netGained({ added: 500, removed: 120 })).toBe(380);
  });

  it('is zero for a day of rewriting, which is the whole point of using net here', () => {
    expect(netGained({ added: 400, removed: 400 })).toBe(0);
  });

  it('never goes below zero, so a shrinking document cannot eat another one’s growth', () => {
    expect(netGained({ added: 10, removed: 900 })).toBe(0);
  });
});

describe('diffView', () => {
  it('marks added and removed lines against their context', () => {
    expect(diffView('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'context', text: 'c' },
    ]);
  });

  it('collapses long unchanged stretches so the change is what you see', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const after = `${before}\nnew last line`;
    const view = diffView(before, after);
    expect(view.filter((l) => l.kind === 'added')).toEqual([
      { kind: 'added', text: 'new last line' },
    ]);
    // 2 lines of context either side of the gap marker, not 40 lines of unchanged text.
    expect(view).toHaveLength(6);
    expect(view.some((l) => l.text === '…')).toBe(true);
  });

  it('shows a short unchanged run whole rather than collapsing it', () => {
    expect(diffView('a\nb\nc', 'a\nb\nc\nd').filter((l) => l.kind === 'context')).toHaveLength(3);
  });
});
