import { Check, DatabaseBackup, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDateKey } from '@/lib/dates';
import { cn } from '@/lib/utils';

export interface ImportCategory {
  label: string;
  /** The same icon this kind has in the nav, so a column is recognisable before it is read. */
  icon: LucideIcon;
  total: number;
  conflicts: number;
}

/**
 * What is in the file, before any of it is decided.
 *
 * This replaced four sentences of the form "Tags: 10 new, 2 need attention." — one per kind, stacked
 * in a box. Everything was in there, and none of it could be found: the numbers were the only part
 * that mattered and they were buried mid-sentence, four times, in prose that had to be read to be
 * compared. A number is what the eye is looking for here, so a number is what is set large.
 *
 * The header line above the tiles is new rather than restyled. `importBackup.exportedAt` had been
 * defined and translated into all five languages and then never rendered anywhere, which left the
 * review screen unable to answer the first question anyone asks it — *which* backup is this?
 */
export function ImportSummary({
  exportedAt,
  version,
  categories,
}: {
  exportedAt: string;
  version: number;
  categories: ImportCategory[];
}) {
  const { t, i18n } = useTranslation();

  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-xs">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <DatabaseBackup className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {/* The file has no name by the time it reaches this page — only its contents — so the
                export date is the identity, and it is the thing a user recognises anyway. */}
            {t('importBackup.exportedAt', {
              date: formatDateKey(exportedAt.slice(0, 10), i18n.language, 'PPP'),
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('importBackup.fileVersion', { version })}
          </p>
        </div>
      </div>

      {/* Two columns on a phone, four where there is room: the four kinds are peers and read as a
          row, but 80px-wide tiles with a four-figure entry count in them do not. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {categories.map((category) => (
          <CategoryTile key={category.label} category={category} />
        ))}
      </div>
    </div>
  );
}

function CategoryTile({ category }: { category: ImportCategory }) {
  const { t, i18n } = useTranslation();
  const { icon: Icon, label, total, conflicts } = category;
  const needsReview = conflicts > 0;

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-xl border p-3 shadow-xs transition-colors',
        // Amber for "you have something to do here", matching every other warning in the app
        // (AppLayout's update banner, ContactInfo, the reminders section). Plain card otherwise —
        // a clean category is not an achievement to celebrate, it is just nothing to do.
        needsReview ? 'border-amber-500/50 bg-amber-500/5' : 'bg-card',
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      {/* tabular-nums so the four tiles' figures line up on their digits rather than drifting. */}
      <p className="text-2xl leading-none font-semibold tabular-nums">
        {total.toLocaleString(i18n.language)}
      </p>
      {needsReview ? (
        <p className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
          <TriangleAlert className="size-3 shrink-0" />
          {t('importBackup.needsReview', { count: conflicts })}
        </p>
      ) : (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Check className="size-3 shrink-0" />
          {t('importBackup.allNew')}
        </p>
      )}
    </div>
  );
}
