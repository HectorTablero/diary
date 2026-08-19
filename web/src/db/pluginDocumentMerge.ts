import { UNDATED_KEY, type PluginDocumentDto } from '@diary/shared';
import { merge3 } from '@/lib/textMerge';
import { db } from './db';

/**
 * How a plugin document survives being written on two devices at once.
 *
 * ## The problem
 *
 * Every other collection in this app is a handful of small fields, and a pull that overwrites the
 * local row with the server's is right: the newer answer to "what is this person's phone number" is
 * the answer. A document is a page of prose in *one* field, so the same rule reads as "whichever
 * device synced last is the one that wrote today", and the other version is gone — with nothing
 * anywhere recording that it existed. The bug was never that the app picked a winner. It was that
 * there was a race to lose at all.
 *
 * ## The three pieces
 *
 * 1. **A merge base.** `db.pluginDocumentBases` holds the text as the server last had it, captured
 *    the moment a clean document is first edited here. That is the common ancestor a three-way
 *    merge needs to tell "I added this" from "you deleted that" — see `merge3`.
 * 2. **A conditional write.** A body PATCH carries the server version it was made against
 *    (`baseVersion` in the shared update schema), so a write built on a version the server has
 *    already moved past is *refused* rather than applied. Without this the merge would be closing
 *    the stable door: the clobbering happens on push, before any pull can notice.
 * 3. **This file**, which runs on the way back in: merge, keep the result, and hand the caller a
 *    write to send.
 *
 * Together they are `git` in miniature — a push that isn't a fast-forward is rejected, you fetch,
 * you merge, you push again — and like it, the loop terminates when the typing stops.
 *
 * ## Why it is its own module
 *
 * Because `db/sync.ts` has to call it, and `db/pluginDocuments.ts` cannot be what it calls: that
 * file writes through `db/outbox.ts`, which reaches i18n and back into `sync.ts`, and the import
 * cycle broke module initialisation outright. Everything here is deliberately a leaf — Dexie and
 * the merge, nothing else — and enqueuing the writes it produces is left to the caller.
 */

/** A body this device merged, which the server therefore hasn't got yet. */
export interface MergedDocumentWrite {
  id: string;
  body: string;
}

export interface PluginDocumentReconcile {
  /** What to write locally: the server's rows, except where a merge replaced a body. */
  rows: PluginDocumentDto[];
  /** Body writes to queue once the pull's transaction has committed. */
  writes: MergedDocumentWrite[];
  /** Places a merge had to keep both versions, across every row in this pull. */
  conflicts: number;
}

/**
 * Note what the server had, the first time this device changes a document.
 *
 * It has to be taken *before* the local write, because afterwards the row holds this device's text
 * under this device's clock and the ancestor is gone. Only the first write since the last sync
 * captures anything: every keystroke after that is further work on the same base, and re-capturing
 * would quietly walk the ancestor forward onto our own edits — which is last-write-wins again,
 * arrived at by a longer road.
 */
export async function rememberDocumentBase(existing: {
  id: string;
  body: string;
  updatedAt: string;
}): Promise<void> {
  if (await db.pluginDocumentBases.get(existing.id)) return;
  await db.pluginDocumentBases.put({
    id: existing.id,
    text: existing.body,
    version: existing.updatedAt,
  });
}

/**
 * The precondition to attach to a body write, read at the moment it is sent.
 *
 * Deliberately not baked into the queued op. A writing session queues a PATCH every time typing
 * settles, and every one of them would have carried the version from before the *first* of them —
 * so the first would land, the server would move on, and every one after it would be refused by the
 * very guard meant to protect them. Read here instead, the version is always the newest one this
 * device has been told about, whether that came from a pull or from the previous write's own reply.
 *
 * `undefined` when there is no base — nothing local is in flight for this document, so there is
 * nothing for a precondition to protect and an unconditional write is the honest one.
 */
export async function documentWritePrecondition(id: string): Promise<string | undefined> {
  return (await db.pluginDocumentBases.get(id))?.version;
}

