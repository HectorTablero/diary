import { DATE_KEY_REGEX } from '@diary/shared';
import { addDays } from 'date-fns';
import { Cake, ChevronLeft, ChevronRight, NotebookPen } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useDayEntries, usePeople } from '@/api/hooks';
import { EmptyState } from '@/components/common/EmptyState';
import { EntryComposer } from '@/components/entry/EntryComposer';
import { EntryItem } from '@/components/entry/EntryItem';
import { PageContainer } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ageOn, birthdaysOn } from '@/lib/birthday';
import { formatDateKey, parseDateKey, toDateKey, todayKey } from '@/lib/dates';
import { cn } from '@/lib/utils';

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
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => shift(-1)} aria-label={t('diary.previousDay')}>
          <ChevronLeft className="size-4" />
        </Button>

        <button
          type="button"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'date';
            input.value = dateKey;
            input.onchange = (e) => {
              const val = (e.target as HTMLInputElement).value;
              if (val) goTo(val);
            };
            input.showPicker();
          }}
          className="min-w-0 flex-1 text-center"
        >
          <h1 className={cn('text-base font-semibold tracking-tight first-letter:uppercase', isToday && 'text-primary')}>
            {formatDateKey(dateKey, i18n.language, 'EEEE, d MMMM')}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isToday ? t('common.today') :formatDateKey(dateKey, i18n.language, 'yyyy') + (parseDateKey(dateKey) > new Date() ? ` (${t('common.future')})` : '')}
          </p>
        </button>

        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => shift(1)} aria-label={t('diary.nextDay')}>
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
        <ul className="-mx-2 flex flex-col">
          {entries.map((entry) => (
            <EntryItem key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={NotebookPen}
          title={t('diary.noEntries')}
          description={t('diary.noEntriesDescription')}
        />
      )}

      {celebrating.length > 0 && (
        <section className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-pink-500/30 bg-pink-500/[0.06] px-3 py-2 text-sm">
          <Cake className="size-4 shrink-0 text-pink-500 dark:text-pink-400" />
          {celebrating.map((person, index) => {
            // Age on the day being viewed, not today — browsing back to a past birthday should
            // show how old they turned then.
            const age = ageOn(person.birthday, parseDateKey(dateKey));
            return (
              <span key={person.id}>
                {index > 0 && <span className="mr-1.5 text-muted-foreground">·</span>}
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
              </span>
            );
          })}
        </section>
      )}

      <div className="mt-8 rounded-xl border bg-card p-3 shadow-xs">
        <EntryComposer key={dateKey} dateKey={dateKey} />
      </div>
    </PageContainer>
  );
}