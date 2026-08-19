import type { PluginDocumentDto } from '@diary/shared';
import { describe, expect, it } from 'vitest';
import {
  baseTextBefore,
  diffView,
  hasChanges,
  netGained,
  replay,
  revisionFor,
  type DiffBlock,
} from './history';

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
  /** Every block's text as one string, with a marker around what changed — the shape a reader sees. */
  const rendered = (blocks: DiffBlock[]) =>
    blocks.map((block) =>
      block.kind === 'gap'
        ? '…'
        : block.pieces
            .map((piece) =>
              piece.kind === 'context'
                ? piece.text
                : `${piece.kind === 'added' ? '+' : '-'}[${piece.text}]`,
            )
            .join(''),
    );

  const paragraphs = (blocks: DiffBlock[]) => blocks.filter((block) => block.kind === 'paragraph');

  /* The complaint this rewrite answers. A paragraph is one block, and a sentence rewritten inside it
     is marked where it stands — not lifted out into rows of its own with nothing to say that the
     sentences either side of it were its neighbours all along. */
  it('marks a rewritten sentence inside the paragraph it belongs to', () => {
    const view = diffView(
      'First one. Second one. Third one.',
      'First one. Second ones. Third one.',
    );
    expect(view).toHaveLength(1);
    expect(rendered(view)).toEqual(['First one. -[Second one. ]+[Second ones. ]Third one.']);
  });

  it('keeps two edits to one paragraph in that one paragraph', () => {
    const view = diffView('One. Two. Three.', 'One changed. Two. Three changed.');
    expect(view).toHaveLength(1);
    expect(rendered(view)).toEqual(['-[One. ]+[One changed. ]Two. -[Three.]+[Three changed.]']);
  });

  /* The other half of the same distinction, and it falls out of the line break rather than being
     decided anywhere: a whole paragraph replaced reads as the old paragraph struck through *above*
     the new one, because each of them is a paragraph and wants to be read as one. Only a change
     inside a paragraph is marked inline. */
  it('draws a replaced paragraph as two paragraphs, old above new', () => {
    expect(rendered(diffView('A one.\nB one.\nC one.', 'A one.\nB two.\nC one.'))).toEqual([
      'A one.',
      '-[B one.]',
      '+[B two.]',
      'C one.',
    ]);
  });

  /* The blank line between two paragraphs is a block of its own, so the shape of the document
     survives into its history rather than every paragraph looking equally spaced. */
  it('keeps a blank line between paragraphs as a block of its own', () => {
    expect(rendered(diffView('One.\n\nTwo.', 'One.\n\nTwo, revised.'))).toEqual([
      'One.',
      '',
      '-[Two.]+[Two, revised.]',
    ]);
  });

  it('marks a whole paragraph that was added, and one that was taken out', () => {
    expect(rendered(diffView('Keep.\nDrop.\n', 'Keep.\nAdded.\n'))).toEqual([
      'Keep.',
      '-[Drop.]',
      '+[Added.]',
    ]);
  });

  it('says which paragraphs changed, so unchanged ones can be drawn quietly', () => {
    const view = diffView('A one.\nB one.', 'A one.\nB two.');
    expect(paragraphs(view).map((block) => block.changed)).toEqual([false, true]);
  });

  /* A segment owns its trailing newline, so appending to a document technically rewrites the
     paragraph appended to — purely to give it the newline that now separates the two. Drawing that
     as a paragraph struck through and immediately retyped, identically, is the diff being honest
     about its units and misleading about the document. */
  it('does not report a paragraph as rewritten when only its trailing newline moved', () => {
    expect(rendered(diffView('One thought.', 'One thought.\nAnd another.'))).toEqual([
      'One thought.',
      '+[And another.]',
    ]);
  });

  it('collapses long unchanged stretches so the change is what you see', () => {
    const before = `${Array.from({ length: 40 }, (_, i) => `Line ${i}.`).join('\n')}\n`;
    const view = diffView(before, `${before}New last line.`);
    // 2 paragraphs of context either side of the gap, not 40 of unchanged text.
    expect(rendered(view)).toEqual([
      'Line 0.',
      'Line 1.',
      '…',
      'Line 38.',
      'Line 39.',
      '+[New last line.]',
    ]);
  });

  it('shows a short unchanged run whole rather than collapsing it', () => {
    const view = diffView('A.\nB.\nC.\n', 'A.\nB.\nC.\nD.');
    expect(view.some((block) => block.kind === 'gap')).toBe(false);
    expect(rendered(view)).toEqual(['A.', 'B.', 'C.', '+[D.]']);
  });

  it('is every paragraph added, for the first day a document existed', () => {
    expect(rendered(diffView('', 'First. Second.'))).toEqual(['+[First. ]+[Second.]']);
  });
});

describe('hasChanges', () => {
  it('is true when anything at all was marked', () => {
    expect(hasChanges(diffView('One.', 'Two.'))).toBe(true);
  });

  /* A day can legitimately have changed nothing: an edit typed and undone still rewrites that day's
     revision, to say so. The dialog shows a sentence rather than the whole document unmarked. */
  it('is false for two days that read identically', () => {
    expect(hasChanges(diffView('One. Two.', 'One. Two.'))).toBe(false);
  });

  it('is false for nothing at all', () => {
    expect(hasChanges(diffView('', ''))).toBe(false);
  });
});
