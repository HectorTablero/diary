import 'fake-indexeddb/auto';
import { DEFAULT_SETTINGS, UNDATED_KEY } from '@diary/shared';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { backupEnvelopeSchema, BACKUP_VERSION } from '@/lib/backup/schema';
import type { PluginRecordBackupRow } from '@/lib/backup/schema';
import {
  applyPluginSettingsChoices,
  usePluginSettingsConflicts,
  type PluginSettingsConflict,
} from './importConflicts';

/* Restoring plugin settings is the one part of an import that changes something on *other* devices,
   because a config row syncs. So the rule is the same as everywhere else in this importer — apply
   what doesn't clash, ask about what does — and the tests are about which is which. */

const row = (patch: Partial<PluginRecordBackupRow> = {}): PluginRecordBackupRow => ({
  id: '507f1f77bcf86cd799439011',
  pluginId: 'habits',
  scope: 'config',
  dateKey: UNDATED_KEY,
  data: { enabled: true, settings: { weekGoal: 5 } },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...patch,
});

const localConfig = (data: Record<string, unknown>) =>
  db.pluginRecords.put({
    id: 'local-cfg',
    pluginId: 'habits',
    scope: 'config',
    dateKey: UNDATED_KEY,
    data,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  });

const conflictsFor = async (rows: PluginRecordBackupRow[]) => {
  const { result } = renderHook(() => usePluginSettingsConflicts(rows));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result.current.conflicts;
};

beforeEach(async () => {
  await db.pluginRecords.clear();
});

describe('what counts as a settings conflict', () => {
  it('is not one when this account has no settings for that plugin', async () => {
    // Restoring onto a fresh device: there is nothing to overwrite, so nothing to ask.
    expect(await conflictsFor([row()])).toEqual([]);
  });

  it('is not one when both sides say the same thing', async () => {
    await localConfig({ enabled: true, settings: { weekGoal: 5 } });

    expect(await conflictsFor([row()])).toEqual([]);
  });

  it('ignores key order, which is not a difference', async () => {
    /* A row that round-tripped through a different JSON writer must not read as a conflict — that
       would ask the user to resolve a difference that does not exist. */
    await localConfig({ settings: { weekGoal: 5 }, enabled: true });

    expect(
      await conflictsFor([row({ data: { enabled: true, settings: { weekGoal: 5 } } })]),
    ).toEqual([]);
  });

  it('is one when the enabled state differs', async () => {
    await localConfig({ enabled: false, settings: { weekGoal: 5 } });

    const conflicts = await conflictsFor([row()]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      pluginId: 'habits',
      current: { enabled: false },
      incoming: { enabled: true },
    });
  });

  it('is one when the options differ', async () => {
    await localConfig({ enabled: true, settings: { weekGoal: 3 } });

    expect(await conflictsFor([row()])).toHaveLength(1);
  });

  it('never treats data rows as a settings conflict', async () => {
    await localConfig({ enabled: true, settings: {} });

    // A day's ticks keep their id and upsert; there is nothing about them to decide.
    expect(await conflictsFor([row({ scope: 'record', dateKey: '2026-08-01' })])).toEqual([]);
  });
});

describe('applying the choices', () => {
  const conflict: PluginSettingsConflict = {
    pluginId: 'habits',
    current: { enabled: false, settingsCount: 0 },
    incoming: { enabled: true, settingsCount: 1 },
  };

  it('drops a conflicted config row the user chose to keep', () => {
    const kept = applyPluginSettingsChoices([row()], [conflict], { habits: 'keep' });

    expect(kept).toEqual([]);
  });

  it('restores it when the user chose the backup', () => {
    const kept = applyPluginSettingsChoices([row()], [conflict], { habits: 'use' });

    expect(kept).toHaveLength(1);
  });

  it('always restores data rows, whatever was chosen for settings', () => {
    const data = row({ id: '507f1f77bcf86cd799439012', scope: 'record', dateKey: '2026-08-01' });

    const kept = applyPluginSettingsChoices([row(), data], [conflict], { habits: 'keep' });

    expect(kept.map((r) => r.id)).toEqual([data.id]);
  });

  it('restores unconflicted settings without a choice being recorded', () => {
    const other = row({ id: '507f1f77bcf86cd799439013', pluginId: 'mood' });

    const kept = applyPluginSettingsChoices([other], [conflict], {});

    expect(kept.map((r) => r.pluginId)).toEqual(['mood']);
  });
});

describe('the envelope', () => {
  const base = {
    exportedAt: '2026-08-10T00:00:00.000Z',
    entries: [],
    people: [],
    tags: [],
    settings: DEFAULT_SETTINGS,
  };

  it('is written at version 3', () => {
    expect(BACKUP_VERSION).toBe(3);
  });

  it('still reads a version 2 file, as a diary with no plugin data', () => {
    // The point of the union: an older file restores as a diary without plugins rather than
    // refusing to load at all.
    const parsed = backupEnvelopeSchema.safeParse({ ...base, version: 2, threads: [] });

    expect(parsed.success && parsed.data.pluginRecords).toEqual([]);
  });

  it('reads a version 1 file too', () => {
    const parsed = backupEnvelopeSchema.safeParse({ ...base, version: 1 });

    expect(parsed.success && parsed.data.pluginRecords).toEqual([]);
  });

  it('round-trips plugin rows', () => {
    const parsed = backupEnvelopeSchema.safeParse({
      ...base,
      version: 3,
      threads: [],
      pluginRecords: [row()],
    });

    expect(parsed.success && parsed.data.pluginRecords[0].data).toEqual({
      enabled: true,
      settings: { weekGoal: 5 },
    });
  });

  it('refuses a row whose payload breaks the collection’s bounds', () => {
    // The importer cannot know what a plugin means by `data`, but it still holds the file to the
    // same shape the server would — a file is no more trusted than a client.
    const parsed = backupEnvelopeSchema.safeParse({
      ...base,
      version: 3,
      threads: [],
      pluginRecords: [row({ data: { $bad: 1 } })],
    });

    expect(parsed.success).toBe(false);
  });
});
