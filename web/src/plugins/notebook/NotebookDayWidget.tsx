import { ChevronRight, NotebookPen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { todayKey } from '@/lib/dates';
import { documentLabel } from './model';
import { useTouchedDocuments } from './useNotebook';

/**
 * The notebook's card on the day page.
 *
 * Two jobs, and it only ever does the ones it has cause to:
 *
 *   - **today**: asks whether there is anything to think through, with a way into the notebook. This
 *     is the one prompt the plugin makes, and it is a question rather than a nag — there is no
 *     streak to keep and no notification behind it.
 *   - **any day, including today**: the documents actually written in on that day, as links.
 *
 * A past day with nothing written in it renders **nothing at all**. The prompt would be an
 * invitation to backdate a thought, which this plugin has no notion of — a revision is dated by the
 * day it was written, not by the day being looked at — and a card that appears on every day of the
 * diary saying "nothing here" is the complaint any always-present widget earns.
 */
export function NotebookDayWidget({ dateKey }: { dateKey: string }) {
  const { t } = useTranslation();
  const { touched, loading } = useTouchedDocuments(dateKey);
  const isToday = dateKey === todayKey();

  // Nothing is drawn while loading: this sits below the composer, and a placeholder that resolves in
  // a few hundred milliseconds only draws the eye to something about to appear anyway.
  if (loading) return null;
  if (!isToday && touched.length === 0) return null;

  return (
    <section
      className="rounded-xl border bg-card p-4 shadow-xs"
      aria-labelledby="notebook-day-title"
    >
      <div className="flex items-center gap-2">
        <NotebookPen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 id="notebook-day-title" className="flex-1 text-sm font-medium">
          {t('plugins.notebook.title')}
        </h2>
        {isToday && (
          <Button asChild variant="outline" size="sm">
            <Link to="/plugins/notebook">{t('plugins.notebook.open')}</Link>
          </Button>
        )}
      </div>

      {isToday && touched.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">{t('plugins.notebook.dayPrompt')}</p>
      )}

      {touched.length > 0 && (
        <>
          <p className="mt-3 text-xs text-muted-foreground">
            {t(isToday ? 'plugins.notebook.touchedToday' : 'plugins.notebook.touchedThatDay', {
              count: touched.length,
            })}
          </p>
          <ul className="mt-2 space-y-1">
            {touched.map(({ id, document, added, removed }) => (
              <li key={id}>
                <Link
                  to={`/plugins/notebook?doc=${id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {document ? documentLabel(document, t('plugins.notebook.untitled')) : ''}
                  </span>
                  {/* Both sides of the day's change, the way a diff states it — a day spent cutting
                      a thought down is work, and a single net figure reports it as nothing. A side
                      that is zero is left out rather than shown as "+0", which is a number that
                      earns none of the space it takes in a row this tight.

                      The app's own two colours, not a new pair: emerald-600/400 and `destructive`
                      are what the backup import review already uses for a row added and a row lost
                      (BackupConflictRow), which is the same distinction being drawn here.

                      One accessible label for the pair, so a screen reader gets a sentence rather
                      than two bare numbers with symbols in front of them. */}
                  <span
                    aria-label={t('plugins.notebook.charactersDeltaLabel', { added, removed })}
                    className="flex shrink-0 gap-1.5 text-xs tabular-nums"
                  >
                    {added > 0 && (
                      <span aria-hidden className="text-emerald-600 dark:text-emerald-400">
                        +{added}
                      </span>
                    )}
                    {removed > 0 && (
                      <span aria-hidden className="text-destructive">
                        −{removed}
                      </span>
                    )}
                  </span>
                  <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
