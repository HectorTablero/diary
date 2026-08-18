import {
  newObjectId,
  NO_PARENT_KEY,
  UNDATED_KEY,
  type PluginDocumentDto,
  type PluginDocumentUpdateInput,
} from '@diary/shared';
import { db } from './db';
import { enqueue, enqueueBatch } from './outbox';

/**
 * Read and write helpers for the plugin-document table.
 *
 * The sibling of `pluginRecords.ts`, and the same contract: a plugin importing this is importing the
 * data half of the plugin API rather than reaching into the app's internals. The write path is
 * Dexie first, then the outbox, so documents are offline-first and carried by exactly the machinery
 * that carries entries.
 *
 * One rule runs through all of it: **no read may be proportional to the notebook's history.** A
 * document body can be a quarter of a megabyte and revisions accumulate forever, so every function
 * here goes through one of the three compound indexes declared in db.ts, and the ones that return
 * documents are scoped to a parent rather than fetching the tree. The two places that genuinely need
 * every document say so in their names.
 */

const PATH = '/plugin-documents';

const nowIso = () => new Date().toISOString();

/** The upper bound for a `[... + dateKey]` range that should reach every real date. */
const DATE_KEY_MAX = '￿';

/* --- Reads ------------------------------------------------------------------------------------ */

export const getPluginDocument = (id: string): Promise<PluginDocumentDto | undefined> =>
  db.pluginDocuments.get(id);

/** One document's children, in sibling order. The tree is read a level at a time, by design. */
export const getChildDocuments = async (
  pluginId: string,
  parentId: string,
): Promise<PluginDocumentDto[]> => {
  const rows = await db.pluginDocuments
    .where('[pluginId+dateKey+parentId]')
    .equals([pluginId, UNDATED_KEY, parentId])
    .toArray();
  return rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
};

/**
 * Every document this plugin owns — never its revisions.
 *
 * Two callers only: the "move to…" picker, which has to show the whole tree to be a picker at all,
 * and the export, which is writing all of it out anyway. Both are deliberate, user-initiated, and
 * one-shot; nothing on a render path may call this.
 */
export const getAllPluginDocuments = (pluginId: string): Promise<PluginDocumentDto[]> =>
  db.pluginDocuments.where('[pluginId+dateKey]').equals([pluginId, UNDATED_KEY]).toArray();

/** One document's revisions, oldest first — the patch chain, in the order it must be replayed. */
export const getDocumentRevisions = async (documentId: string): Promise<PluginDocumentDto[]> => {
  const rows = await db.pluginDocuments
    .where('[documentId+dateKey]')
    .between([documentId, UNDATED_KEY], [documentId, DATE_KEY_MAX], false, true)
    .toArray();
  /* Sorted explicitly rather than trusting the index. Two revisions can share a dateKey for as long
     as it takes a same-day collision to converge (see the unique index in models/pluginDocument),
     and replaying them in an unstable order would reconstruct a day that never existed. `createdAt`
     breaks the tie the way the server eventually will. */
  return rows.sort(
    (a, b) => a.dateKey.localeCompare(b.dateKey) || a.createdAt.localeCompare(b.createdAt),
  );
};

/** Every revision written on one day, across all of a plugin's documents. */
export const getRevisionsForDay = (
  pluginId: string,
  dateKey: string,
): Promise<PluginDocumentDto[]> =>
  db.pluginDocuments.where('[pluginId+dateKey]').equals([pluginId, dateKey]).toArray();

/** Every revision in a date range — the calendar month, in one indexed scan. */
export const getRevisionsInRange = (
  pluginId: string,
  fromDateKey: string,
  toDateKey: string,
): Promise<PluginDocumentDto[]> =>
  db.pluginDocuments
    .where('[pluginId+dateKey]')
    .between([pluginId, fromDateKey], [pluginId, toDateKey], true, true)
    .toArray();

/** The revision a document already has for a day, if any. The upsert key. */
export const getDocumentRevision = (
  documentId: string,
  dateKey: string,
): Promise<PluginDocumentDto | undefined> =>
  db.pluginDocuments.where('[documentId+dateKey]').equals([documentId, dateKey]).first();

export const countPluginDocuments = (pluginId: string): Promise<number> =>
  db.pluginDocuments.where('pluginId').equals(pluginId).count();

/* --- Writes ----------------------------------------------------------------------------------- */

const newRow = (
  pluginId: string,
  fields: Partial<PluginDocumentDto> & { pluginId?: never },
): PluginDocumentDto => {
  const at = nowIso();
  return {
    id: newObjectId(),
    pluginId,
    dateKey: UNDATED_KEY,
    documentId: NO_PARENT_KEY,
    parentId: NO_PARENT_KEY,
    title: '',
    body: '',
    sortKey: '',
    added: 0,
    removed: 0,
    createdAt: at,
    updatedAt: at,
    ...fields,
  };
};

