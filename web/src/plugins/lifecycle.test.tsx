import 'fake-indexeddb/auto';
import { UNDATED_KEY } from '@diary/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Enablement syncs, and for a while it did not — not because any of the machinery was wrong, but
 * because the last link was missing. The config row went through the outbox, the server carried it
 * back, Dexie held it, and `refreshEnabledPlugins` would have turned it into the set the UI reads.
 * Nothing called `refreshEnabledPlugins`.
 *
 * So these are wiring tests rather than logic tests. `enabled.test.tsx` already proves the store
 * does the right thing when asked; what was missing was the asking, and the only reason it could go
 * unnoticed is that the two lines belonged in an entry point no test can import. That is why the
 * wiring moved into ./lifecycle.
 *
 * `.tsx` for the jsdom project: the store reads localStorage.
 */

/* Both spies come from `vi.hoisted`, because `vi.mock` is hoisted above every ordinary `const` in
   the file — a factory closing over a plain top-level variable reads it before it is assigned. */
const { syncNativeWidgets, onSyncApplied } = vi.hoisted(() => ({
  /* The widget half is stubbed. It is native-only and no-ops in a test anyway, but stubbing makes
     the *ordering* assertion below possible — that the enabled set is already correct by the time
     the widget is asked to redraw from it. */
  syncNativeWidgets: vi.fn(async () => {}),
  onSyncApplied: vi.fn((_cb: () => void) => () => {}),
}));

vi.mock('./nativeWidgets', () => ({ syncNativeWidgets }));

/* db/sync is stubbed export by export rather than spread from `importOriginal`.
 *
 * Both would work in isolation; only this one works here. db/sync sits in a cycle with the modules
 * under test, and asking for the original from inside a mock factory re-enters that cycle while it
 * is still being resolved — which vitest can only report as a generic "error when mocking a module",
 * pointing at the hoisting rule rather than at the import graph.
 *
 * The list is every export the app takes from db/sync (`grep "from '@/db/sync'"`), not just the one
 * being observed, because a blanked module breaks importers that have nothing to do with plugins —
 * i18n/index.ts, for one, takes `onReconnected` from here to expire its offline language probes. */
vi.mock('@/db/sync', () => ({
  onSyncApplied,
  onReconnected: vi.fn(() => () => {}),
  onRejected: vi.fn(() => () => {}),
  closeLiveChannel: vi.fn(),
  forceSyncNow: vi.fn(async () => {}),
  kick: vi.fn(),
  syncNow: vi.fn(async () => {}),
  typeSyncBlocker: vi.fn(),
  waitForOutboxDrain: vi.fn(async () => {}),
  initSync: vi.fn(),
}));

const { db } = await import('@/db/db');
const { ENABLED_MIRROR_KEY } = await import('./enabledMirror');

const configRow = (pluginId: string, enabled: boolean) => ({
  id: `cfg-${pluginId}`,
  pluginId,
  scope: 'config' as const,
  dateKey: UNDATED_KEY,
  data: { enabled, settings: {} },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
});

const fresh = async () => {
  vi.resetModules();
  const lifecycle = await import('./lifecycle');
  const enabled = await import('./enabled');
  return { ...lifecycle, ...enabled };
};

beforeEach(async () => {
  localStorage.clear();
  await db.pluginRecords.clear();
  await db.outbox.clear();
  syncNativeWidgets.mockClear();
  onSyncApplied.mockClear();
});

describe('refreshPlugins', () => {
  it('adopts a plugin another device switched on', async () => {
    // The row has synced into Dexie; nothing local has ever heard of it.
    await db.pluginRecords.put(configRow('habits', true));

    const { refreshPlugins, getEnabledPlugins } = await fresh();
    expect([...getEnabledPlugins()]).toEqual([]);

    await refreshPlugins();

    expect([...getEnabledPlugins()]).toEqual(['habits']);
  });

  it('adopts one on a device whose mirror is empty, which is the case that stayed broken', async () => {
    /* A fresh install, or anything after clearLocalData: the localStorage cache is empty, so the
       set had no seed and nothing was refilling it. Enablement was invisible on that device
       permanently, not just until the next reload. */
    localStorage.removeItem(ENABLED_MIRROR_KEY);
    await db.pluginRecords.put(configRow('habits', true));

    const { refreshPlugins, isPluginEnabled } = await fresh();
    await refreshPlugins();

    expect(isPluginEnabled('habits')).toBe(true);
  });

  it('lets a synced row switch a plugin off, not only on', async () => {
    localStorage.setItem(ENABLED_MIRROR_KEY, JSON.stringify(['habits']));
    await db.pluginRecords.put(configRow('habits', false));

    const { refreshPlugins, getEnabledPlugins } = await fresh();
    await refreshPlugins();

    expect([...getEnabledPlugins()]).toEqual([]);
  });

  it('has the enabled set correct before the widget is asked to redraw from it', async () => {
    /* The reason these two are one call in one order. The widget's snapshot asks isPluginEnabled to
       decide between drawing habits and drawing an empty card, so refreshing it first would push a
       snapshot built on the previous answer — on exactly the pass where the answer just changed. */
    await db.pluginRecords.put(configRow('habits', true));
    const { refreshPlugins, isPluginEnabled } = await fresh();

    let enabledWhenWidgetRan: boolean | null = null;
    syncNativeWidgets.mockImplementation(async () => {
      enabledWhenWidgetRan = isPluginEnabled('habits');
    });

    await refreshPlugins();

    expect(enabledWhenWidgetRan).toBe(true);
  });

  it('still refreshes the widget when reading the config rows fails', async () => {
    // Two guards rather than one try: a widget that cannot repaint must not leave the enabled set
    // stale, and neither is worth failing a sync over.
    const { refreshPlugins } = await fresh();
    const broken = vi.spyOn(db.pluginRecords, 'where').mockImplementation(() => {
      throw new Error('dexie is closed');
    });

    await expect(refreshPlugins()).resolves.toBeUndefined();
    expect(syncNativeWidgets).toHaveBeenCalled();
    broken.mockRestore();
  });
});

describe('initPlugins', () => {
  it('subscribes to sync, which is the link that was missing', async () => {
    const { initPlugins } = await fresh();

    initPlugins();

    expect(onSyncApplied).toHaveBeenCalledTimes(1);
  });

  it('reconciles once at startup, before any sync has applied', async () => {
    // A device that signs in and never syncs again still has to discover what the account had on.
    await db.pluginRecords.put(configRow('habits', true));
    const { initPlugins, isPluginEnabled } = await fresh();

    initPlugins();
    // The startup pass is deliberately not awaited by callers, so settle it here.
    await vi.waitFor(() => expect(isPluginEnabled('habits')).toBe(true));
  });

  it('re-reconciles whenever a sync applies', async () => {
    const { initPlugins, isPluginEnabled } = await fresh();
    initPlugins();
    await vi.waitFor(() => expect(onSyncApplied).toHaveBeenCalled());

    // A plugin enabled on another device lands in Dexie, then the sync engine announces it.
    await db.pluginRecords.put(configRow('habits', true));
    onSyncApplied.mock.calls[0][0]();

    await vi.waitFor(() => expect(isPluginEnabled('habits')).toBe(true));
  });

  it('hands back an unsubscribe rather than leaking the listener', async () => {
    const stop = vi.fn();
    onSyncApplied.mockReturnValueOnce(stop);
    const { initPlugins } = await fresh();

    initPlugins()();

    expect(stop).toHaveBeenCalled();
  });
});
