import { FilePenLine, Puzzle, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConflictSection } from '@/components/backup/ConflictSection';
import { Button } from '@/components/ui/button';
import type { PluginRecordBackupRow } from '@/lib/backup/schema';
import { cn } from '@/lib/utils';
import { ensurePluginLocales } from '@/plugins/i18n';
import { findPlugin } from '@/plugins/registry';
import type { PluginSettingsConflict, PluginSettingsResolution } from '@/plugins/importConflicts';

/**
 * The plugin half of the backup review.
 *
 * Two kinds of row, reviewed differently because they are different promises:
 *
 *   - **data** (`scope: 'record'`) — habits, and the days they were done. Rows keep their ids, so
 *     restoring is an upsert with nothing to decide. Listed for the count, not for a choice.
 *   - **settings** (`scope: 'config'`) — whether each plugin is on, plus its synced options. These
 *     restore too, but they *replace* what this account is using, on every device. Where the file
 *     and the account disagree, the user picks; where they don't, nothing is asked.
 *
 * The alternative — one "also restore plugin settings" switch — was simpler and worse. It made the
 * user answer a question about plugins they have never configured, and gave them no way to accept
 * the file's habits while keeping their own reminder setup.
 */
export function PluginImportSection({
  rows,
  conflicts,
  resolutions,
  onResolve,
}: {
  rows: readonly PluginRecordBackupRow[];
  conflicts: readonly PluginSettingsConflict[];
  resolutions: Readonly<Record<string, PluginSettingsResolution>>;
  onResolve: (pluginId: string, resolution: PluginSettingsResolution) => void;
}) {
  const { t, i18n } = useTranslation();
  const [named, setNamed] = useState<ReadonlySet<string>>(new Set());

  const { dataRows, pluginIds } = useMemo(
    () => ({
      dataRows: rows.filter((row) => row.scope === 'record'),
      pluginIds: [...new Set(rows.map((row) => row.pluginId))].sort(),
    }),
    [rows],
  );

  /* A file can hold rows from a plugin this build doesn't have — an older release, or one since
     removed. Those still restore; they simply cannot be named, and are shown under their raw id
     rather than given a title they don't have. */
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      pluginIds.map(async (id) => {
        if (!findPlugin(id)) return null;
        try {
          await ensurePluginLocales(id);
          return id;
        } catch {
          return null;
        }
      }),
    ).then((ids) => {
      if (!cancelled) setNamed(new Set(ids.filter((id): id is string => id !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [pluginIds, i18n.language]);

  if (!rows.length) return null;

  const nameOf = (id: string) => (named.has(id) ? t(`plugins.${id}.name`) : id);
  const unresolved = conflicts.filter((conflict) => !resolutions[conflict.pluginId]).length;

  return (
    <ConflictSection
      title={t('importBackup.plugins')}
      icon={Puzzle}
      total={conflicts.length}
      unresolved={unresolved}
    >
      <ul className="mb-3 space-y-1 text-sm">
        {pluginIds.map((id) => (
          <li key={id} className="flex items-center gap-2 text-muted-foreground">
            <Puzzle className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-foreground">{nameOf(id)}</span>
            <span className="shrink-0 tabular-nums">
              {t('importBackup.pluginRows', {
                count: dataRows.filter((row) => row.pluginId === id).length,
              })}
            </span>
          </li>
        ))}
      </ul>

      <ul className="space-y-2">
        {conflicts.map((conflict) => {
          const chosen = resolutions[conflict.pluginId];
          const state = (which: PluginSettingsResolution): 'default' | 'outline' =>
            chosen === which ? 'default' : 'outline';
          return (
            <li
              key={conflict.pluginId}
              className={cn(
                'flex flex-col gap-2.5 rounded-xl border p-3 shadow-xs transition-colors',
                chosen ? 'border-border bg-card' : 'border-amber-500/50 bg-amber-500/5',
              )}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{nameOf(conflict.pluginId)}</p>
                {/* Says what each side actually is, rather than only that they differ — "on, 2
                    options" against "off" is the difference a person can decide about. */}
                <p className="mt-1 text-xs text-pretty text-muted-foreground">
                  {t('importBackup.pluginSettingsDiffer', {
                    current: t(
                      conflict.current.enabled ? 'importBackup.pluginOn' : 'importBackup.pluginOff',
                      { count: conflict.current.settingsCount },
                    ),
                    incoming: t(
                      conflict.incoming.enabled
                        ? 'importBackup.pluginOn'
                        : 'importBackup.pluginOff',
                      { count: conflict.incoming.settingsCount },
                    ),
                  })}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 border-t pt-2.5">
                <Button
                  size="sm"
                  variant={state('keep')}
                  className="h-7 gap-1 text-xs"
                  onClick={() => onResolve(conflict.pluginId, 'keep')}
                >
                  <Undo2 className="size-3" />
                  {t('importBackup.pluginKeepCurrent')}
                </Button>
                <Button
                  size="sm"
                  variant={state('use')}
                  className="h-7 gap-1 text-xs"
                  onClick={() => onResolve(conflict.pluginId, 'use')}
                >
                  <FilePenLine className="size-3" />
                  {t('importBackup.pluginUseBackup')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </ConflictSection>
  );
}