/* Every create sends the row's whole shape, not just the fields that differ from the defaults.
   The server defaults the rest, but a row round-tripping through a *reset* pull is compared against
   what is stored, and a field the client omitted comes back as the server's default rather than the
   client's — which for `sortKey` would silently reorder siblings on the next sync. */
const createBody = (row: PluginDocumentDto) => ({
  id: row.id,
  createdAt: row.createdAt,
  pluginId: row.pluginId,
  dateKey: row.dateKey,
  documentId: row.documentId,
  parentId: row.parentId,
  title: row.title,
  body: row.body,
  sortKey: row.sortKey,
  added: row.added,
  removed: row.removed,
});

/** Create a document (never a revision — those go through putDocumentRevision). */
export async function createPluginDocument(
  pluginId: string,
  fields: { parentId: string; title: string; body: string; sortKey: string },
): Promise<PluginDocumentDto> {
  const row = newRow(pluginId, { ...fields, dateKey: UNDATED_KEY, documentId: NO_PARENT_KEY });
  await db.pluginDocuments.add(row);
  await enqueue('POST', PATH, createBody(row));
  return row;
}

/** Change a document's title, body, parent or sibling order. */
export async function updatePluginDocument(
  id: string,
  patch: PluginDocumentUpdateInput,
): Promise<void> {
  const existing = await db.pluginDocuments.get(id);
  if (!existing) return;
  await db.pluginDocuments.put({ ...existing, ...patch, updatedAt: nowIso() });
  await enqueue('PATCH', `${PATH}/${id}`, patch);
}

/**
 * Record what a document looked like at the end of one day.
 *
 * Upsert on `(documentId, dateKey)`, which is the same pair the server holds unique: today's
 * revision is rewritten as the day goes on, and every earlier one is immutable. That split is the
 * whole reason a document survives being edited on two devices — see the block comment above
 * MAX_PLUGIN_DOCUMENT_BYTES in @diary/shared.
 */
export async function putDocumentRevision(
  pluginId: string,
  documentId: string,
  dateKey: string,
  patch: string,
  added: number,
  removed: number,
): Promise<PluginDocumentDto> {
  const existing = await getDocumentRevision(documentId, dateKey);
  if (existing) {
    const updated = { ...existing, body: patch, added, removed, updatedAt: nowIso() };
    await db.pluginDocuments.put(updated);
    await enqueue('PATCH', `${PATH}/${existing.id}`, { body: patch, added, removed });
    return updated;
  }
  const row = newRow(pluginId, { dateKey, documentId, body: patch, added, removed });
  await db.pluginDocuments.add(row);
  await enqueue('POST', PATH, createBody(row));
  return row;
}

/**
 * Everything one delete removed, kept whole so it can be put back.
 *
 * The rows themselves rather than their ids, because there is nothing left to look them up in once
 * the delete has run — and unlike an entry or a tag, a document is prose that exists nowhere else.
 */
export interface PluginDocumentDeletion {
  kind: 'pluginDocument';
  rows: PluginDocumentDto[];
}

/**
 * Delete rows — a document with its whole subtree and every revision of every part of it.
 *
 * Batched into one enqueue, because deleting a folder of forty thoughts is one action and must cost
 * one sync kick rather than forty. The caller assembles the id list: it is the only side that knows
 * the tree, which is the same reason the route doesn't cascade.
 */
export async function deletePluginDocuments(ids: string[]): Promise<PluginDocumentDeletion> {
  if (!ids.length) return { kind: 'pluginDocument', rows: [] };
  // Read before deleting: this is the only copy of what is about to go.
  const rows = (await db.pluginDocuments.bulkGet(ids)).filter((row) => row !== undefined);
  await db.pluginDocuments.bulkDelete(ids);
  await enqueueBatch(ids.map((id) => ({ method: 'DELETE' as const, path: `${PATH}/${id}` })));
  return { kind: 'pluginDocument', rows };
}

/**
 * Put a deleted document (and its subtree, and all of their history) back exactly as it was.
 *
 * Under their original ids, which is what makes this a restore rather than a copy: `parentId` and
 * `documentId` point at those ids from every other row in the set, so a new id anywhere would
 * restore the notebook as unparented documents with no history attached. Re-creating a deleted id
 * also retracts its tombstone on the server (`clearDeletions` in routes/pluginDocuments), so the
 * next pull doesn't delete it a second time.
 */
export async function restorePluginDocuments(deletion: PluginDocumentDeletion): Promise<void> {
  if (!deletion.rows.length) return;
  await db.pluginDocuments.bulkPut(deletion.rows);
  await enqueueBatch(
    deletion.rows.map((row) => ({ method: 'POST' as const, path: PATH, body: createBody(row) })),
  );
}
