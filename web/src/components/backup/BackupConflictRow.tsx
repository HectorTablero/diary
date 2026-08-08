import {
  Check,
  FilePenLine,
  Merge,
  ShieldAlert,
  TriangleAlert,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BackupResolution } from '@/lib/backup/conflicts';

export interface BackupMergeTarget {
  targetId: string;
  name: string | undefined;
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
  createIcon?: LucideIcon;
  onResolve: (resolution: BackupResolution) => void;
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
  createIcon: CreateIcon = UserPlus,
  onResolve,
}: BackupConflictRowProps) {
  const { t } = useTranslation();

  const isChosen = (action: BackupResolution['action'], targetId?: string) =>
    resolution?.action === action &&
    (action !== 'merge' || (resolution as { targetId: string }).targetId === targetId);

  return (
    <li
      className={cn(
        'flex flex-col gap-2.5 rounded-xl border p-3 shadow-xs transition-colors',
        resolution
          ? 'border-border bg-card'
          : hard
            ? 'border-destructive/50 bg-destructive/5'
            : 'border-amber-500/50 bg-amber-500/5',
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* A tinted disc rather than a bare glyph. At 16px against a tinted card the three icons
            were nearly indistinguishable from the text beside them, which is the one thing this
            column exists to avoid — it is the only marker of whether a row still needs a decision. */}
        <span
          className={cn(
            'mt-px flex size-6 shrink-0 items-center justify-center rounded-md',
            resolution
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : hard
                ? 'bg-destructive/10 text-destructive'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
          )}
        >
          {resolution ? (
            <Check className="size-3.5" />
          ) : hard ? (
            <ShieldAlert className="size-3.5" />
          ) : (
            <TriangleAlert className="size-3.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
            {conflictLabels.map((label, index) => (
              <li key={index} className="text-pretty">
                {label}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Indented to the text column, not the icon: the buttons answer the reason above them, and
          lining them up under it is what says so. Divided off because a resolved row's chosen
          action otherwise floats against the name with nothing separating decision from subject.
          Every row has at least one of these — a backup row can only clash with something that is
          already here, so merging into it is always available and no row is ever a dead end. */}
      <div className="flex flex-wrap gap-1.5 border-t pt-2.5 pl-8.5">
        {mergeTargets.map((target) => (
          <Button
            key={target.targetId}
            size="sm"
            variant={isChosen('merge', target.targetId) ? 'default' : 'outline'}
            className="h-7 gap-1 text-xs"
            onClick={() => onResolve({ action: 'merge', targetId: target.targetId })}
          >
            <Merge className="size-3" />
            {target.name
              ? t('importBackup.mergeInto', { name: target.name })
              : t('importBackup.merge')}
          </Button>
        ))}
        {allowCreate && (
          <Button
            size="sm"
            variant={isChosen('create') ? 'default' : 'outline'}
            className="h-7 gap-1 text-xs"
            onClick={() => onResolve({ action: 'create' })}
          >
            <CreateIcon className="size-3" />
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
      </div>
    </li>
  );
}
