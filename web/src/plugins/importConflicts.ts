import { useEffect, useState } from 'react';
import { getAllPluginConfigs } from '@/db/pluginRecords';
import type { PluginRecordBackupRow } from '@/lib/backup/schema';

/**
 * Which plugin settings in a backup disagree with the ones on this account.
 *
 * Plugin data (`scope: 'record'`) needs no review: rows keep their ids, so restoring is an upsert
 * and there is nothing to decide. Settings are different in a way that matters — a `config` row
 * holds whether the plugin is *on* plus its synced options, and it syncs. Restoring one replaces
 * what this account is using now, on every device.
 *
 * So the rule is the one the rest of this importer already follows: apply what doesn't clash, and
 * ask about what does.
 *
 *   - the file has settings for a plugin this account has none for → restored, no question;
 *   - the file's settings are identical to the current ones → nothing to decide;
 *   - they differ → a conflict, and the user picks.
 *
 * Compared by value rather than by `updatedAt`. A timestamp would let "newer" decide, and newer is
 * not better here: the whole reason to open a backup is that something about the current state is
 * wrong, and the file being older is often exactly why it is wanted.
 */

export type PluginSettingsResolution = 'keep' | 'use';

export interface PluginSettingsConflict {
  pluginId: string;
  /** What this account has now. */
  current: { enabled: boolean; settingsCount: number };
  /** What the file would replace it with. */
  incoming: { enabled: boolean; settingsCount: number };
}

interface ConfigShape {
  enabled?: unknown;
  settings?: Record<string, unknown>;
}

const describe = (data: unknown) => {
  const config = (data ?? {}) as ConfigShape;
  return {
    enabled: config.enabled === true,
    settingsCount: Object.keys(config.settings ?? {}).length,
  };
};

/* Key order is not meaningful in a settings object, so it is normalised away before comparing —
   otherwise a row that round-tripped through a different JSON writer would read as a conflict and
   ask the user to resolve a difference that does not exist. */
const canonical = (data: unknown): string => {
  const seen = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(seen);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, seen(child)]),
    );
  };
  return JSON.stringify(seen(data));
};

export function usePluginSettingsConflicts(rows: readonly PluginRecordBackupRow[]): {
  conflicts: PluginSettingsConflict[];
  loading: boolean;
} {
  const [conflicts, setConflicts] = useState<PluginSettingsConflict[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const incoming = rows.filter((row) => row.scope === 'config');
      if (!incoming.length) {
        if (!cancelled) {
          setConflicts([]);
          setLoading(false);
        }
        return;
      }
      const current = new Map((await getAllPluginConfigs()).map((row) => [row.pluginId, row]));
      const found = incoming.flatMap((row) => {
        const mine = current.get(row.pluginId);
        if (!mine) return []; // nothing to clash with
        if (canonical(mine.data) === canonical(row.data)) return []; // same thing, said twice
        return [
          {
            pluginId: row.pluginId,
            current: describe(mine.data),
            incoming: describe(row.data),
          },
        ];
      });
      if (!cancelled) {
        setConflicts(found);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  return { conflicts, loading };
}

/**
 * The `config` rows to actually restore, given the user's choices.
 *
 * A conflict resolved as `keep` drops the incoming row; anything unconflicted, or resolved as
 * `use`, goes through. Data rows are never filtered here — they always restore.
 */
export function applyPluginSettingsChoices(
  rows: readonly PluginRecordBackupRow[],
  conflicts: readonly PluginSettingsConflict[],
  resolutions: Readonly<Record<string, PluginSettingsResolution>>,
): PluginRecordBackupRow[] {
  const conflicted = new Set(conflicts.map((conflict) => conflict.pluginId));
  return rows.filter(
    (row) =>
      row.scope !== 'config' ||
      !conflicted.has(row.pluginId) ||
      resolutions[row.pluginId] === 'use',
  );
}
