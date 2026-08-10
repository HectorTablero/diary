import { MAX_PLUGIN_RECORDS_PER_PLUGIN, MAX_PLUGINS_PER_USER } from '@diary/shared';
import { model, Schema } from 'mongoose';

/**
 * Every plugin's rows, in one collection.
 *
 * The point of the shared collection is that adding a plugin is a client-only change — no model, no
 * route, no sync wiring, no Dexie version. That only holds if nothing here knows what any
 * particular plugin stores, which is why `data` is Mixed and why the caps in @diary/shared do the
 * job a schema would normally do. See the note above PLUGIN_ID_REGEX for the full reasoning.
 */
const pluginRecordSchema = new Schema(
  {
    userId: { type: String, required: true },
    pluginId: { type: String, required: true },
    scope: { type: String, required: true, enum: ['config', 'record'], default: 'record' },
    /**
     * `YYYY-MM-DD`, or `''` (UNDATED_KEY) when the row isn't about a particular day.
     *
     * **Not `required`, and it must stay that way.** Mongoose's `required` on a String means
     * "present and non-empty" — it rejects `''` as missing. Since the undated sentinel *is* the
     * empty string, `required: true` here 500'd every habit definition and every plugin config row
     * while dated rows saved fine, so the collection worked until the moment a plugin stored
     * anything that wasn't about a day.
     *
     * The value is still guaranteed: `pluginRecordCreateSchema` defaults it and constrains it to a
     * date key or the sentinel before the route is reached, and `default` covers a document
     * constructed without it. Validation belongs at the edge here anyway — the alternative is a
     * second copy of the rule that can disagree with the first.
     *
     * Not indexed on purpose, either: the server only ever filters by updatedAt, so an index here
     * would be pure write amplification. The client indexes it, because the client reads by day.
     */
    dateKey: { type: String, default: '' },
    data: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
  },
  { timestamps: true },
);

/* Serves the sync delta directly: filter by userId, then range-scan updatedAt.
 *
 * This is the one model that indexes updatedAt, and the departure is deliberate. Everywhere else a
 * `{userId}`-prefixed scan with an in-memory date filter is fine, because a diary has a few thousand
 * documents. A day-scoped plugin writes a row per day forever — five years of one plugin is already
 * more rows than most users' entire diary — and the sync poll runs every 60 seconds. Without this,
 * the cheapest thing the app does becomes the most expensive.
 *
 * `pluginId` sits in the middle so the same index also serves the per-plugin count that enforces
 * MAX_PLUGIN_RECORDS_PER_PLUGIN. */
pluginRecordSchema.index({ userId: 1, pluginId: 1, updatedAt: 1 });

/* At most one config row per plugin. Unique rather than merely conventional: the client reads it
   with findOne and would otherwise silently pick whichever of two duplicates sorted first, which is
   a plugin turning itself on and off depending on the query plan. Partial, so it constrains only
   config rows and leaves data rows unbounded in number (up to the cap below). */
pluginRecordSchema.index(
  { userId: 1, pluginId: 1, scope: 1 },
  { unique: true, partialFilterExpression: { scope: 'config' } },
);

export const PluginRecord = model('PluginRecord', pluginRecordSchema);

/**
 * Create the indexes above, out-of-band from the schema declaration.
 *
 * Mongoose's `autoIndex` builds these on first use, which is fine in development and exactly wrong
 * on a running deployment — it is implicit, unordered, and its failures land in a log nobody reads.
 * Calling this from main() makes index creation a startup step that can fail loudly, the same shape
 * as ensureTombstoneTtl. Unlike that one it needs no collMod fallback: neither index carries options
 * that can be retuned in place, so a redefinition would be a new index and should be a new call.
 */
export async function ensurePluginRecordIndexes(): Promise<void> {
  await PluginRecord.syncIndexes();
}

/**
 * Whether this write would push the account past one of its caps.
 *
 * Both caps exist because `pluginId` is deliberately open — requiring a closed enum would put a
 * shared/ change and a server deploy in front of every new plugin, which is the whole thing this
 * collection avoids. Openness without a bound is just an unbounded collection with extra steps.
 *
 * Only checked on create: an update cannot increase either count. Racy under concurrent creates by
 * the same user, which is accepted — the caps are there to stop sprawl, not to be exact, and the
 * cost of being wrong by a few rows is nothing.
 */
export async function pluginCapExceeded(
  userId: string,
  pluginId: string,
): Promise<'plugins' | 'records' | null> {
  const [records, plugins] = await Promise.all([
    PluginRecord.countDocuments({ userId, pluginId }),
    PluginRecord.distinct('pluginId', { userId }),
  ]);
  if (records >= MAX_PLUGIN_RECORDS_PER_PLUGIN) return 'records';
  // Only a *new* plugin id can push this over; rows for one already present are covered above.
  if (!plugins.includes(pluginId) && plugins.length >= MAX_PLUGINS_PER_USER) return 'plugins';
  return null;
}

/**
 * Gauges proving the collection stays bounded, in the same spirit as tombstoneGauges.
 *
 * The caps above are enforced per write, so they cannot be exceeded — but they can be *approached*,
 * and a user sitting near MAX_PLUGIN_RECORDS_PER_PLUGIN is a plugin writing rows it shouldn't,
 * visible here months before it becomes a support question.
 */
export async function pluginRecordGauges(): Promise<Record<string, number>> {
  const [count, busiest] = await Promise.all([
    PluginRecord.estimatedDocumentCount(),
    PluginRecord.aggregate<{ rows: number }>([
      { $group: { _id: { userId: '$userId', pluginId: '$pluginId' }, rows: { $sum: 1 } } },
      { $sort: { rows: -1 } },
      { $limit: 1 },
    ]),
  ]);
  return {
    plugin_records: count,
    ...(busiest[0] ? { plugin_records_busiest: busiest[0].rows } : {}),
  };
}
