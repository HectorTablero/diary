import { Check, FilePenLine, Merge, Pencil, ShieldAlert, TriangleAlert, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { BackupResolution } from '@/lib/backup/conflicts';

export interface BackupMergeTarget {
  targetId: string;
  name: string;
}

interface BackupConflictRowProps {
  name: string;
  conflictLabels: string[];
  hard: boolean;
  resolution: BackupResolution | null;
  mergeTargets: BackupMergeTarget[];
  /** "Keep both" (people/tags, mints a new id) or plain "create" wording for entries. */
  createLabel: string;
  allowCreate: boolean;
  allowOverwrite?: boolean;
  onResolve: (resolution: BackupResolution) => void;
  /** Omitted for entries — there's no name to rename. */
  onRename?: (name: string) => void;
}

/** Generic conflict row for restoring a JSON backup, shared across tags/people/entries.
    Modeled directly on ImportContactsPage's ConflictRow, but parametrized over which resolution
    actions actually make sense for the entity kind being reviewed. */
export function BackupConflictRow({
  name,
  conflictLabels,
  hard,
  resolution,
  mergeTargets,
  createLabel,
  allowCreate,
  allowOverwrite = false,
  onResolve,
  onRename,
}: BackupConflictRowProps) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);

  const isChosen = (action: BackupResolution['action'], targetId?: string) =>
    resolution?.action === action &&
    (action !== 'merge' || (resolution as { targetId: string }).targetId === targetId);

  const commitRename = () => {
    const value = draft.trim();
    if (value) onRename?.(value);
    setRenaming(false);
  };

  return (
    <li
      className={
        'flex flex-col gap-2 rounded-xl border p-3 ' +
        (resolution
          ? 'border-border bg-card'
          : hard
            ? 'border-destructive/50 bg-destructive/5'
            : 'border-amber-500/50 bg-amber-500/5')
      }
    >
      <div className="flex items-start gap-2">
        {resolution ? (
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : hard ? (
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        ) : (
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        )}
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={draft}
                autoFocus
                className="h-8"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenaming(false);
                }}
              />
              <Button size="sm" className="h-8" onClick={commitRename}>
                {t('common.save')}
              </Button>
            </div>
          ) : (
            <p className="truncate text-sm font-medium">{name}</p>
          )}
          <ul className="mt-0.5 flex flex-col text-xs text-muted-foreground">
            {conflictLabels.map((label, index) => (
              <li key={index}>{label}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {mergeTargets.map((target) => (
          <Button
            key={target.targetId}
            size="sm"
            variant={isChosen('merge', target.targetId) ? 'default' : 'outline'}
            className="h-7 gap-1 text-xs"
            onClick={() => onResolve({ action: 'merge', targetId: target.targetId })}
          >
            <Merge className="size-3" />
            {t('importBackup.mergeInto', { name: target.name })}
          </Button>
        ))}
        {allowCreate && (
          <Button
            size="sm"
            variant={isChosen('create') ? 'default' : 'outline'}
            className="h-7 gap-1 text-xs"
            onClick={() => onResolve({ action: 'create' })}
          >
            <UserPlus className="size-3" />
            {createLabel}
          </Button>
        )}
        {allowOverwrite && (
          <Button
            size="sm"
            variant={isChosen('overwrite') ? 'default' : 'outline'}
            className="h-7 gap-1 text-xs"
            onClick={() => onResolve({ action: 'overwrite' })}
          >
            <FilePenLine className="size-3" />
            {t('importBackup.overwrite')}
          </Button>
        )}
        {onRename && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              setDraft(name);
              setRenaming(true);
            }}
          >
            <Pencil className="size-3" />
            {t('importBackup.rename')}
          </Button>
        )}
      </div>
    </li>
  );
}
