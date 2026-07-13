import type { PersonListItem } from '@diary/shared';
import { addMonths, endOfMonth, format, getDay, startOfMonth } from 'date-fns';
import { Cake, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useCalendarMonth, useOnThisDay, usePeople } from '@/api/hooks';
import { importanceDotClass } from '@/components/entry/ImportanceDot';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { EntryRow } from '@/components/person/EntryRow';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ageOn, birthdaysOn } from '@/lib/birthday';
import { dateFnsLocale, parseDateKey, todayKey } from '@/lib/dates';
import { cn } from '@/lib/utils';

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function heatmapBg(count: number, maxImportance: number, isDark: boolean): string {
  if (count === 0) return 'transparent';
  const opacity = Math.min(0.55, 0.08 + count * 0.055);

  if (isDark) {
    const colors: Record<number, string> = {
      1: `rgba(255, 160, 160, ${opacity})`,
      2: `rgba(255, 190, 140, ${opacity})`,
      3: `rgba(255, 220, 160, ${opacity})`,
      4: `rgba(160, 220, 180, ${opacity})`,
      5: `rgba(180, 200, 220, ${opacity})`,
    };
    return colors[maxImportance] ?? colors[3];
  }

  const colors: Record<number, string> = {
    1: `rgba(229, 72, 77, ${opacity})`,
    2: `rgba(247, 107, 21, ${opacity})`,
    3: `rgba(255, 178, 36, ${opacity})`,
    4: `rgba(76, 158, 99, ${opacity})`,
    5: `rgba(142, 166, 189, ${opacity})`,
  };
  return colors[maxImportance] ?? colors[3];
}

function isHighDensity(count: number): boolean {
  return count >= 6;
}

export default function CalendarPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isDark = useIsDark();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  const { data: days } = useCalendarMonth(year, month);
  const { data: onThisDay } = useOnThisDay(todayKey());
  const { data: people } = usePeople();

  const byDate = useMemo(() => new Map((days ?? []).map((d) => [d.date, d])), [days]);
  const locale = dateFnsLocale(i18n.language);
  const today = todayKey();

  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const last = endOfMonth(cursor);
    const leading = (getDay(first) + 6) % 7;
    const result: (string | null)[] = Array(leading).fill(null);
    for (let d = 1; d <= last.getDate(); d++) {
      result.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [cursor, year, month]);

  const weekdays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) =>
      format(new Date(2024, 0, 1 + i), 'EEEEEE', { locale }),
    );
  }, [locale]);

  // Anniversaries for the visible month only — birthdaysOn ignores the stored year, so a
  // birthday recorded as `--07-13` lands on 13 July of whichever year is on screen.
  const birthdaysByDate = useMemo(() => {
    const map = new Map<string, PersonListItem[]>();
    if (!people?.length) return map;
    for (const dateKey of cells) {
      if (!dateKey) continue;
      const celebrating = birthdaysOn(people, dateKey);
      if (celebrating.length) map.set(dateKey, celebrating);
    }
    return map;
  }, [people, cells]);

  return (
    <PageContainer>
      <PageHeader
        title={t('calendar.title')}
        actions={
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setCursor((c) => addMonths(c, -1))}
              aria-label="‹"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-center text-sm font-medium first-letter:uppercase">
              {format(cursor, 'LLLL yyyy', { locale })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setCursor((c) => addMonths(c, 1))}
              aria-label="›"
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setCursor(startOfMonth(new Date()))}>
              {t('common.today')}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {weekdays.map((wd, i) => (
          <div key={i} className="py-1 text-center text-[11px] font-medium text-muted-foreground uppercase">
            {wd}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((dateKey, i) => {
          if (!dateKey) return <div key={i} className="h-10" />;

          const celebrating = birthdaysByDate.get(dateKey);
          const dayCell = (
            <button
              type="button"
              onClick={() => navigate(`/diary/${dateKey}`)}
              className={cn(
                'relative flex h-10 w-full items-center justify-center rounded-lg border text-[13px] transition-colors',
                dateKey === today
                  ? 'border-foreground/80 bg-foreground/[0.04] font-semibold text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border',
              )}
              style={
                dateKey !== today && byDate.has(dateKey)
                  ? { backgroundColor: heatmapBg(byDate.get(dateKey)!.count, byDate.get(dateKey)!.maxImportance, isDark) }
                  : undefined
              }
            >
              <span className={cn(isHighDensity(byDate.get(dateKey)?.count ?? 0) && 'font-semibold text-foreground')}>
                {Number(dateKey.slice(8))}
              </span>
              {byDate.has(dateKey) && (
                <span
                  className={cn(
                    'absolute top-[3px] right-1 size-1 rounded-full',
                    importanceDotClass(byDate.get(dateKey)!.maxImportance),
                  )}
                />
              )}
              {celebrating && (
                <Cake className="absolute top-[3px] left-[3px] size-3.5 text-pink-500 dark:text-pink-400" />
              )}
            </button>
          );

          if (!celebrating) return <div key={i}>{dayCell}</div>;

          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>{dayCell}</TooltipTrigger>
              <TooltipContent>
                <ul>
                  {celebrating.map((person) => {
                    // Age on that day, not today — hovering a past or future birthday should
                    // show how old they were/will be then.
                    const age = ageOn(person.birthday, parseDateKey(dateKey));
                    return (
                      <li key={person.id}>
                        {age === null
                          ? t('calendar.birthdayOf', { name: person.name })
                          : t('calendar.birthdayOfWithAge', { name: person.name, age })}
                      </li>
                    );
                  })}
                </ul>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col items-center gap-2 border-t pt-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{t('common.less')}</span>
          <div className="flex gap-0.5">
            {[0, 0.08, 0.18, 0.32, 0.5].map((op, i) => (
              <div
                key={i}
                className="size-3.5 rounded-sm border"
                style={{
                  backgroundColor: op === 0 ? 'transparent' : isDark
                    ? `rgba(255, 255, 255, ${op})`
                    : `rgba(23, 23, 23, ${op})`,
                  borderColor: 'var(--border)',
                }}
              />
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground">{t('common.more')}</span>
        </div>
        <div className="flex max-w-3/5 flex-wrap justify-center gap-x-3 gap-y-1">
          {[1, 2, 3, 4, 5].map((level) => (
            <div key={level} className="flex items-center gap-1">
              <span className={cn('size-1 rounded-full', importanceDotClass(level))} />
              <span className="text-[10px] text-muted-foreground">{t(`importance.levels.${level}`)}</span>
            </div>
          ))}
          {birthdaysByDate.size > 0 && (
            <div className="flex items-center gap-1">
              <Cake className="size-3 text-pink-500 dark:text-pink-400" />
              <span className="text-[10px] text-muted-foreground">{t('diary.birthdays')}</span>
            </div>
          )}
        </div>
      </div>

      {onThisDay && onThisDay.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-importance-2" />
            {t('calendar.onThisDay')}
          </h2>
          <ul className="flex flex-col gap-2">
            {onThisDay.map((entry) => (
              <li key={entry.id} className="rounded-xl border bg-card p-3 shadow-xs">
                <EntryRow entry={entry} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        <Link to={`/diary/${today}`} className="underline-offset-2 hover:underline">
          {t('common.today')} →
        </Link>
      </p>
    </PageContainer>
  );
}