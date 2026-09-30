import { UNDATED_KEY, type PluginRecordDto } from '@diary/shared';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { iconNameSchema } from '@/components/icons/iconName';
import {
  createPluginRecord,
  deletePluginRecords,
  getUndatedRecords,
  updatePluginRecord,
} from '@/db/pluginRecords';
import { onSyncApplied } from '@/db/sync';
import { NOTEBOOK_PLUGIN_ID as PLUGIN_ID } from './model';

/**
 * A document's icon, kept beside the document rather than on it.
 *
 * Documents live in `pluginDocument`, whose fields are fixed on the server on purpose (see the
 * comment atop server/src/models/pluginDocument.ts) — adding one means a schema change in shared,
 * the server and the sync path. `pluginRecord` is the opposite: its `data` is opaque, which is what
 * makes "a plugin adds a field" a client-only change. So an icon is an undated record of its own,
 * `{ kind: 'icon', documentId, icon }`, and no icon is no row.
 *
 * One row per document rather than one map of all of them: last-write-wins is per row, so two
 * devices giving two *different* documents an icon while offline must be two writes that cannot
 * collide. Two devices iconing the *same* document can still each create a row; the newest wins
 * when reading, and the next write to that document tidies up the other (see `setDocumentIcon`).
 *
 * A document's icon goes when the document does, and comes back with it on Undo — it rides along in
 * the deletion (`PluginDocumentDeletion.records`).
 */

const iconRowSchema = z.object({
  kind: z.literal('icon'),
  documentId: z.string().min(1),
  icon: iconNameSchema,
});

interface IconRow {
  row: PluginRecordDto;
  icon: string;
}

/** Every icon row, grouped by document, newest first. */
function groupIconRows(rows: readonly PluginRecordDto[]): Map<string, IconRow[]> {
  const byDocument = new Map<string, IconRow[]>();
  for (const row of rows) {
    const parsed = iconRowSchema.safeParse(row.data);
    if (!parsed.success) continue;
    const list = byDocument.get(parsed.data.documentId) ?? [];
    list.push({ row, icon: parsed.data.icon });
    byDocument.set(parsed.data.documentId, list);
  }
  for (const list of byDocument.values()) {
    list.sort((a, b) => b.row.updatedAt.localeCompare(a.row.updatedAt));
  }
  return byDocument;
}

/** documentId → icon name, the newest row winning. Pure, for the tests. */
export function resolveDocumentIcons(rows: readonly PluginRecordDto[]): Map<string, string> {
  return new Map([...groupIconRows(rows)].map(([documentId, list]) => [documentId, list[0].icon]));
}

const readGroups = async () => groupIconRows(await getUndatedRecords(PLUGIN_ID));

/* --- Change notifications ----------------------------------------------------------------------
   The same pairing the other plugins use: `onSyncApplied` for another device's writes, and this for
   this device's own, so the header and the list beneath it move together. */

const listeners = new Set<() => void>();
const announce = () => {
  for (const listener of listeners) listener();
};

/* --- Writes ------------------------------------------------------------------------------------ */

/** Give a document an icon, or take it away with `null`. */
export async function setDocumentIcon(documentId: string, icon: string | null): Promise<void> {
  const rows = (await readGroups()).get(documentId) ?? [];
  const [newest, ...stale] = rows;
  if (icon === null) {
    await deletePluginRecords(rows.map(({ row }) => row.id));
  } else {
    const data = { kind: 'icon' as const, documentId, icon };
    if (newest) await updatePluginRecord(newest.row.id, data);
    else await createPluginRecord(PLUGIN_ID, 'record', UNDATED_KEY, data);
    await deletePluginRecords(stale.map(({ row }) => row.id));
  }
  announce();
}

/** Delete the icons of these documents, returning the rows so an Undo can restore them. */
export async function deleteDocumentIcons(
  documentIds: ReadonlySet<string>,
): Promise<PluginRecordDto[]> {
  const groups = await readGroups();
  const ids = [...documentIds].flatMap((id) => (groups.get(id) ?? []).map(({ row }) => row.id));
  const deleted = await deletePluginRecords(ids);
  if (deleted.length) announce();
  return deleted;
}

export async function hasDocumentIcon(documentId: string): Promise<boolean> {
  return (await readGroups()).has(documentId);
}

/* --- Reads ------------------------------------------------------------------------------------- */

/**
 * Every document's icon. One read of the plugin's undated rows, which hold nothing *but* icons (the
 * config row is scoped apart), so this is proportional to how many documents have one — not to the
 * notebook.
 */
export function useDocumentIcons(): ReadonlyMap<string, string> {
  const [icons, setIcons] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void getUndatedRecords(PLUGIN_ID).then((rows) => {
        if (!cancelled) setIcons(resolveDocumentIcons(rows));
      });
    load();
    listeners.add(load);
    const unsubscribe = onSyncApplied(load);
    return () => {
      cancelled = true;
      listeners.delete(load);
      unsubscribe();
    };
  }, []);
  return icons;
}

/** A row's icon, for the backup import review. */
export function parseIconRecord(
  record: PluginRecordDto,
): { documentId: string; icon: string } | undefined {
  const parsed = iconRowSchema.safeParse(record.data);
  return parsed.success ? parsed.data : undefined;
}
