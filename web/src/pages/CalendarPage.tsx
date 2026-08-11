import type { PersonDto } from '@diary/shared';
import { addMonths, endOfMonth, format, getDay, startOfMonth } from 'date-fns';
import { BookOpen, Cake, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useCalendarMonth, useOnThisDay, usePeople } from '@/api/hooks';
import { useImportanceMarkerClass } from '@/components/entry/ImportanceDot';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { EntryRow } from '@/components/person/EntryRow';
import { HintTooltip } from '@/components/common/HintTooltip';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ageOn, birthdaysOn } from '@/lib/birthday';
import { capitalize, dateFnsLocale, parseDateKey, todayKey, weekdayName } from '@/lib/dates';
import { useWeekStart } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { PluginCalendarSlot } from '@/plugins/PluginCalendarSlot';
import { findPlugin } from '@/plugins/registry';
import type { PluginCalendarDay } from '@/plugins/types';
import { usePluginCalendarViews } from '@/plugins/usePluginCalendarViews';

/** The default view: the diary's own heatmap, keyed the same way a plugin id would be so it can
    share the `view` state and the `<Tabs>` value with the plugin views beside it. Reserved — no
    plugin may ever register the id "entries", or its tab would silently take this one's place. */
const ENTRIES_VIEW = 'entries';

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
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

/* A single hue, deliberately outside the five used for importance above — a cell tinted violet
   reads at a glance as "not the entries heatmap" without needing a caption to say so, whichever
   plugin's data happens to be showing. Opacity still carries the same "how much" the entries
   heatmap uses opacity for, just against `level` (0..1) rather than a raw count. */
const PLUGIN_HEATMAP_RGB = { light: '124, 58, 237', dark: '196, 165, 255' };

function pluginHeatmapBg(level: number, isDark: boolean): string {
  const opacity = Math.min(0.55, 0.12 + Math.max(0, level) * 0.43);
  return `rgba(${isDark ? PLUGIN_HEATMAP_RGB.dark : PLUGIN_HEATMAP_RGB.light}, ${opacity})`;
}

function isHighDensity(count: number): boolean {
  return count >= 6;
}

