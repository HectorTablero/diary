import type { EntryDto, PersonDto, SettingsDto, TagDto, ThreadDto } from '@diary/shared';
import { DEFAULT_SETTINGS } from '@diary/shared';
import { generateNKeysBetween } from 'fractional-indexing';
import {
  bumpLookupVersion,
  db,
  entryFromDto,
  personFromDto,
  setMeta,
  type OutboxOp,
} from '@/db/db';
import { queryClient } from '@/lib/queryClient';

/* Putting data into the real local store, so component tests read it back through the real repo.
 *
 * Not a mock of `@/db/repo` or `@/api/hooks`. Those are where the interesting logic lives —
 * the join maps, the tree building, the talking-point scoring, the order-key healing — and a test
 * that stubs them asserts that a component renders whatever it was handed, which is a fact about
 * the test. fake-indexeddb makes the genuine article cheap enough to use instead; `setup.ts`
 * installs it globally and resets it between tests.
 *
 * Imports `@/db/db` only, never `@/db/outbox` — that reaches the notification reconciler and the
 * sync engine, neither of which a fixture has any business starting. */

/**
 * Empty every table and invalidate the read layer's caches.
 *
 * The `bumpLookupVersion()` is not tidiness. repo.ts caches tags, people and threads as id→doc maps
 * keyed on that counter and nothing else invalidates them, so without this the second test in a file
 * joins its entries against the first test's people — producing names that were never seeded and a
 * failure that looks like a component bug.
 */
export async function resetDb(): Promise<void> {
  if (!db.isOpen()) await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  bumpLookupVersion();
  queryClient.clear();
}

/** Groups siblings the way ordering actually works: per parent, and per day for roots. */
const siblingGroup = (entry: EntryDto): string => entry.parentId ?? `root:${entry.dateKey}`;

/**
 * Give every unkeyed entry a real fractional index, in the order it was passed.
 *
 * Required, not cosmetic. `repo.ts`'s `ensureOrderKeys` treats a missing `orderKey` as legacy data
 * and heals it on read — which writes to Dexie *and* calls `enqueueBatch`, adding a PATCH per row
 * to the outbox and kicking the sync engine. A test asserting "saving this entry queued exactly one
 * POST" would find several ops it never caused, from a code path it was not testing.
 *
 * Roots are grouped by day as well as by parent, which `ensureOrderKeys` deliberately does not do
 * (it is only ever handed one day at a time). Seeding several days at once would otherwise key every
 * root in the fixture into a single run, and days would interleave.
 */
function withOrderKeys(entries: EntryDto[]): EntryDto[] {
  const groups = new Map<string, EntryDto[]>();
  for (const entry of entries) {
    const key = siblingGroup(entry);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  for (const group of groups.values()) {
    const unkeyed = group.filter((e) => !e.orderKey);
    if (!unkeyed.length) continue;
    const highest = group.reduce<string | null>(
      (max, e) => (e.orderKey && (!max || e.orderKey > max) ? e.orderKey : max),
      null,
    );
    const keys = generateNKeysBetween(highest, null, unkeyed.length);
    unkeyed.forEach((entry, i) => {
      entry.orderKey = keys[i];
    });
  }
  return entries;
}

export interface SeedData {
  entries?: EntryDto[];
  people?: PersonDto[];
  tags?: TagDto[];
  threads?: ThreadDto[];
  settings?: Partial<SettingsDto>;
  /** Pre-existing queued ops, for a test about the sync pill or a backlog. */
  outbox?: OutboxOp[];
}

export async function seed(data: SeedData): Promise<void> {
  await db.tags.bulkPut(data.tags ?? []);
  await db.threads.bulkPut(data.threads ?? []);
  await db.people.bulkPut((data.people ?? []).map(personFromDto));
  await db.entries.bulkPut(withOrderKeys(data.entries ?? []).map(entryFromDto));
  if (data.outbox?.length) await db.outbox.bulkAdd(data.outbox);
  // After the three lookup tables, before anything reads. See resetDb.
  bumpLookupVersion();
  await seedSettings(data.settings ?? {});
}

/**
 * Settings, written to both places that read them.
 *
 * Dexie's `meta` row is what `repo.getSettings()` returns. The query cache is what `lib/notify.ts`
 * consults synchronously to decide whether a routine success toast is suppressed — it reads the
 * module singleton directly rather than through a hook, because it is called from places that have
 * already unmounted. `quietNotifications` defaults to **true**, so a test asserting a success toast
 * without setting it will watch that toast silently not exist.
 */
export async function seedSettings(patch: Partial<SettingsDto>): Promise<void> {
  const settings: SettingsDto = { ...DEFAULT_SETTINGS, ...patch };
  await setMeta('settings', settings);
  queryClient.setQueryData(['settings'], settings);
}

/** What the component under test queued for the server. Empty after `resetDb`. */
export const outboxOps = (): Promise<OutboxOp[]> => db.outbox.orderBy('seq').toArray();
