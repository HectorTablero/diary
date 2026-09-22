import { useState } from 'react';
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
import {
  SIDEBAR_SPLIT_MIN_WIDTH,
  SIDEBAR_SPLIT_WIDE_GAP_MIN_WIDTH,
  useContainerWidth,
} from '@/lib/useContainerWidth';
import { useStickyColumn } from '@/lib/useStickyColumn';
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
  const [splitRef, splitWidth] = useContainerWidth<HTMLDivElement>();

  /* Deliberately not reset to `false` on every `dateKey` change: `PluginDaySlot` already re-derives
     this itself for the new date (its own effect keys off `dateKey` too, checking the real DOM once
     the new day's widgets have rendered) — see the comment on `onHasContentChange` there. Forcing it
     false here first meant every day navigation collapsed the side column and then, a tick later,
     re-expanded it once the child caught up: a guaranteed double layout shift on every navigation,
     worst in two-column mode where it also toggled the entries column between full-width and
     col-span-7. Starting from the previous day's value and letting the child correct it produces at
     most the one shift a genuine change in content actually requires. */
  const [hasPluginContent, setHasPluginContent] = useState(false);

  const goTo = (key: string) => navigate(`/diary/${key}`);
  const shift = (days: number) => goTo(toDateKey(addDays(parseDateKey(dateKey), days)));
  const isToday = dateKey === todayKey();
  const celebrating = birthdaysOn(people, dateKey);
  const hasSideContent = celebrating.length > 0 || hasPluginContent;
  /* The page's own max-width grows with the viewport whenever the two-column preference is on and
     there's side content to potentially show — that's just how wide this page is ever allowed to
     get, and it's fine for that ceiling to track the viewport. It must NOT be gated on
     `useTwoColumns` itself: that would make the measured width below depend on a decision that
     depends on the measured width, and the container would never grow past max-w-3xl's ~700px of
     content to find out it had room to split. Gating on the preference instead of `useTwoColumns`
     keeps that bootstrapping intact while still keeping the page at the same max-w-3xl as every
     other page when the user has opted into single-column mode outright. */
  const useTwoColumns =
    prefs.twoColumnLayout && hasSideContent && splitWidth >= SIDEBAR_SPLIT_MIN_WIDTH;
  const [mainColumnRef, mainColumnStyle] = useStickyColumn<HTMLDivElement>(useTwoColumns);
  const [sideColumnRef, sideColumnStyle] = useStickyColumn<HTMLElement>(useTwoColumns);

  if (!valid) return <Navigate to={`/diary/${todayKey()}`} replace />;

  return (
    <>
      {/* Its own `PageContainer`, separate from the one below: reusing the component rather than
          hand-matching its `max-w-3xl`/padding means the date selector is *guaranteed* pixel-identical
          to every other page's heading, rather than merely intended to be. It never takes the widened
          className the container below can get — inside `col-span-7` (or, before that, inside a
          shared container that had already widened) the arrows read as off-center or oddly spaced the
          moment there was side content to show. Sitting in a container of its own, always at the
          1-column width, means it looks and sits exactly the same way regardless of what's below it.
          `pb-0`/no top margin on the row below close the gap a second container's own padding would
          otherwise open up between this and the content container's `pt-0`. */}
      <PageContainer className="pb-0 md:pb-0">
        <div className="flex items-center gap-2">
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
      </PageContainer>

      <PageContainer
        className={cn(
          'pt-4 md:pt-4',
          prefs.twoColumnLayout && hasSideContent && 'lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl',
        )}
      >
        <div
          ref={splitRef}
          className={cn(
            useTwoColumns && 'grid grid-cols-12 items-start',
            useTwoColumns && (splitWidth >= SIDEBAR_SPLIT_WIDE_GAP_MIN_WIDTH ? 'gap-8' : 'gap-6'),
          )}
        >
          {/* Main column: entries & composer */}
          <div
            ref={mainColumnRef}
            style={mainColumnStyle}
            className={cn(useTwoColumns && 'col-span-7')}
          >
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
            /* Both columns are sticky (see useStickyColumn): whichever is shorter scrolls until its
               end is on screen and then waits for the other, rather than leaving a screen of empty
               space beside it at the bottom of the page. */
            <aside
              ref={sideColumnRef}
              style={sideColumnStyle}
              className={cn('mt-6 space-y-6', useTwoColumns && 'mt-0 col-span-5')}
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
    </>
  );
}
