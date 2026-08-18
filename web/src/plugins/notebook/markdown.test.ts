import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { createPluginDocument, putDocumentRevision } from '@/db/pluginDocuments';
import i18n from '@/i18n';
import en from './locales/en.json';
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
