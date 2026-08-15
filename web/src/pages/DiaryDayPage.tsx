import { useEffect, useState } from 'react';
import { DATE_KEY_REGEX } from '@diary/shared';
import { addDays } from 'date-fns';
import { Cake, ChevronLeft, ChevronRight, NotebookPen } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useDayEntries, usePeople } from '@/api/hooks';
import { EmptyState } from '@/components/common/EmptyState';
import { EntryComposer } from '@/components/entry/EntryComposer';
import { EntryTree } from '@/components/entry/EntryTree';
import { PageContainer } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Skeleton } from '@/components/ui/skeleton';
import { ageOn, birthdaysOn } from '@/lib/birthday';
import { formatDateKey, parseDateKey, toDateKey, todayKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { usePreferences } from '@/lib/preferences';
import { useEnabledPlugins } from '@/plugins/enabled';
import { PluginDaySlot } from '@/plugins/PluginDaySlot';
import { PLUGINS } from '@/plugins/registry';

export default function DiaryDayPage() {
  const { date } = useParams<{ date: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const valid = !!date && DATE_KEY_REGEX.test(date) && !isNaN(parseDateKey(date).getTime());
  const dateKey = valid ? date! : todayKey();
  const { data: entries, isLoading } = useDayEntries(dateKey);
  const { data: people = [] } = usePeople();
  const enabledPlugins = useEnabledPlugins();
  const prefs = usePreferences();

  const [hasPluginContent, setHasPluginContent] = useState(false);

  useEffect(() => {
    setHasPluginContent(false);
  }, [dateKey]);

  if (!valid) return <Navigate to={`/diary/${todayKey()}`} replace />;

  const goTo = (key: string) => navigate(`/diary/${key}`);
  const shift = (days: number) => goTo(toDateKey(addDays(parseDateKey(dateKey), days)));
  const isToday = dateKey === todayKey();
  const celebrating = birthdaysOn(people, dateKey);
  const hasSideContent = celebrating.length > 0 || hasPluginContent;
  const useTwoColumns = prefs.twoColumnLayout && hasSideContent;

  return (
    <PageContainer
      className={useTwoColumns ? 'lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl' : undefined}
    >
      <div
        className={cn(useTwoColumns && 'lg:grid lg:grid-cols-12 lg:gap-6 xl:gap-8 lg:items-start')}
      >
        {/* Main column: entries & composer */}
        <div className={cn(useTwoColumns && 'lg:col-span-7 xl:col-span-7')}>
          <div className="mb-4 flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => shift(-1)}
              aria-label={t('diary.previousDay')}
            >
              <ChevronLeft className="size-4" />
            </Button>

            {/* The heading *is* the date field. It used to open a detached `<input type="date">` via
                showPicker(), which meant the app's most-used date control was the only one not using
                the app's own calendar — a different widget per browser, a full-screen Material dialog
                on Android, and no first-day-of-week setting. Same DatePicker as the composer and
                search now, just wearing the heading as its trigger. */}
            <DatePicker
              value={dateKey}
              onChange={(value) => value && goTo(value)}
              align="center"
              aria-label={t('diary.entryDate')}
              trigger={
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-lg text-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <h1
                    className={cn(
                      'text-base font-semibold tracking-tight first-letter:uppercase',
                      isToday && 'text-primary',
                    )}
                  >
                    {formatDateKey(dateKey, i18n.language, 'EEEE, d MMMM')}
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    {isToday
                      ? t('common.today')
                      : formatDateKey(dateKey, i18n.language, 'yyyy') +
                        (parseDateKey(dateKey) > new Date() ? ` (${t('common.future')})` : '')}
                  </p>
                </button>
              }
            />

            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => shift(1)}
              aria-label={t('diary.nextDay')}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          {isLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-8 w-4/5" />
            </div>
          ) : entries && entries.length > 0 ? (
            <EntryTree entries={entries} />
          ) : (
            <EmptyState
              icon={NotebookPen}
              title={t('diary.noEntries')}
              description={t('diary.noEntriesDescription')}
            />
          )}

          <div className="mt-8 rounded-xl border bg-card p-3 shadow-xs">
            <EntryComposer key={dateKey} dateKey={dateKey} />
          </div>
        </div>

        {/* Side content: birthdays & plugins (sidebar when useTwoColumns is true, single-column below composer when useTwoColumns is false) */}
        {(hasSideContent || enabledPlugins.size > 0) && (
          <aside
            className={cn(
              'mt-6 space-y-6',
              useTwoColumns && 'lg:mt-0 lg:col-span-5 xl:col-span-5 lg:sticky lg:top-6',
            )}
          >
            {/**
             * Whose birthday it is, in the same card the habit checklist uses.
             *
             * Below the composer it joins the band of things that are *about* the day rather than the day
             * itself, above the habits for the same reason the habits are below the composer: writing
             * comes first, and what is fixed about the day comes before what you are still filling in.
             */}
            {celebrating.length > 0 && (
              <section
                className="rounded-xl border bg-card p-4 shadow-xs"
                aria-labelledby="birthdays-day-title"
              >
                <div className="flex items-center gap-2">
                  <Cake className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <h2 id="birthdays-day-title" className="flex-1 text-sm font-medium">
                    {t('diary.birthdays')}
                  </h2>
                </div>

                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {celebrating.map((person) => {
                    const age = ageOn(person.birthday, parseDateKey(dateKey));
                    return (
                      <li key={person.id}>
                        <Trans
                          i18nKey={
                            age === null ? 'diary.birthdayLine' : 'diary.birthdayLineWithAge'
                          }
                          values={{ name: person.name, age }}
                          components={{
                            mention: (
                              <Link
                                to={`/people/${person.id}`}
                                className="font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
                              />
                            ),
                          }}
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* Plugin day widgets (habits, period tracker, etc.) */}
            <PluginDaySlot
              dateKey={dateKey}
              className="mt-0"
              onHasContentChange={setHasPluginContent}
            />
          </aside>
        )}
      </div>
    </PageContainer>
  );
}
