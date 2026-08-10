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
import { PluginDaySlot } from '@/plugins/PluginDaySlot';

export default function DiaryDayPage() {
  const { date } = useParams<{ date: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const valid = !!date && DATE_KEY_REGEX.test(date) && !isNaN(parseDateKey(date).getTime());
  const dateKey = valid ? date! : todayKey();
  const { data: entries, isLoading } = useDayEntries(dateKey);
  const { data: people = [] } = usePeople();

  if (!valid) return <Navigate to={`/diary/${todayKey()}`} replace />;

  const goTo = (key: string) => navigate(`/diary/${key}`);
  const shift = (days: number) => goTo(toDateKey(addDays(parseDateKey(dateKey), days)));
  const isToday = dateKey === todayKey();
  const celebrating = birthdaysOn(people, dateKey);

  return (
    <PageContainer>
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

      {/**
       * Whose birthday it is, in the same card the habit checklist uses.
       *
       * It used to be a pink-tinted banner above the composer, which was wrong twice. It looked like
       * nothing else on the page — the one coloured panel in an app whose surfaces are all the same
       * card — so it read as an alert about something needing attention rather than as a fact about
       * the day. And it sat between the entries and the composer, where it pushed the writing box
       * down by however many people happened to share a birthday.
       *
       * Below the composer it joins the band of things that are *about* the day rather than the day
       * itself, above the habits for the same reason the habits are below the composer: writing
       * comes first, and what is fixed about the day comes before what you are still filling in.
       */}
      {celebrating.length > 0 && (
        <section
          className="mt-6 rounded-xl border bg-card p-4 shadow-xs"
          aria-labelledby="birthdays-day-title"
        >
          <div className="flex items-center gap-2">
            <Cake className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <h2 id="birthdays-day-title" className="flex-1 text-sm font-medium">
              {t('diary.birthdays')}
            </h2>
          </div>

          {/* Plainer than the habit card's list, because these lines are plainer than its rows:
              there is nothing to press, so nothing needs a row of its own to be pressed in, and the
              rules and padding that keep a checkbox apart from a stopwatch would here be dividing
              one short sentence from another. A gap does the whole job.

              Each line still says "birthday" under a heading that already does, because a line has
              to stand on its own: it is what a screen reader reads when it lands there, and what
              the eye returns to after scrolling the heading off a phone. */}
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {celebrating.map((person) => {
              // Age on the day being viewed, not today — browsing back to a past birthday should
              // show how old they turned then.
              const age = ageOn(person.birthday, parseDateKey(dateKey));
              return (
                <li key={person.id}>
                  {/* Trans, not t(): the sentence wraps the name differently per language
                      ("@Ana's birthday" vs "Cumpleaños de @Ana"), so the link has to be placed by
                      the translation rather than concatenated around it. */}
                  <Trans
                    i18nKey={age === null ? 'diary.birthdayLine' : 'diary.birthdayLineWithAge'}
                    values={{ name: person.name, age }}
                    components={{
                      // Same colour and weight segmentContent gives an @mention inside entry text,
                      // so a birthday reads like any other mention of that person.
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

      {/* Below the composer, so writing an entry keeps its position on the page and a plugin chunk
          that resolves late can't reflow the textarea out from under a cursor already in it.
          Renders null, and loads nothing at all, when no plugin with a day widget is enabled. */}
      <PluginDaySlot dateKey={dateKey} />
    </PageContainer>
  );
}
