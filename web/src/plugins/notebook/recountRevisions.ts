/**
 * OBSOLETE — one-off repair shipped in v9.8.4. Remove this file, and its call in main.tsx, from
 * v9.8.5 onwards: every account will have run it by then.
 *
 * Recomputes the `added`/`removed` counts on every notebook revision already stored. Before v9.8.4,
 * `revisionFor` counted whole segments, so appending a line after the last one, or carrying on an
 * unfinished sentence, recorded the untouched sentence as removed and rewritten — a `−n` on days
 * nothing was cut. The fix only affects new saves; this corrects the rows written before it.
 *
 * Only the counts change. Patches are left exactly as stored (some are still the line format, see
 * patch.ts), and each revision is re-counted between the texts its own chain replays to, which is
 * what `revisionFor` saw when the row was saved.
 */
import { UNDATED_KEY, type PluginDocumentDto } from '@diary/shared';
import { db, getMeta, setMeta } from '@/db/db';
import { enqueueBatch } from '@/db/outbox';
import { getSyncStatus, subscribeSyncStatus } from '@/db/sync';
import { captureError } from '@/lib/telemetry';
import { revisionFor } from './history';
import { NOTEBOOK_PLUGIN_ID } from './model';
import { applyPatch, decodePatch } from './patch';

const DONE_KEY = 'notebookRevisionCountsV984';

export async function recountRevisions(): Promise<void> {
  if (await getMeta<boolean>(DONE_KEY)) return;

  const fixed = await db.transaction('rw', db.pluginDocuments, async () => {
    const rows = await db.pluginDocuments.where('pluginId').equals(NOTEBOOK_PLUGIN_ID).toArray();
    const chains = new Map<string, PluginDocumentDto[]>();
    for (const row of rows) {
      if (row.dateKey === UNDATED_KEY) continue;
      const chain = chains.get(row.documentId) ?? [];
      chain.push(row);
      chains.set(row.documentId, chain);
    }

    const out: { id: string; added: number; removed: number }[] = [];
    for (const chain of chains.values()) {
      // Same order as getDocumentRevisions, which is the order the chain replays in.
      chain.sort(
        (a, b) => a.dateKey.localeCompare(b.dateKey) || a.createdAt.localeCompare(b.createdAt),
      );
      let text = '';
      for (const revision of chain) {
        const next = applyPatch(text, decodePatch(revision.body));
        const { added, removed } = revisionFor(text, next);
        if (added !== revision.added || removed !== revision.removed) {
          out.push({ id: revision.id, added, removed });
        }
        text = next;
      }
    }

    const at = new Date().toISOString();
    for (const { id, added, removed } of out) {
      await db.pluginDocuments.update(id, { added, removed, updatedAt: at });
    }
    return out;
  });

  // Counts only, never `body`: a body PATCH is a conditional write, and there is nothing to merge.
  await enqueueBatch(
    fixed.map(({ id, added, removed }) => ({
      method: 'PATCH' as const,
      path: `/plugin-documents/${id}`,
      body: { added, removed },
    })),
  );
  await setMeta(DONE_KEY, true);
}

/**
 * Run the recount once, after this session's first successful sync — so a device that has just
 * signed in has pulled its revisions before they are counted, rather than marking an empty table
 * as done.
 */
export function initRevisionRecount(): void {
  let started = false;
  const check = () => {
    if (started || !getSyncStatus().lastSyncAt) return;
    started = true;
    unsubscribe();
    recountRevisions().catch((err: unknown) =>
      captureError(err, { scope: 'notebook.recountRevisions' }),
    );
  };
  const unsubscribe = subscribeSyncStatus(check);
  check();
}
