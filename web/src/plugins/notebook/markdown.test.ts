import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { createPluginDocument, putDocumentRevision } from '@/db/pluginDocuments';
import i18n from '@/i18n';
import en from './locales/en.json';
import { revisionFor } from './history';
import { buildNotebookMergedMarkdown, buildNotebookZipEntries } from './markdown';

/* The export's own regression net: frontmatter shape, tree order, `[[id]]` → `[[Title]]` rewriting,
 * and the ZIP builder's folder layout and per-directory dedup. A plain `.test.ts` file rather than
 * `.test.tsx` — nothing here touches React, so it runs in the fast node-environment `logic` project
 * (see vitest.config.ts) rather than jsdom, the same way db.test.ts does for Dexie. */

beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', { plugins: { notebook: en } }, true, true);
  await db.pluginDocuments.clear();
  await db.outbox.clear();
});

describe('buildNotebookMergedMarkdown', () => {
  it('is null when the notebook is empty', async () => {
    expect(await buildNotebookMergedMarkdown()).toBeNull();
  });

  it('writes one frontmatter block per document, root before child, with the fields the export promises', async () => {
    const parent = await createPluginDocument('notebook', {
      parentId: '',
      title: 'Psychology',
      body: 'An overview.',
      sortKey: 'a0',
    });
    const child = await createPluginDocument('notebook', {
      parentId: parent.id,
      title: 'Enneagram',
      body: 'Type 1 notes.',
      sortKey: 'a0',
    });

    const markdown = await buildNotebookMergedMarkdown();
    expect(markdown).not.toBeNull();
    const parentIndex = markdown!.indexOf(`id: ${parent.id}`);
    const childIndex = markdown!.indexOf(`id: ${child.id}`);
    expect(parentIndex).toBeGreaterThanOrEqual(0);
    expect(childIndex).toBeGreaterThan(parentIndex);

    expect(markdown).toContain('title: Psychology');
    expect(markdown).toContain('path: Psychology');
    expect(markdown).toContain('title: Enneagram');
    expect(markdown).toContain('path: Psychology / Enneagram');
    expect(markdown).toContain(`parent: ${parent.id}`);
    // The root document's own frontmatter block (its first, bounded by the closing `---`) has no
    // parent line at all, not an empty one.
    const parentBlock = markdown!.slice(0, markdown!.indexOf('\n---\n\n', 4) + 4);
    expect(parentBlock).not.toContain('parent:');
    expect(markdown).toContain('An overview.');
    expect(markdown).toContain('Type 1 notes.');
  });

  it('counts edits as the number of days a document has a revision for', async () => {
    const doc = await createPluginDocument('notebook', {
      parentId: '',
      title: 'Habit',
      body: 'today',
      sortKey: 'a0',
    });
    await putDocumentRevision('notebook', doc.id, '2026-08-01', 'today', 5, 0);
    await putDocumentRevision('notebook', doc.id, '2026-08-02', 'still today', 6, 5);

    const markdown = await buildNotebookMergedMarkdown();
    expect(markdown).toContain('edits: 2');
  });

  it('rewrites a resolvable [[id]] to the Obsidian wikilink form, and leaves a dead one alone', async () => {
    const target = await createPluginDocument('notebook', {
      parentId: '',
      title: 'Target',
      body: '',
      sortKey: 'a0',
    });
    const source = await createPluginDocument('notebook', {
      parentId: '',
      title: 'Source',
      body: `See [[${target.id}]] and [[missing-id]].`,
      sortKey: 'a1',
    });
    void source;

    const markdown = await buildNotebookMergedMarkdown();
    expect(markdown).toContain('See [[Target]] and [[missing-id]].');
  });

  it('quotes a title that would otherwise read as a YAML mapping', async () => {
    await createPluginDocument('notebook', {
      parentId: '',
      title: 'Note: a colon',
      body: '',
      sortKey: 'a0',
    });
    const markdown = await buildNotebookMergedMarkdown();
    expect(markdown).toContain('title: "Note: a colon"');
  });
});

