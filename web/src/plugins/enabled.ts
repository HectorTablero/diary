import { UNDATED_KEY } from '@diary/shared';
import { useSyncExternalStore } from 'react';
import { getAllPluginConfigs, getPluginConfig, putPluginRecord } from '@/db/pluginRecords';
import { clearEnabledMirror, readEnabledMirror, writeEnabledMirror } from './enabledMirror';

/**
 * Which plugins are on — synced with the account, mirrored locally for the first frame.
 *
 * ## Where this lives, and why it is split
 *
 * A plugin being on is a property of the *diary*, not of one device: the rows it writes sync, so a
 * habit ticked on the phone that doesn't appear on the laptop is just a bug. So enablement lives in
 * the plugin's `config` row, alongside whatever settings the plugin itself keeps.
 *
 * What does *not* live there is anything that arms an alarm. That rule is `lib/preferences.ts`'s and
 * the reasoning is unchanged: signing out runs `clearLocalData()`, so a synced reminder flag would
 * revert to its default and the phone would resume buzzing at a time the user had switched off.
 * See `plugins/reminders.ts` for that half.
 *
 * The split is safe in both directions, which is what makes it the right one. After a sign-out a
 * synced `enabled` reverts to *disabled*, so nothing is armed at all; the device-local reminder
 * preference survives but sits inert until a sync turns the plugin back on.
 *
 * ## Why a config row rather than SettingsDto
 *
 * `saveSettings` merges over the local mirror and PUTs the *whole* settings body, so a device that
 * enabled plugin A while offline would, on replay a day later, un-enable plugin B that another
 * device turned on. One row per plugin makes those two independent writes that cannot collide. It
 * also keeps an open-ended map off a document that is fetched on every single sync pull.
 *
 * ## The mirror
 *
 * The source of truth is Dexie, which is async, and the day-page slot needs an answer before it
 * paints or the widget appears a frame late. So the enabled set is *cached* in localStorage and
 * read synchronously at module load, then reconciled from Dexie as soon as the read completes and
 * on every applied sync. It is only ever a cache — nothing writes to it that did not come from a
 * config row — and `clearLocalData()` clears it, without which one account's plugin set would show
 * up for the next account on a shared device.
 */

interface PluginConfig {
  enabled: boolean;
  settings: Record<string, unknown>;
}

/* Replaced rather than mutated: useSyncExternalStore compares snapshots by identity, so a mutated
   Set would never re-render and a fresh one per read would loop forever. */
let enabled: ReadonlySet<string> = new Set(readEnabledMirror());
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<string>): void {
  if (next.size === enabled.size && [...next].every((id) => enabled.has(id))) return;
  enabled = next;
  writeEnabledMirror([...next]);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getEnabledPlugins = (): ReadonlySet<string> => enabled;

export const isPluginEnabled = (id: string): boolean => enabled.has(id);

/** Re-read the config rows and republish. Call after a sync applies, and once at startup. */
export async function refreshEnabledPlugins(): Promise<void> {
  const configs = await getAllPluginConfigs();
  publish(
    new Set(
      configs
        .filter((row) => (row.data as Partial<PluginConfig>).enabled === true)
        .map((row) => row.pluginId),
    ),
  );
}

/**
 * Turn a plugin on or off for the account.
 *
 * Optimistic: the in-memory set and the mirror move first, so the UI responds at once, and the
 * write goes through the same Dexie-then-outbox path as every other mutation. A failed write throws
 * from `putPluginRecord` — the caller reports it, and the next `refreshEnabledPlugins` corrects the
 * set either way.
 */
export async function setPluginEnabled(pluginId: string, value: boolean): Promise<void> {
  const next = new Set(enabled);
  if (value) next.add(pluginId);
  else next.delete(pluginId);
  publish(next);

  // Preserve whatever settings the plugin has already stored: this row is shared with it.
  const existing = await getPluginConfig(pluginId);
  const settings = (existing?.data as Partial<PluginConfig> | undefined)?.settings ?? {};
  await putPluginRecord(pluginId, 'config', UNDATED_KEY, { enabled: value, settings });
}

/** Read a plugin's synced settings. Shape is the plugin's business — parse before trusting. */
export async function getPluginSettings(pluginId: string): Promise<Record<string, unknown>> {
  const row = await getPluginConfig(pluginId);
  return (row?.data as Partial<PluginConfig> | undefined)?.settings ?? {};
}

/** Merge into a plugin's synced settings, leaving `enabled` alone. */
export async function savePluginSettings(
  pluginId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const row = await getPluginConfig(pluginId);
  const current = (row?.data as Partial<PluginConfig> | undefined) ?? {};
  await putPluginRecord(pluginId, 'config', UNDATED_KEY, {
    enabled: current.enabled ?? enabled.has(pluginId),
    settings: { ...(current.settings ?? {}), ...patch },
  });
}

/**
 * Forget everything this store knows.
 *
 * `clearLocalData()` calls `clearEnabledMirror` from ./enabledMirror directly — it cannot import
 * this module without closing a cycle — so this exists for the in-memory half, and for tests. Both
 * paths are idempotent, so the order they run in doesn't matter.
 */
export function resetEnabledPlugins(): void {
  enabled = new Set();
  clearEnabledMirror();
  for (const listener of listeners) listener();
}

export function useEnabledPlugins(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getEnabledPlugins, getEnabledPlugins);
}