export default function CalendarPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isDark = useIsDark();
  const markerClass = useImportanceMarkerClass();
  const weekStart = useWeekStart();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  const { data: days } = useCalendarMonth(year, month);
  const { data: onThisDay } = useOnThisDay(todayKey());
  const { data: people } = usePeople();

  const byDate = useMemo(() => new Map((days ?? []).map((d) => [d.date, d])), [days]);
  const locale = dateFnsLocale(i18n.language);
  const today = todayKey();

  /* --- The view switcher --------------------------------------------------------------------- */

  const pluginViews = usePluginCalendarViews();
  const [view, setView] = useState<string>(ENTRIES_VIEW);
  const activePlugin = view === ENTRIES_VIEW ? undefined : findPlugin(view);

  // A plugin disabled (or a chunk that failed) while its tab was open falls back to the entries
  // view rather than leaving the switcher pointed at a tab that no longer exists.
  useEffect(() => {
    if (view !== ENTRIES_VIEW && !pluginViews.some((v) => v.id === view)) setView(ENTRIES_VIEW);
  }, [pluginViews, view]);

  const { monthStart, monthEnd } = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const lastDay = endOfMonth(cursor).getDate();
    return {
      monthStart: `${year}-${pad(month)}-01`,
      monthEnd: `${year}-${pad(month)}-${pad(lastDay)}`,
    };
  }, [cursor, year, month]);

  const [pluginData, setPluginData] = useState<ReadonlyMap<string, PluginCalendarDay> | null>(null);
  // Cleared on every switch — of tab or of month — so a cell never shows last month's, or another
  // plugin's, data for the beat before the new one arrives. Keyed on `view` itself rather than on
  // `activePlugin`: `findPlugin` promises a manifest, not a stable *reference* to one across calls,
  // and this effect would otherwise re-arm on every render whose lookup happened to return a new
  // object — wiping out `onData` in the same tick it just delivered data.
  useEffect(() => {
    setPluginData(null);
  }, [view, monthStart, monthEnd]);

  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const last = endOfMonth(cursor);
    const leading = (getDay(first) - weekStart + 7) % 7;
    const result: (string | null)[] = Array(leading).fill(null);
    for (let d = 1; d <= last.getDate(); d++) {
      result.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [cursor, year, month, weekStart]);

  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        weekdayName((weekStart + i) % 7, i18n.language, 'EEEEEE'),
      ),
    [i18n.language, weekStart],
  );

  // Anniversaries for the visible month only — birthdaysOn ignores the stored year, so a
  // birthday recorded as `--07-13` lands on 13 July of whichever year is on screen.
  const birthdaysByDate = useMemo(() => {
    const map = new Map<string, PersonDto[]>();
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
              aria-label={t('calendar.previous')}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-center text-sm font-medium">
              {capitalize(format(cursor, 'LLLL yyyy', { locale }))}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setCursor((c) => addMonths(c, 1))}
              aria-label={t('calendar.next')}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setCursor(startOfMonth(new Date()))}
            >
              {t('common.today')}
            </Button>
          </div>
        }
      />

      {/* Only rendered once some plugin has something of its own to show here — the same posture
          as the rest of the plugin surface: nobody who has no plugins on ever sees the switch, or
          pays for the hook that would decide whether to show it. */}
      {pluginViews.length > 0 && (
        <Tabs value={view} onValueChange={setView} className="mb-3">
          <TabsList>
            <TabsTrigger value={ENTRIES_VIEW} className="gap-1.5">
              <BookOpen className="size-3.5" aria-hidden />
              {t('calendar.entries')}
            </TabsTrigger>
            {pluginViews.map((pluginView) => (
              <TabsTrigger key={pluginView.id} value={pluginView.id} className="gap-1.5">
                <pluginView.icon className="size-3.5" aria-hidden />
                {pluginView.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {activePlugin && (
        <PluginCalendarSlot
          key={activePlugin.id}
          plugin={activePlugin}
          start={monthStart}
          end={monthEnd}
          onData={setPluginData}
        />
      )}

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {weekdays.map((wd, i) => (
          <div
            key={i}
            className="py-1 text-center text-[11px] font-medium text-muted-foreground uppercase"
          >
            {wd}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((dateKey, i) => {
          if (!dateKey) return <div key={i} className="h-10" />;

          const celebrating = birthdaysByDate.get(dateKey);
          const entryDay = view === ENTRIES_VIEW ? byDate.get(dateKey) : undefined;
          const pluginDay = view === ENTRIES_VIEW ? undefined : pluginData?.get(dateKey);

          const cellBg =
            dateKey === today
              ? undefined
              : view === ENTRIES_VIEW
                ? entryDay
                  ? heatmapBg(entryDay.count, entryDay.maxImportance, isDark)
                  : undefined
                : pluginDay
                  ? pluginHeatmapBg(pluginDay.level, isDark)
                  : undefined;

          const bold =
            view === ENTRIES_VIEW
              ? isHighDensity(entryDay?.count ?? 0)
              : (pluginDay?.level ?? 0) >= 1;

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
              style={cellBg !== undefined ? { backgroundColor: cellBg } : undefined}
            >
              <span className={cn(bold && 'font-semibold text-foreground')}>
                {Number(dateKey.slice(8))}
              </span>
              {view === ENTRIES_VIEW && entryDay && (
                <span
                  className={cn(
                    'absolute top-[3px] right-1 size-1.5',
                    markerClass(entryDay.maxImportance),
                  )}
                />
              )}
              {celebrating && (
                <Cake className="absolute top-[3px] left-[3px] size-3.5 text-pink-500 dark:text-pink-400" />
              )}
            </button>
          );

          if (!celebrating && !pluginDay) return <div key={i}>{dayCell}</div>;

          /* No tooltip on the phone (a touch can't open one) — but nothing is lost: tapping the
             day opens the diary page, which lists that day's birthdays in full, and a plugin's own
             page carries the same numbers for whichever day was tapped. */
          return (
            <HintTooltip
              key={i}
              content={
                <ul>
                  {celebrating?.map((person) => {
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
                  {pluginDay && <li>{pluginDay.label}</li>}
                </ul>
              }
            >
              {dayCell}
            </HintTooltip>
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
                  backgroundColor:
                    op === 0
                      ? 'transparent'
                      : view === ENTRIES_VIEW
                        ? isDark
                          ? `rgba(255, 255, 255, ${op})`
                          : `rgba(23, 23, 23, ${op})`
                        : `rgba(${isDark ? PLUGIN_HEATMAP_RGB.dark : PLUGIN_HEATMAP_RGB.light}, ${op})`,
                  borderColor: 'var(--border)',
                }}
              />
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground">{t('common.more')}</span>
        </div>
        <div className="flex max-w-3/5 flex-wrap justify-center gap-x-3 gap-y-1">
          {/* The importance dots only mean something against the entries heatmap they were drawn
              for — a plugin's "level" has no such breakdown, so the legend below it drops to just
              the opacity gradient and (still relevant either way) the birthday marker. */}
          {view === ENTRIES_VIEW &&
            [1, 2, 3, 4, 5].map((level) => (
              <div key={level} className="flex items-center gap-1">
                <span className={cn('size-1.5', markerClass(level))} />
                <span className="text-[10px] text-muted-foreground">
                  {t(`importance.levels.${level}`)}
                </span>
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
