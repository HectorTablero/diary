import { newObjectId, UNDATED_KEY, type PluginRecordDto, type PluginScope } from '@diary/shared';
import { db } from './db';
import { enqueue, enqueueBatch } from './outbox';

/**
 * Read and write helpers for the shared plugin-record table.
 *
 * Its own module rather than more of `db/mutations.ts`, which is where every other write lives. Two
 * reasons: mutations.ts is organised one section per collection and each section knows the shape it
 * writes, while nothing here is allowed to know what a plugin stores; and this file *is* the data
 * half of the plugin API, so a plugin importing it is importing its contract rather than reaching
 * into the app's internals.
 *
 * The write path is the same as everywhere else — Dexie first, then the outbox — so plugin data is
 * offline-first and conflict-resolved by exactly the machinery that carries entries.
 */

const PATH = '/plugin-records';

const nowIso = () => new Date().toISOString();

/** A record's payload, as the owning plugin should treat it: opaque until it parses it itself. */
export type PluginData = Record<string, unknown>;

function newRecord(
  pluginId: string,
  scope: PluginScope,
  dateKey: string,
  data: PluginData,
): PluginRecordDto {
  const at = nowIso();
  return { id: newObjectId(), pluginId, scope, dateKey, data, createdAt: at, updatedAt: at };
}

/* --- Reads -------------------------------------------------------------------------------------
   Straight off the indexes declared in db.ts. Each of these exists because it is the query one of
   the three indexes was added for; adding a read that can't use one of them is a sign the index set
   needs revisiting rather than a reason to scan. */

/** Every plugin's config row in one read — the query the boot path makes. */
export const getAllPluginConfigs = (): Promise<PluginRecordDto[]> =>
  db.pluginRecords.where('scope').equals('config').toArray();

export const getPluginConfig = (pluginId: string): Promise<PluginRecordDto | undefined> =>
  db.pluginRecords.where('[pluginId+scope]').equals([pluginId, 'config']).first();

/** A plugin's row for one day, if it has written one. */
export const getDayRecord = (
  pluginId: string,
  dateKey: string,
): Promise<PluginRecordDto | undefined> =>
  db.pluginRecords.where('[pluginId+dateKey]').equals([pluginId, dateKey]).first();

/** A plugin's rows across a date range, oldest first. Undated rows sort before all of them, so the
    range is left-bounded by a real date rather than by UNDATED_KEY. */
export const getDayRecords = (
  pluginId: string,
  fromDateKey: string,
  toDateKey: string,
): Promise<PluginRecordDto[]> =>
  db.pluginRecords
    .where('[pluginId+dateKey]')
    .between([pluginId, fromDateKey], [pluginId, toDateKey], true, true)
    .toArray();

/** A plugin's undated data rows — habit definitions and the like. Deliberately not the config row:
    that is the app's, not the plugin's, and it is read through getPluginConfig. */
export const getUndatedRecords = async (pluginId: string): Promise<PluginRecordDto[]> => {
  const rows = await db.pluginRecords
    .where('[pluginId+scope]')
    .equals([pluginId, 'record'])
    .toArray();
  return rows.filter((row) => row.dateKey === UNDATED_KEY);
};

export const countPluginRecords = (pluginId: string): Promise<number> =>
  db.pluginRecords.where('pluginId').equals(pluginId).count();

/* --- Writes ------------------------------------------------------------------------------------ */

/** Create a row unconditionally. For collections a plugin keeps several of — habit definitions,
    say — where the identity is the row's own id rather than its day. */
export async function createPluginRecord(
  pluginId: string,
  scope: PluginScope,
  dateKey: string,
  data: PluginData,
): Promise<PluginRecordDto> {
  const record = newRecord(pluginId, scope, dateKey, data);
  await db.pluginRecords.add(record);
  await enqueue('POST', PATH, {
    id: record.id,
    createdAt: record.createdAt,
    pluginId,
    scope,
    dateKey,
    data,
  });
  return record;
}

/** Replace one known row's payload. */
export async function updatePluginRecord(id: string, data: PluginData): Promise<void> {
  const existing = await db.pluginRecords.get(id);
  if (!existing) return;
  await db.pluginRecords.put({ ...existing, data, updatedAt: nowIso() });
  await enqueue('PATCH', `${PATH}/${id}`, { data });
}

/**
 * Create a row, or replace the `data` of one that already exists.
 *
 * Upsert rather than separate create/update calls because that is what a day-scoped caller actually
 * wants — "this plugin's state for this day is now X" — and because getting it wrong the other way
 * (creating a second row for a day that already had one) is invisible locally and only surfaces as
 * a duplicate after a sync.
 *
 * It therefore treats `(pluginId, dateKey)` as unique, which is true for dated rows and *not* true
 * for undated ones: a plugin may keep any number of those. Calling it with UNDATED_KEY would find
 * whichever the index returned first and overwrite it, so that combination throws rather than
 * quietly destroying a row. Use createPluginRecord / updatePluginRecord there.
 */
export async function putPluginRecord(
  pluginId: string,
  scope: PluginScope,
  dateKey: string,
  data: PluginData,
): Promise<PluginRecordDto> {
  if (scope === 'record' && dateKey === UNDATED_KEY) {
    throw new Error(
      'putPluginRecord: undated record rows are not unique per plugin — ' +
        'use createPluginRecord or updatePluginRecord',
    );
  }

  const existing =
    scope === 'config'
      ? await getPluginConfig(pluginId)
      : await getDayRecord(pluginId, dateKey).then((row) =>
          row?.scope === 'record' ? row : undefined,
        );

  if (existing) {
    const updated = { ...existing, data, updatedAt: nowIso() };
    await db.pluginRecords.put(updated);
    await enqueue('PATCH', `${PATH}/${existing.id}`, { data });
    return updated;
  }

  const record = newRecord(pluginId, scope, dateKey, data);
  await db.pluginRecords.add(record);
  await enqueue('POST', PATH, {
    id: record.id,
    createdAt: record.createdAt,
    pluginId,
    scope,
    dateKey,
    data,
  });
  return record;
}

/** Write several rows in one go — one sync kick and one notification reconcile instead of N.
    A day widget with several toggles must use this: see the note above enqueueBatch. */
export async function putPluginRecords(
  rows: { pluginId: string; scope: PluginScope; dateKey: string; data: PluginData }[],
): Promise<void> {
  if (!rows.length) return;
  const ops: Parameters<typeof enqueueBatch>[0] = [];
  const puts: PluginRecordDto[] = [];

  for (const row of rows) {
    const existing =
      row.scope === 'config'
        ? await getPluginConfig(row.pluginId)
        : await getDayRecord(row.pluginId, row.dateKey);
    if (existing) {
      puts.push({ ...existing, data: row.data, updatedAt: nowIso() });
      ops.push({ method: 'PATCH', path: `${PATH}/${existing.id}`, body: { data: row.data } });
      continue;
    }
    const record = newRecord(row.pluginId, row.scope, row.dateKey, row.data);
    puts.push(record);
    ops.push({
      method: 'POST',
      path: PATH,
      body: {
        id: record.id,
        createdAt: record.createdAt,
        pluginId: row.pluginId,
        scope: row.scope,
        dateKey: row.dateKey,
        data: row.data,
      },
    });
  }

  await db.pluginRecords.bulkPut(puts);
  await enqueueBatch(ops);
}

export async function deletePluginRecord(id: string): Promise<void> {
  await db.pluginRecords.delete(id);
  await enqueue('DELETE', `${PATH}/${id}`);
}
