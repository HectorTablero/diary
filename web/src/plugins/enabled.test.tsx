import 'fake-indexeddb/auto';
import { UNDATED_KEY } from '@diary/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Enablement is the one plugin setting that syncs, and the split around it is the design's least
   obvious decision — so these tests pin both halves of it:

     - it lives in a `config` row, so two devices enabling two different plugins cannot clobber
       each other the way a single settings object would;
     - the localStorage copy is only a *cache*, hydrating the first frame and never outranking
       Dexie — and it must not survive a sign-out.

   `.tsx` despite testing no component: vitest.config splits the projects by extension, and half of
   what is asserted here is about localStorage, which the node-environment `logic` project does not
   have. The store's own reads are guarded, so it *imports* fine there — it is these tests that need
   the DOM. */

/* Nothing mocked. The write path is the point — Dexie, then the outbox — and stubbing it would
   leave this asserting that a fake recorded what it was handed. `refreshNotifications` no-ops off
   native and `kick` finds no session, so the real modules are inert here anyway. */

const { db, clearLocalData } = await import('@/db/db');
const { ENABLED_MIRROR_KEY, readEnabledMirror } = await import('./enabledMirror');

const freshStore = async () => {
  vi.resetModules();
  return import('./enabled');
};

const configRow = (pluginId: string, enabled: boolean, settings = {}) => ({
  id: `cfg-${pluginId}`,
  pluginId,
  scope: 'config' as const,
  dateKey: UNDATED_KEY,
  data: { enabled, settings },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
});

beforeEach(async () => {
  localStorage.clear();
  await db.pluginRecords.clear();
  await db.outbox.clear();
});

describe('reading enablement', () => {
  it('hydrates synchronously from the mirror, before Dexie has been touched', async () => {
    localStorage.setItem(ENABLED_MIRROR_KEY, JSON.stringify(['habits']));

    const { getEnabledPlugins } = await freshStore();

    /* No await between module load and this read. The day slot renders on the first frame, and
       without the cache the widget would appear one Dexie round-trip late — a visible pop on a
       screen the user opens dozens of times a day. */
    expect([...getEnabledPlugins()]).toEqual(['habits']);
  });

  it('lets Dexie correct the mirror, never the other way round', async () => {
    // A plugin disabled on another device: the mirror is stale, the synced row is the truth.
    localStorage.setItem(ENABLED_MIRROR_KEY, JSON.stringify(['habits']));
    await db.pluginRecords.put(configRow('habits', false));

    const { getEnabledPlugins, refreshEnabledPlugins } = await freshStore();
    await refreshEnabledPlugins();

    expect([...getEnabledPlugins()]).toEqual([]);
    expect(readEnabledMirror()).toEqual([]);
  });

  it('survives a corrupt mirror rather than throwing on import', async () => {
    localStorage.setItem(ENABLED_MIRROR_KEY, 'not json');

    const { getEnabledPlugins } = await freshStore();

    expect([...getEnabledPlugins()]).toEqual([]);
  });
});

describe('changing enablement', () => {
  it('writes a config row and queues it, so the account follows', async () => {
    const { setPluginEnabled, isPluginEnabled } = await freshStore();

    await setPluginEnabled('habits', true);

    expect(isPluginEnabled('habits')).toBe(true);
    const rows = await db.pluginRecords.where('scope').equals('config').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pluginId: 'habits', data: { enabled: true } });
    // Through the outbox, like every other write — so it works offline and replays in order.
    const queued = await db.outbox.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0].path).toBe('/plugin-records');
  });

  it('keeps two plugins independent, which a single settings object could not', async () => {
    /* The reason this is a row per plugin rather than a field on SettingsDto: saveSettings PUTs
       the whole settings body, so a device enabling A offline would, on replay, un-enable B that
       another device had turned on. Separate rows cannot collide at all. */
    const { setPluginEnabled, getEnabledPlugins } = await freshStore();

    await setPluginEnabled('habits', true);
    await setPluginEnabled('mood', true);
    await setPluginEnabled('habits', false);

    expect([...getEnabledPlugins()]).toEqual(['mood']);
    const rows = await db.pluginRecords.where('scope').equals('config').toArray();
    expect(rows.map((r) => [r.pluginId, (r.data as { enabled: boolean }).enabled]).sort()).toEqual([
      ['habits', false],
      ['mood', true],
    ]);
  });

  it('does not lose a plugin’s settings when it is toggled', async () => {
    const { setPluginEnabled, getPluginSettings, savePluginSettings } = await freshStore();

    await setPluginEnabled('habits', true);
    await savePluginSettings('habits', { weekGoal: 5 });
    await setPluginEnabled('habits', false);

    // enabled and settings share one row, so a careless write would take the settings with it.
    expect(await getPluginSettings('habits')).toEqual({ weekGoal: 5 });
  });

  it('updates the same row rather than adding a second one', async () => {
    const { setPluginEnabled } = await freshStore();

    await setPluginEnabled('habits', true);
    await setPluginEnabled('habits', false);

    // A second config row would make `enabled` depend on which one a query happened to return
    // first — the server refuses it with a unique index, but the client must not try.
    expect(await db.pluginRecords.where('scope').equals('config').count()).toBe(1);
    const queued = await db.outbox.toArray();
    expect(queued.map((op) => op.method)).toEqual(['POST', 'PATCH']);
  });
});

describe('signing out', () => {
  it('clears the mirror as well as the tables', async () => {
    const { setPluginEnabled } = await freshStore();
    await setPluginEnabled('habits', true);
    expect(readEnabledMirror()).toEqual(['habits']);

    await clearLocalData();

    /* localStorage survives sign-out, so without this the next account on a shared device starts
       with the previous account's plugins switched on — before any sync could contradict it. */
    expect(readEnabledMirror()).toEqual([]);
    expect(await db.pluginRecords.count()).toBe(0);
  });
});
