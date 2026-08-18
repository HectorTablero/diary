import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { diffView } from './history';
import { useDocumentHistory } from './useNotebook';

/**
 * How a thought got to where it is.
 *
 * A list of the days it moved, and the difference between any two of them. Picking a day sets the
 * right-hand side of the comparison and the day before it becomes the left, which is the reading
 * almost everyone wants almost every time — "what did I change that day". Both ends stay
 * overridable, because the other question ("how far has this come since March") needs the two ends
 * far apart.
 *
 * Loaded only when opened: a document's chain is never walked to render the document itself.
 */
export function HistoryDialog({
  documentId,
  title,
  open,
  onOpenChange,
}: {
  documentId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const { days, loading } = useDocumentHistory(documentId);
  /* Indices into `days`, not date keys: `-1` is a meaningful left-hand side (the document before it
     existed at all) and no date can express it. */
  const [selected, setSelected] = useState<number | null>(null);

  const toIndex = selected ?? days.length - 1;
  const fromIndex = toIndex - 1;

  const lines = useMemo(() => {
    if (toIndex < 0) return [];
    return diffView(fromIndex >= 0 ? days[fromIndex].text : '', days[toIndex].text);
  }, [days, fromIndex, toIndex]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{t('plugins.notebook.historyTitle')}</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : days.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('plugins.notebook.historyEmpty')}
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 sm:flex-row">
            {/* The timeline. Newest first — the recent past is what gets looked at. */}
            <ol className="flex shrink-0 gap-2 overflow-x-auto pb-1 sm:max-h-full sm:w-48 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:pb-0">
              {days
                .map((day, index) => ({ day, index }))
                .reverse()
                .map(({ day, index }) => (
                  <li key={day.dateKey}>
                    <button
                      type="button"
                      aria-current={index === toIndex}
                      onClick={() => setSelected(index)}
                      className={cn(
                        'w-full rounded-lg border px-3 py-2 text-left text-xs whitespace-nowrap transition-colors sm:whitespace-normal',
                        index === toIndex
                          ? 'border-primary bg-accent text-accent-foreground'
                          : 'hover:bg-muted',
                      )}
                    >
                      <span className="block font-medium">
                        {formatDateKey(day.dateKey, i18n.language, 'PP')}
                      </span>
                      {/* The same two figures the day card shows, in the same two colours, and a
                          side that is zero is left out the same way. A timeline reporting only
                          what was added would describe a day of cutting as a day of nothing. */}
                      <span
                        className="block tabular-nums"
                        aria-label={t('plugins.notebook.charactersDeltaLabel', {
                          added: day.added,
                          removed: day.removed,
                        })}
                      >
                        {day.added === 0 && day.removed === 0 ? (
                          <span className="text-muted-foreground">
                            {t('plugins.notebook.noNetGrowth')}
                          </span>
                        ) : (
                          <>
                            {day.added > 0 && (
                              <span aria-hidden className="text-emerald-600 dark:text-emerald-400">
                                +{day.added}
                              </span>
                            )}
                            {day.added > 0 && day.removed > 0 && ' '}
                            {day.removed > 0 && (
                              <span aria-hidden className="text-destructive">
                                −{day.removed}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
            </ol>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
              <p className="sticky top-0 border-b bg-muted/60 px-3 py-2 text-xs text-muted-foreground backdrop-blur-sm">
                {fromIndex >= 0
                  ? t('plugins.notebook.diffBetween', {
                      from: formatDateKey(days[fromIndex].dateKey, i18n.language, 'PP'),
                      to: formatDateKey(days[toIndex].dateKey, i18n.language, 'PP'),
                    })
                  : t('plugins.notebook.diffFirstDay', {
                      date: formatDateKey(days[toIndex].dateKey, i18n.language, 'PP'),
                    })}
              </p>
              {lines.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  {t('plugins.notebook.diffNoChange')}
                </p>
              ) : (
                <div className="p-1 font-mono text-xs leading-6">
                  {lines.map((line, index) => (
                    <div
                      key={index}
                      className={cn(
                        'flex gap-2 rounded px-2 whitespace-pre-wrap',
                        line.kind === 'added' &&
                          'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                        line.kind === 'removed' && 'bg-destructive/10 text-destructive',
                        line.kind === 'context' && 'text-muted-foreground',
                      )}
                    >
                      {/* The gutter is aria-hidden: "+" and "−" are how a sighted reader sees which
                          side a line is on, and reading them aloud in front of every line would bury
                          the prose the screen was opened for. */}
                      <span aria-hidden className="shrink-0 select-none opacity-60">
                        {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                      </span>
                      <span className="min-w-0 flex-1">{line.text || ' '}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