describe('the history option', () => {
  /* Two days of real writing, through `revisionFor` — the same call a save makes — so the chain the
     export replays is one a real document could actually have, and the counts in the headings are
     the ones the day card would show rather than numbers invented here.

     Day two is shaped to produce all three labels at once: the first sentence is reworded, a later
     one is cut, and a new one is written, each separated from the next by a sentence that did not
     change — adjacent ones coalesce into a single replacement, which is the point of that pairing
     and not what this test is for. The last sentence is deliberately the same on both days: a
     segment owns its trailing whitespace, so a sentence that is final on one day and mid-text on
     the next is *not* the same segment, and the diff would rightly say so. */
  const DAY_ONE =
    'Walking helps me think. Sleep matters most. I should try cold showers. ' +
    'Mornings are the best time. None of this is settled.';
  const DAY_TWO =
    'Walking helps me think — but only alone. Sleep matters most. ' +
    'Mornings are the best time. Naps help too. None of this is settled.';

  const written = async (title: string, days: readonly string[]) => {
    const doc = await createPluginDocument('notebook', {
      parentId: '',
      title,
      body: days[days.length - 1] ?? '',
      sortKey: 'a0',
    });
    let base = '';
    for (const [index, text] of days.entries()) {
      const { patch, added, removed } = revisionFor(base, text);
      await putDocumentRevision('notebook', doc.id, `2026-08-0${index + 1}`, patch, added, removed);
      base = text;
    }
    return doc;
  };

  it('writes nothing about history unless asked', async () => {
    await written('Walking', [DAY_ONE, DAY_TWO]);
    expect(await buildNotebookMergedMarkdown()).not.toContain('## History');
    // The default is also what an options object that simply omits the key gets.
    expect(await buildNotebookMergedMarkdown({})).not.toContain('## History');
  });

  it('appends a dated heading per day, oldest first, carrying that day’s own +/−', async () => {
    await written('Walking', [DAY_ONE, DAY_TWO]);
    const markdown = await buildNotebookMergedMarkdown({ history: true });

    expect(markdown).toContain('## History');
    // Day one wrote the document from nothing, so it removed nothing and the heading says so by
    // leaving the − side off entirely rather than printing −0.
    expect(markdown).toContain('### 2026-08-01 — +123');
    expect(markdown).not.toContain('−0');
    expect(markdown).toContain('### 2026-08-02 — +56 −51');
    expect(markdown!.indexOf('2026-08-01')).toBeLessThan(markdown!.indexOf('2026-08-02'));
  });

  it('narrates a rewording, a cut and a new sentence as their own labelled changes', async () => {
    await written('Walking', [DAY_ONE, DAY_TWO]);
    const markdown = await buildNotebookMergedMarkdown({ history: true });

    expect(markdown).toContain(
      '- Added: "Walking helps me think. Sleep matters most. I should try cold showers.',
    );
    expect(markdown).toContain(
      '- Replaced: "Walking helps me think." → "Walking helps me think — but only alone."',
    );
    expect(markdown).toContain('- Removed: "I should try cold showers."');
    expect(markdown).toContain('- Added: "Naps help too."');
  });

  it('keeps the history under the document’s own prose, not inside the frontmatter', async () => {
    await written('Walking', [DAY_ONE, DAY_TWO]);
    const markdown = await buildNotebookMergedMarkdown({ history: true });

    const frontmatterEnd = markdown!.indexOf('\n---', 4);
    expect(markdown!.indexOf('## History')).toBeGreaterThan(frontmatterEnd);
    expect(markdown!.indexOf('None of this is settled.')).toBeLessThan(
      markdown!.indexOf('## History'),
    );
  });

  it('leaves out a day that has a row but nothing to narrate', async () => {
    // The same text twice: a day that moved and was put back is a real row recording +0 −0.
    await written('Quiet', ['One thought.', 'One thought.']);
    const markdown = await buildNotebookMergedMarkdown({ history: true });

    expect(markdown).toContain('### 2026-08-01');
    expect(markdown).not.toContain('### 2026-08-02');
    // Still counted as an edit, though — `edits` is every row, narrated or not.
    expect(markdown).toContain('edits: 2');
  });

  it('omits the section entirely for a document never written in', async () => {
    await createPluginDocument('notebook', {
      parentId: '',
      title: 'Untouched',
      body: 'Straight in, never edited.',
      sortKey: 'a0',
    });
    const markdown = await buildNotebookMergedMarkdown({ history: true });

    expect(markdown).toContain('Straight in, never edited.');
    expect(markdown).not.toContain('## History');
  });

  it('reaches the ZIP export too, in the same file as the document it belongs to', async () => {
    await written('Walking', [DAY_ONE, DAY_TWO]);

    const [plain] = await buildNotebookZipEntries();
    expect(plain.content).not.toContain('## History');

    const [withHistory] = await buildNotebookZipEntries({ history: true });
    expect(withHistory.name).toBe('Walking.md');
    expect(withHistory.content).toContain('## History');
    expect(withHistory.content).toContain('### 2026-08-02 — +56 −51');
  });
});

describe('buildNotebookZipEntries', () => {
  it('lays the tree out as real nested folders, a document becoming both its own file and its children’s directory', async () => {
    const parent = await createPluginDocument('notebook', {
      parentId: '',
      title: 'Psychology',
      body: 'overview',
      sortKey: 'a0',
    });
    await createPluginDocument('notebook', {
      parentId: parent.id,
      title: 'Enneagram',
      body: 'notes',
      sortKey: 'a0',
    });

    const files = await buildNotebookZipEntries();
    expect(files.map((f) => f.name).sort()).toEqual(['Psychology.md', 'Psychology/Enneagram.md']);
  });

  it('dedupes same-named siblings per directory rather than globally', async () => {
    const branchA = await createPluginDocument('notebook', {
      parentId: '',
      title: 'Branch A',
      body: '',
      sortKey: 'a0',
    });
    const branchB = await createPluginDocument('notebook', {
      parentId: '',
      title: 'Branch B',
      body: '',
      sortKey: 'a1',
    });
    // One "Notes" under each branch: each should keep the plain name, not collide with the other.
    await createPluginDocument('notebook', {
      parentId: branchA.id,
      title: 'Notes',
      body: '',
      sortKey: 'a0',
    });
    await createPluginDocument('notebook', {
      parentId: branchB.id,
      title: 'Notes',
      body: '',
      sortKey: 'a0',
    });

    const files = await buildNotebookZipEntries();
    expect(files.map((f) => f.name).sort()).toEqual([
      'Branch A.md',
      'Branch A/Notes.md',
      'Branch B.md',
      'Branch B/Notes.md',
    ]);
  });

  it('sanitizes path-hostile characters in a title', async () => {
    await createPluginDocument('notebook', {
      parentId: '',
      title: 'Q&A: what/why?',
      body: '',
      sortKey: 'a0',
    });
    const files = await buildNotebookZipEntries();
    expect(files).toHaveLength(1);
    expect(files[0].name).not.toMatch(/[\\/:*?"<>|]/);
  });
});
