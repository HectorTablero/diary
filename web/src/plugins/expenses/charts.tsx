import { getDaysInMonth } from 'date-fns';
import { Fragment, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HintTooltip } from '@/components/common/HintTooltip';
import { formatDateKey, parseDateKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { formatMinor } from './currency';
import { useCategoryLabel } from './ExpenseForm';
import type { Category, Expense } from './model';
import { monthOf, type CategoryTotal, type MonthTotal } from './stats';

/**
 * The page's charts, drawn in plain markup and SVG — a month's line, twelve columns and a handful of
 * bars do not need a charting library, and this plugin's chunk is only fetched by people who
 * switched it on, so what it doesn't carry is weight nobody downloads.
 *
 * Gray, all of them. Every chart here is a single series, so colour has no identity to carry, and
 * any hue on a chart of spending reads as a verdict sooner or later — red as "too much", green as
 * "well done". The only distinction drawn is "the month you're looking at" against "the others", by
 * weight of gray. Built from the theme's own muted-foreground token, so light and dark mode each get
 * their own step without a second palette.
 */

const gray = (percent: number) =>
  `color-mix(in oklab, var(--muted-foreground) ${percent}%, transparent)`;

/** A January with a December before it on the chart — where the year turns over. */
const startsYear = (month: string, index: number) => index > 0 && month.endsWith('-01');

/**
 * A hairline where the year turns over, between December and January. Month initials alone repeat
 * every twelve (J, F, M…), so without it the chart gives no hint of which columns belong to which
 * year. The border token rather than a gray step, so it reads as structure, not as data.
 */
function YearDivider({ className }: { className?: string }) {
  return <span aria-hidden className={cn('w-px shrink-0 bg-border', className)} />;
}

export const monthLabel = (month: string, language: string, pattern = 'LLLL yyyy') =>
  formatDateKey(`${month}-01`, language, pattern);

export function MonthlyColumns({
  totals,
  currency,
  selected,
  lastSelectable,
  onSelect,
}: {
  /** Oldest first — see `monthlyTotals`. */
  totals: readonly MonthTotal[];
  currency: string;
  selected: string;
  /** Months after this one haven't happened and can't be picked. */
  lastSelectable: string;
  onSelect?: (month: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const max = Math.max(...totals.map((total) => total.minor), 0);

  return (
    <figure>
      <figcaption className="text-xs font-medium text-muted-foreground">
        {t('plugins.expenses.lastTwelveMonths')}
      </figcaption>
      <div className="mt-3 flex h-36 items-end gap-1 border-b border-border">
        {totals.map(({ month, minor }, i) => {
          const isSelected = month === selected;
          const label = `${monthLabel(month, i18n.language)} · ${formatMinor(minor, currency, i18n.language)}`;
          // Never shorter than a sliver when there is anything at all, so a small month still
          // reads as "something" rather than as a gap.
          const height = max > 0 && minor > 0 ? Math.max(3, (minor / max) * 100) : 0;
          return (
            <Fragment key={month}>
              {startsYear(month, i) && <YearDivider className="self-stretch" />}
              <HintTooltip content={label}>
                <button
                  type="button"
                  disabled={!onSelect || month > lastSelectable}
                  aria-pressed={isSelected}
                  aria-label={label}
                  onClick={() => onSelect?.(month)}
                  // The whole slot is the hit target, not the bar: an empty month is still a month
                  // someone may want to open.
                  className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-t-md focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
                >
                  {isSelected && minor > 0 && (
                    <span className="mb-1 text-[10px] whitespace-nowrap text-muted-foreground tabular-nums">
                      {formatMinor(minor, currency, i18n.language, { compact: true })}
                    </span>
                  )}
                  <span
                    className={cn(
                      'block w-full max-w-6 rounded-t-[4px] transition-[height,background-color]',
                      !isSelected && onSelect && 'group-enabled:group-hover:opacity-80',
                    )}
                    style={{
                      height: `${height}%`,
                      backgroundColor: gray(isSelected ? 100 : 35),
                    }}
                  />
                </button>
              </HintTooltip>
            </Fragment>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1" aria-hidden>
        {totals.map(({ month }, i) => (
          <Fragment key={month}>
            {/* Invisible here: it only holds the divider's width, so each letter stays under its
                own column. */}
            {startsYear(month, i) && <YearDivider className="invisible" />}
            <span
              className={cn(
                'min-w-0 flex-1 text-center text-[10px] text-muted-foreground uppercase',
                month === selected && 'font-semibold text-foreground',
              )}
            >
              {monthLabel(month, i18n.language, 'LLLLL')}
            </span>
          </Fragment>
        ))}
      </div>
    </figure>
  );
}

export function CategoryBars({
  breakdown,
  byId,
  currency,
}: {
  breakdown: readonly CategoryTotal[];
  byId: ReadonlyMap<string, Category>;
  currency: string;
}) {
  const { t, i18n } = useTranslation();
  const labelOf = useCategoryLabel();
  const total = breakdown.reduce((sum, item) => sum + item.minor, 0);
  const max = breakdown[0]?.minor ?? 0;
  const percent = new Intl.NumberFormat(i18n.language, { style: 'percent' });

  return (
    <figure>
      <figcaption className="text-xs font-medium text-muted-foreground">
        {t('plugins.expenses.byCategory')}
      </figcaption>
      <ul className="mt-3 space-y-3">
        {breakdown.map((item) => {
          const category = item.category ? byId.get(item.category) : undefined;
          const Icon = category?.icon;
          return (
            <li key={item.category ?? 'none'}>
              <div className="flex items-center gap-2 text-sm">
                {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{labelOf(category)}</span>
                <span className="shrink-0 tabular-nums">
                  {formatMinor(item.minor, currency, i18n.language)}
                </span>
                <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {percent.format(total > 0 ? item.minor / total : 0)}
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full" aria-hidden>
                <div
                  className="h-full rounded-r-[4px]"
                  style={{
                    width: `${max > 0 ? Math.max(1, (item.minor / max) * 100) : 0}%`,
                    backgroundColor: gray(70),
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

/**
 * The picked month as a running total: how it built up, day by day.
 *
 * Cumulative rather than a bar per day, because a day-by-day chart of spending is mostly a picture
 * of when the rent went out; the running total shows the month's shape — steady, or a few big steps
 * — which is what a month-long view is for. The x axis is always the whole month, so the current
 * month's line stopping at today leaves the rest of the month visibly still to come.
 *
 * Hovering (or dragging a finger) reads out any day: the total so far and what was spent that day.
 * The same figures are in a visually hidden table for screen readers.
 */
export function MonthProgress({
  expenses,
  currency,
  month,
  today,
}: {
  expenses: readonly Expense[];
  currency: string;
  month: string;
  today: string;
}) {
  const { t, i18n } = useTranslation();
  const plotRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const { daily, cumulative, lastDay, daysInMonth } = useMemo(() => {
    const count = getDaysInMonth(parseDateKey(`${month}-01`));
    const perDay = new Array<number>(count).fill(0);
    for (const expense of expenses) {
      if (expense.currency !== currency || monthOf(expense.dateKey) !== month) continue;
      perDay[Number(expense.dateKey.slice(8)) - 1] += expense.minor;
    }
    const running: number[] = [];
    let sum = 0;
    for (const minor of perDay) running.push((sum += minor));
    const currentMonth = monthOf(today);
    const last = month === currentMonth ? Number(today.slice(8)) : month < currentMonth ? count : 0;
    return { daily: perDay, cumulative: running, lastDay: last, daysInMonth: count };
  }, [expenses, currency, month, today]);

  if (lastDay === 0) return null;

  const WIDTH = 300;
  const HEIGHT = 100;
  const max = cumulative[lastDay - 1] || 1;
  // Day d sits at the *end* of its slot, so day 1's spending is already a step up from zero.
  const x = (day: number) => (day / daysInMonth) * WIDTH;
  const y = (minor: number) => HEIGHT - (minor / max) * HEIGHT;
  const points = [
    `${x(0)},${y(0)}`,
    ...cumulative.slice(0, lastDay).map((value, i) => `${x(i + 1)},${y(value)}`),
  ];
  const line = `M${points.join(' L')}`;
  const area = `${line} L${x(lastDay)},${HEIGHT} L${x(0)},${HEIGHT} Z`;

  const dayKey = (day: number) => `${month}-${String(day).padStart(2, '0')}`;
  const shown = hover ?? lastDay;
  const percent = (value: number, of: number) => `${(value / of) * 100}%`;

  const pick = (clientX: number) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const day = Math.ceil(((clientX - rect.left) / rect.width) * daysInMonth);
    setHover(Math.min(lastDay, Math.max(1, day)));
  };

  return (
    <figure>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs font-medium text-muted-foreground">
        <span>{t('plugins.expenses.monthSoFar')}</span>
        {/* The readout: the hovered day, or the latest one while nothing is hovered. */}
        <span className="tabular-nums" aria-hidden>
          <span className="text-foreground">
            {formatMinor(cumulative[shown - 1], currency, i18n.language)}
          </span>
          {' · '}
          {formatDateKey(dayKey(shown), i18n.language, 'd MMM')}
          {daily[shown - 1] > 0 &&
            ` · ${t('plugins.expenses.spentThatDay', {
              amount: formatMinor(daily[shown - 1], currency, i18n.language),
            })}`}
        </span>
      </figcaption>

      <div
        ref={plotRef}
        className="relative mt-3 h-32 touch-pan-y"
        onPointerMove={(event) => pick(event.clientX)}
        onPointerDown={(event) => pick(event.clientX)}
        onPointerLeave={() => setHover(null)}
        aria-hidden
      >
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          <path d={area} fill={gray(12)} />
          <line
            x1={0}
            x2={WIDTH}
            y1={HEIGHT}
            y2={HEIGHT}
            stroke="var(--border)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={line}
            fill="none"
            stroke={gray(100)}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-border"
            style={{ left: percent(x(hover), WIDTH) }}
          />
        )}
        {/* HTML rather than an SVG circle: the plot stretches to its box, which would squash a
            circle into an ellipse. The ring in the card's colour keeps it clear of the line. */}
        <span
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
          style={{
            left: percent(x(shown), WIDTH),
            top: percent(y(cumulative[shown - 1]), HEIGHT),
            backgroundColor: gray(100),
          }}
        />
      </div>

      <div
        className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums"
        aria-hidden
      >
        <span>1</span>
        <span>{Math.ceil(daysInMonth / 2)}</span>
        <span>{daysInMonth}</span>
      </div>

      <table className="sr-only">
        <caption>
          {t('plugins.expenses.monthSoFarTotal', {
            amount: formatMinor(cumulative[lastDay - 1], currency, i18n.language),
          })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('plugins.expenses.dateColumn')}</th>
            <th scope="col">{t('plugins.expenses.amountColumn')}</th>
            <th scope="col">{t('plugins.expenses.runningTotalColumn')}</th>
          </tr>
        </thead>
        <tbody>
          {daily.slice(0, lastDay).map((minor, i) =>
            minor > 0 ? (
              <tr key={i}>
                <td>{formatDateKey(dayKey(i + 1), i18n.language, 'PP')}</td>
                <td>{formatMinor(minor, currency, i18n.language)}</td>
                <td>{formatMinor(cumulative[i], currency, i18n.language)}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </figure>
  );
}