/**
 * Our own body write landed: the server now holds this text, so the ancestor moves onto it.
 *
 * The mirror of the rule in `rememberDocumentBase`, and not a contradiction of it. Moving the base
 * onto local text that has merely been *typed* would erase the evidence of what the other device
 * started from; moving it onto text the server has *acknowledged* is the ancestor genuinely
 * advancing — it is what `git` does to a remote-tracking ref on a successful push, and it is what
 * keeps the next write's precondition matchable.
 */
export async function documentBasePushed(id: string, body: string, version: string): Promise<void> {
  await db.pluginDocumentBases.put({ id, text: body, version });
}

/**
 * Drop merge bases for documents that no longer exist, or that the server has never seen.
 *
 * Both cases are a delete or a restore. A base outlives its document unless it is dropped, and undo
 * re-creates a document under its original id — so a stale one would have the next sync merge the
 * restored text against an ancestor from before the delete.
 */
export const forgetDocumentBases = (ids: string[]): Promise<void> =>
  ids.length ? db.pluginDocumentBases.bulkDelete(ids) : Promise.resolve();

/**
 * Decide what an incoming pull actually means for each document, instead of overwriting.
 *
 * Returns the rows to write and the writes to send; performs neither. The rows go into the pull's
 * own `bulkPut`, and the writes have to wait for its transaction to commit — enqueuing kicks a sync
 * and re-reconciles notifications, both of which touch tables the pull never joined and Dexie would
 * therefore refuse.
 *
 * ## What it leaves alone
 *
 * Revisions (`dateKey` non-empty) go straight through. Each is one immutable day, kept unique per
 * document per day by the server, and its body is an encoded patch rather than prose — merging two
 * encodings of a diff would produce neither one. A document whose body a merge moved has a chain
 * that no longer reconstructs it exactly, which this plugin already expects and heals from on the
 * next save: see the note on `replay` in plugins/notebook/history.ts.
 *
 * Runs inside the pull's transaction (which must therefore include `pluginDocumentBases`), so the
 * base a merge reads cannot be one a keystroke moved halfway through the pass.
 */
export async function reconcilePluginDocuments(
  serverRows: PluginDocumentDto[],
): Promise<PluginDocumentReconcile> {
  const result: PluginDocumentReconcile = { rows: [], writes: [], conflicts: 0 };

  for (const row of serverRows) {
    /* A revision, or a document this device has no unsynced edits to: nothing to protect, so the
       server's row is simply the truth. This is the overwhelming majority of every pull, and it
       costs one keyed `get` against a table that is empty on most devices most of the time. */
    const base = row.dateKey === UNDATED_KEY ? await db.pluginDocumentBases.get(row.id) : undefined;
    const local = base ? await db.pluginDocuments.get(row.id) : undefined;
    if (!base || !local) {
      // A base with no row behind it is left over from a document deleted since; it has nothing
      // left to protect and would otherwise sit here for good.
      if (base) await db.pluginDocumentBases.delete(row.id);
      result.rows.push(row);
      continue;
    }

    const merged = merge3(base.text, local.body, row.body);
    result.conflicts += merged.conflicts;

    /* The merge came out as exactly what the server already has — either it had our text all along,
       or we never really diverged. Nothing to push, the two sides are in step, and the base has
       done its job. */
    if (merged.text === row.body) {
      result.rows.push(row);
      await db.pluginDocumentBases.delete(row.id);
      continue;
    }

    /* Everything from the server *except* the text, which is ours-and-theirs now. `updatedAt` goes
       local because the row no longer matches what the server holds; the write below is what fixes
       that, and the version it carries is the server's, not this one. */
    result.rows.push({ ...row, body: merged.text, updatedAt: new Date().toISOString() });
    await db.pluginDocumentBases.put({ id: row.id, text: row.body, version: row.updatedAt });
    result.writes.push({ id: row.id, body: merged.text });
  }

  return result;
}
