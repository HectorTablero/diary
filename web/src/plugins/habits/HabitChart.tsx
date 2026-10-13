import { differenceInCalendarDays } from 'date-fns';
import type { TFunction } from 'i18next';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { capitalize, formatDateKey, parseDateKey } from '@/lib/dates';
import { useWeekStart } from '@/lib/preferences';
import { useContainerWidth } from '@/lib/useContainerWidth';
import { habitChanges, type HabitChange } from './changes';
import {
  bucketize,
  habitLifetime,
  pickGrain,
  streakRuns,
  type Bucket,
  type ChartDay,
  type Grain,
  type Run,
} from './chart';
import { MOOD_ICONS } from './HabitControls';
import {
  configAt,
  formatDuration,
  formatHabitValue,
  isCheckbox,
  MOOD_LEVELS,
  scaleBounds,
  scheduleAt,
  type Habit,
} from './model';

/**
 * A habit's whole life as one chart: zoom with the wheel or a pinch, drag to move, hover (or tap)
 * any part of it to read it.
 *
 * Drawn to suit the kind, because the question differs:
 *   binary / task   did it happen — every streak as one bar, with misses as ticks between them
 *                   and the days a task was owed (the day it fell due included) in amber
 *   numeric / time  how much — bars, with the goal in force at the time as a dashed step
 *   scale / mood    how it went — an area for a scale, columns for mood's five steps; a day left
 *                   unrated counts as zero, and mood's faces sit above that zero line as its axis
 *
 * Plain SVG, for the reason the expenses charts give, sized in real pixels rather than stretched so
 * text and gaps stay crisp. Only what is on screen is aggregated: zoomed out, days are grouped into
 * weeks or months — the finest grouping that still leaves each mark a few pixels — and a quantity's
 * axis fits what is in view, so a quiet month is not flattened under last year's best week.
 */

const HEIGHT = 200;
const AXIS = 44;
const TOP = 10;
const MIN_SPAN = 7;
/** One lane of streaks needs far less room than an axis of values. */
const TIMELINE_HEIGHT = 88;
const LANE = TIMELINE_HEIGHT / 2 + 4;
const PRESETS = [
  { days: 30, label: 'chartRange1m' },
  { days: 91, label: 'chartRange3m' },
  { days: 365, label: 'chartRange1y' },
] as const;

interface View {
  from: number;
  to: number;
}

interface Point {
  x: number;
  y: number;
}

/** 1, 2 or 5 times a power of ten, at or above `value` — a top for the axis that reads cleanly. */
const niceCeil = (value: number) => {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find((step) => step * power >= value) ?? 10) * power;
};

export function HabitChart({
  habit,
  history,
  today,
}: {
  habit: Habit;
  history: ReadonlyMap<string, Record<string, number>>;
  today: string;
}) {
  const { t, i18n } = useTranslation();
  const weekStart = useWeekStart();
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const plotRef = useRef<HTMLDivElement | null>(null);

  const days = useMemo(() => habitLifetime(habit, history, today), [habit, history, today]);
  const changes = useMemo(
    () => habitChanges(habit, t, i18n.language, weekStart),
    [habit, t, i18n.language, weekStart],
  );
  const n = days.length;
  const minSpan = Math.min(n, MIN_SPAN);

  const clamp = (from: number, to: number): View => {
    const span = Math.min(n, Math.max(minSpan, to - from));
    const start = Math.max(0, Math.min(from, n - span));
    return { from: start, to: start + span };
  };

  const [view, setView] = useState<View>({ from: 0, to: n });
  const viewRef = useRef(view);
  viewRef.current = view;
  // A sync can lengthen the lifetime under an open chart; keep the view inside it.
  useEffect(() => setView((current) => clamp(current.from, current.to)), [n]); // eslint-disable-line react-hooks/exhaustive-deps

  const [hover, setHover] = useState<Point | null>(null);
  const plotW = Math.max(1, width - AXIS);
  const span = view.to - view.from;
  const xOf = (index: number) => AXIS + ((index - view.from) / span) * plotW;
  const indexAt = (px: number, at: View = view) =>
    at.from + ((px - AXIS) / plotW) * (at.to - at.from);

  const checkbox = isCheckbox(habit.type);
  const rating = habit.type === 'scale' || habit.type === 'mood';
  // Mood is five steps, so a column per day reads as a level; a scale's finer range reads as a line.
  const area = habit.type === 'scale';
  const timeline = checkbox;
  const height = timeline ? TIMELINE_HEIGHT : HEIGHT;
  const grain: Grain = timeline ? 'day' : pickGrain(span, plotW);
  const buckets = useMemo(
    () => (timeline ? [] : bucketize(habit, days, view.from, view.to, grain, weekStart)),
    [timeline, habit, days, view.from, view.to, grain, weekStart],
  );
  const runs = useMemo(() => (timeline ? streakRuns(days) : []), [timeline, days]);

  /* --- Scale ------------------------------------------------------------------------------------ */

  const yMax = useMemo(() => {
    if (checkbox || rating) return 1;
    const top = Math.max(0, ...buckets.flatMap((b) => [b.y ?? 0, b.target ?? 0]));
    // Time is stored in seconds and read in minutes, so its round numbers are minutes.
    return habit.type === 'time' ? niceCeil(top / 60) * 60 : niceCeil(top);
  }, [buckets, checkbox, rating, habit.type]);
  const yOf = (value: number) => HEIGHT - (value / yMax) * (HEIGHT - TOP);

  /** The horizontal guides and what the axis says beside each. */
  const guides = ((): { y: number; label: ReactNode }[] => {
    if (timeline) return [];
    if (habit.type === 'mood') {
      // The faces themselves, worst at the bottom: the axis is the control's own vocabulary.
      return [
        { y: yOf(0), label: '' },
        ...MOOD_ICONS.map((Icon, i) => ({
          y: yOf((i + 1) / MOOD_LEVELS),
          label: <Icon x={AXIS - 22} y={yOf((i + 1) / MOOD_LEVELS) - 7} width={14} height={14} />,
        })),
      ];
    }
    if (habit.type === 'scale') {
      // Today's bounds. Values are plotted as a share of the scale they were recorded on, so an
      // older stretch on different bounds still lines up; the readout gives its real numbers.
      const { min, max } = scaleBounds(habit);
      return [0, min, Math.round((min + max) / 2), max].map((value) => ({
        y: yOf(value / max),
        label: value,
      }));
    }
    const text = (value: number) =>
      checkbox
        ? new Intl.NumberFormat(i18n.language, { style: 'percent' }).format(value)
        : habit.type === 'time'
          ? formatDuration(value, false)
          : new Intl.NumberFormat(i18n.language, { notation: 'compact' }).format(value);
    return [0, 0.5, 1].map((step) => ({ y: yOf(yMax * step), label: text(yMax * step) }));
  })();

  /* --- Gestures --------------------------------------------------------------------------------- */

  const pointers = useRef(new Map<number, number>());
  const gesture = useRef<{ view: View; start: Map<number, number>; moved: boolean } | null>(null);
  const local = (event: { clientX: number; clientY: number }): Point => {
    const rect = plotRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const restartGesture = () => {
    gesture.current = { view: viewRef.current, start: new Map(pointers.current), moved: false };
  };

  // Not React's onWheel: it is passive, and the page must not scroll while the chart zooms.
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const px = local(event).x;
      setView((current) => {
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
          const shift = (event.deltaX / plotW) * (current.to - current.from);
          return clamp(current.from + shift, current.to + shift);
        }
        const factor = Math.exp(event.deltaY * 0.0015);
        const anchor = indexAt(px, current);
        return clamp(
          anchor - (anchor - current.from) * factor,
          anchor + (current.to - anchor) * factor,
        );
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event).x);
    restartGesture();
    setHover(local(event)); // a tap is how a touch screen hovers
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const point = local(event);
    const g = gesture.current;
    if (!pointers.current.has(event.pointerId) || !g) {
      setHover(point);
      return;
    }
    pointers.current.set(event.pointerId, point.x);
    const startSpan = g.view.to - g.view.from;
    const ids = [...pointers.current.keys()].filter((id) => g.start.has(id));

    if (ids.length >= 2) {
      const [a, b] = ids;
      const before = Math.abs(g.start.get(a)! - g.start.get(b)!);
      const after = Math.abs(pointers.current.get(a)! - pointers.current.get(b)!);
      if (before < 10 || after < 10) return;
      const nextSpan = startSpan * (before / after);
      const anchor = indexAt((g.start.get(a)! + g.start.get(b)!) / 2, g.view);
      const from =
        anchor -
        (((pointers.current.get(a)! + pointers.current.get(b)!) / 2 - AXIS) / plotW) * nextSpan;
      g.moved = true;
      setHover(null);
      setView(clamp(from, from + nextSpan));
      return;
    }

    const dx = point.x - (g.start.get(event.pointerId) ?? point.x);
    if (!g.moved && Math.abs(dx) < 4) return;
    g.moved = true;
    setHover(null);
    const shift = (-dx / plotW) * startSpan;
    setView(clamp(g.view.from + shift, g.view.to + shift));
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    // Lifting one finger of a pinch continues as a drag from where things are, not from the start.
    if (pointers.current.size) restartGesture();
    else gesture.current = null;
  };

  /* --- What is under the pointer ---------------------------------------------------------------- */

  const hovered = ((): Bucket | undefined => {
    if (!hover || hover.x < AXIS) return undefined;
    if (timeline) {
      const index = Math.floor(indexAt(hover.x));
      if (index < 0 || index >= n) return undefined;
      return bucketize(habit, days, index, index + 1, 'day', weekStart)[0];
    }
    const index = indexAt(hover.x);
    return buckets.find((b) => index >= b.start && index < b.end);
  })();

  // On the timeline a whole streak answers for any day inside it.
  const hoveredRun = hovered && runs.find((r) => hovered.start >= r.start && hovered.start < r.end);
  const range = hoveredRun ?? hovered;

  const dayIndex = (key: string) =>
    differenceInCalendarDays(parseDateKey(key), parseDateKey(days[0].key));
  const markers = changes
    .map((change) => ({ change, index: dayIndex(change.since) }))
    .filter(({ index }) => index >= Math.floor(view.from) && index <= view.to);

  /* --- Marks ------------------------------------------------------------------------------------ */

  const targetPath = (() => {
    let d = '';
    let open = false;
    for (const b of buckets) {
      if (b.target === undefined) {
        open = false;
        continue;
      }
      d += `${open ? 'L' : 'M'}${xOf(b.start)},${yOf(b.target)} H${xOf(b.end)} `;
      open = true;
    }
    return d;
  })();

  /* Broken wherever nothing was recorded: a shape drawn across a silence would invent a trend.
     One list of runs feeds both the outline and the fill under it. */
  const ratingRuns = (() => {
    const result: { x: number; y: number }[][] = [];
    let current: { x: number; y: number }[] | null = null;
    for (const b of buckets) {
      if (b.y === null) {
        if (b.asked) current = null;
        continue;
      }
      if (!current) result.push((current = []));
      current.push({ x: (xOf(b.start) + xOf(b.end)) / 2, y: yOf(b.y) });
    }
    return result;
  })();
  const ratingPath = ratingRuns
    .map((run) => `M${run.map(({ x, y }) => `${x},${y}`).join(' L')}`)
    .join(' ');
  const ratingArea = ratingRuns
    .map(
      (run) =>
        `M${run[0].x},${height} L${run.map(({ x, y }) => `${x},${y}`).join(' L')} L${run.at(-1)!.x},${height} Z`,
    )
    .join(' ');

  const streaks = (() => {
    if (!timeline) return null;
    const dayW = plotW / span;
    const lo = Math.max(0, Math.floor(view.from));
    const hi = Math.min(n, Math.ceil(view.to));
    const tick = Math.max(1, Math.min(3, dayW * 0.4));
    const marks: ReactNode[] = [];
    for (let i = lo; i < hi; i++) {
      const day = days[i];
      if (day.met) continue;
      if (day.asked && !day.overdueFrom) {
        // A miss: the thing that ended a streak, so it gets a mark of its own.
        marks.push(
          <rect
            key={`miss-${i}`}
            x={xOf(i + 0.5) - tick / 2}
            width={tick}
            y={LANE - 5}
            height={10}
            rx={tick / 2}
            fill="var(--muted-foreground)"
            fillOpacity={0.45}
          />,
        );
      } else if (day.overdueFrom) {
        marks.push(
          <rect
            key={`owed-${i}`}
            x={xOf(i)}
            width={dayW + 0.5}
            y={LANE - 3}
            height={6}
            className="fill-amber-500/50"
          />,
        );
      }
    }
    const gap = Math.min(1, dayW * 0.1);
    for (const run of runs) {
      if (run.end <= view.from || run.start >= view.to) continue;
      const x0 = xOf(run.start) + gap;
      const w = Math.max(1.5, xOf(run.end) - gap - x0);
      const active = hoveredRun === run;
      marks.push(
        <g key={`run-${run.start}`}>
          <rect
            x={x0}
            width={w}
            y={LANE - 10}
            height={20}
            rx={Math.min(6, w / 2)}
            fill="var(--primary)"
            stroke={active ? 'var(--foreground)' : undefined}
            strokeWidth={1.5}
          />
          {w >= 22 && (
            <text
              x={x0 + w / 2}
              y={LANE - 16}
              textAnchor="middle"
              fontSize={10}
              fill={active ? 'var(--foreground)' : 'var(--muted-foreground)'}
              className="tabular-nums"
            >
              {run.met}
            </text>
          )}
        </g>,
      );
    }
    return marks;
  })();

  const ticks = Math.max(2, Math.floor(plotW / 110));
  const tickPattern = span > 400 ? 'MMM yyyy' : 'd MMM';
  const tooltipStyle: CSSProperties | undefined = hover
    ? hover.x > width / 2
      ? { right: Math.max(0, width - hover.x + 12) }
      : { left: Math.min(hover.x + 12, Math.max(0, width - 224)) }
    : undefined;

  return (
    <figure className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {PRESETS.filter((preset) => preset.days < n).map((preset) => (
            <Button
              key={preset.days}
              size="sm"
              variant={Math.round(span) === preset.days ? 'secondary' : 'ghost'}
              className="h-7 px-2 text-xs"
              onClick={() => setView(clamp(n - preset.days, n))}
            >
              {t(`plugins.habits.${preset.label}`)}
            </Button>
          ))}
          <Button
            size="sm"
            variant={span === n ? 'secondary' : 'ghost'}
            className="h-7 px-2 text-xs"
            onClick={() => setView({ from: 0, to: n })}
          >
            {t('plugins.habits.chartRangeAll')}
          </Button>
        </div>
        {!timeline && <span className="text-xs text-muted-foreground">{grainLabel(grain, t)}</span>}
      </div>

      <div ref={ref}>
        <div
          ref={plotRef}
          role="img"
          aria-label={t('plugins.habits.chartLabel', {
            name: habit.name,
            from: formatDateKey(days[0].key, i18n.language, 'PP'),
            to: formatDateKey(days[n - 1].key, i18n.language, 'PP'),
          })}
          className="relative cursor-grab touch-none select-none active:cursor-grabbing"
          style={{ height }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={(event) => event.pointerType === 'mouse' && setHover(null)}
        >
          {width > 0 && (
            <svg width={width} height={height} className="absolute inset-0 overflow-hidden">
              {guides.map(({ y, label }, i) => (
                <g key={i}>
                  <line
                    x1={AXIS}
                    x2={width}
                    y1={y}
                    y2={y}
                    stroke="var(--border)"
                    strokeDasharray={y < HEIGHT ? '2 3' : undefined}
                  />
                  {typeof label === 'object' ? (
                    <g className="text-muted-foreground">{label}</g>
                  ) : (
                    <text
                      x={AXIS - 6}
                      y={y}
                      textAnchor="end"
                      dominantBaseline="middle"
                      fontSize={10}
                      fill="var(--muted-foreground)"
                    >
                      {label}
                    </text>
                  )}
                </g>
              ))}

              <svg x={AXIS} width={plotW} height={height} overflow="hidden">
                <g transform={`translate(${-AXIS},0)`}>
                  {timeline && (
                    <line x1={AXIS} x2={width} y1={LANE} y2={LANE} stroke="var(--border)" />
                  )}
                  {range && (
                    <rect
                      x={xOf(range.start)}
                      width={xOf(range.end) - xOf(range.start)}
                      y={0}
                      height={height}
                      fill="color-mix(in oklab, var(--muted-foreground) 10%, transparent)"
                    />
                  )}

                  {streaks}

                  {!area &&
                    buckets.map((b) => (
                      <Bar
                        key={b.start}
                        bucket={b}
                        habit={habit}
                        x0={xOf(b.start)}
                        x1={xOf(b.end)}
                        yOf={yOf}
                      />
                    ))}

                  {area && (
                    <>
                      <path d={ratingArea} fill="var(--primary)" fillOpacity={0.15} />
                      <path
                        d={ratingPath}
                        fill="none"
                        stroke="var(--primary)"
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      {buckets.map((b) =>
                        b.y === null ? null : (
                          <circle
                            key={b.start}
                            cx={(xOf(b.start) + xOf(b.end)) / 2}
                            cy={yOf(b.y)}
                            r={
                              hovered?.start === b.start
                                ? 5
                                : Math.min(3, (xOf(b.end) - xOf(b.start)) / 3)
                            }
                            fill="var(--primary)"
                            stroke="var(--popover)"
                            strokeWidth={hovered?.start === b.start ? 2 : 0}
                          />
                        ),
                      )}
                    </>
                  )}

                  {targetPath && (
                    <path
                      d={targetPath}
                      fill="none"
                      stroke="var(--foreground)"
                      strokeOpacity={0.55}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                  )}

                  {markers.map(({ change, index }) => {
                    const x = xOf(index);
                    return (
                      <g key={change.since}>
                        <line
                          x1={x}
                          x2={x}
                          y1={TOP}
                          y2={height}
                          stroke="var(--muted-foreground)"
                          strokeOpacity={0.6}
                          strokeDasharray="1 3"
                        />
                        <circle cx={x} cy={TOP / 2 + 1} r={3} fill="var(--muted-foreground)" />
                      </g>
                    );
                  })}
                </g>
              </svg>
            </svg>
          )}

          {hovered && range && tooltipStyle && (
            <Readout
              habit={habit}
              days={days}
              bucket={hovered}
              run={hoveredRun}
              grain={grain}
              changes={markers
                .filter(({ index }) => index >= range.start && index < range.end)
                .map(({ change }) => change)}
              style={tooltipStyle}
            />
          )}
        </div>

        <div
          className="relative mt-1 h-4 text-[10px] text-muted-foreground tabular-nums"
          aria-hidden
        >
          {Array.from({ length: ticks }, (_, k) => {
            const index = Math.min(n - 1, Math.floor(view.from + (span * (k + 0.5)) / ticks));
            return (
              <span
                key={k}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: xOf(index + 0.5) }}
              >
                {formatDateKey(days[index].key, i18n.language, tickPattern)}
              </span>
            );
          })}
        </div>
      </div>

      <figcaption className="text-xs text-muted-foreground">
        {t('plugins.habits.chartHint')}
      </figcaption>
    </figure>
  );
}

function grainLabel(grain: Grain, t: TFunction) {
  switch (grain) {
    case 'week':
      return t('plugins.habits.chartPerWeek');
    case 'month':
      return t('plugins.habits.chartPerMonth');
    default:
      return t('plugins.habits.chartPerDay');
  }
}

function Bar({
  bucket,
  habit,
  x0,
  x1,
  yOf,
}: {
  bucket: Bucket;
  habit: Habit;
  x0: number;
  x1: number;
  yOf: (value: number) => number;
}) {
  const gap = Math.min(2, (x1 - x0) * 0.2);
  const width = Math.max(0.5, x1 - x0 - gap);
  if (!bucket.asked) return null; // never asked: a gap, not a miss
  if (!bucket.y) {
    // Asked and nothing to show for it — a stub on the baseline, so a miss reads as one.
    return (
      <rect x={x0 + gap / 2} width={width} y={HEIGHT - 2} height={2} rx={1} fill="var(--muted)" />
    );
  }
  /* Fainter the fewer of its days met the goal, so a week of near-misses doesn't look like a week
     of goals reached. A checkbox's height already *is* that share. */
  const opacity =
    habit.type === 'numeric' || habit.type === 'time' ? 0.4 + (0.6 * bucket.met) / bucket.asked : 1;
  const top = Math.max(TOP, yOf(bucket.y));
  return (
    <rect
      x={x0 + gap / 2}
      width={width}
      y={top}
      height={HEIGHT - top}
      rx={Math.min(3, width / 3)}
      fill="var(--primary)"
      fillOpacity={opacity}
    />
  );
}

/** What one mark says, in words — the date or range, the value, the goal at the time, any edit. */
function Readout({
  habit,
  days,
  bucket,
  run,
  grain,
  changes,
  style,
}: {
  habit: Habit;
  days: readonly ChartDay[];
  bucket: Bucket;
  /** A streak, read as a whole instead of the one day under the pointer. */
  run?: Run;
  grain: Grain;
  changes: HabitChange[];
  style: CSSProperties;
}) {
  const { t, i18n } = useTranslation();
  const first = days[(run ?? bucket).start].key;
  const last = days[(run ?? bucket).end - 1].key;
  const lines: string[] = [];

  if (run) {
    // The badge's own words, so a streak reads the same on the chart as on the card.
    const everyDay = scheduleAt(habit).kind === 'daily';
    return (
      <ReadoutCard
        title={
          everyDay
            ? t('plugins.habits.streak', { count: run.met })
            : t('plugins.habits.streakOccurrences', { count: run.met })
        }
        lines={[
          run.end - run.start === 1
            ? capitalize(formatDateKey(first, i18n.language, 'EEEE, PP'))
            : `${formatDateKey(first, i18n.language, 'PP')} – ${formatDateKey(last, i18n.language, 'PP')}`,
        ]}
        changes={changes}
        style={style}
      />
    );
  }

  const title =
    grain === 'day'
      ? capitalize(formatDateKey(first, i18n.language, 'EEEE, PP'))
      : grain === 'month'
        ? capitalize(formatDateKey(first, i18n.language, 'LLLL yyyy'))
        : `${formatDateKey(first, i18n.language, 'PP')} – ${formatDateKey(last, i18n.language, 'PP')}`;

  if (grain === 'day') {
    const day = days[bucket.start];
    if (day.value > 0) {
      lines.push(
        capitalize(
          isCheckbox(habit.type)
            ? t('plugins.habits.done')
            : habit.type === 'mood'
              ? `${t(`plugins.habits.mood${day.value}`)} (${formatHabitValue(habit, day.value, day.key)})`
              : formatHabitValue(habit, day.value, day.key),
        ),
      );
    } else if (day.overdueFrom) {
      lines.push(
        t('plugins.habits.overdueSince', {
          date: formatDateKey(day.overdueFrom, i18n.language, 'PP'),
        }),
      );
    } else {
      lines.push(
        capitalize(day.asked ? t('plugins.habits.notDone') : t('plugins.habits.notScheduled')),
      );
    }
  } else if (!bucket.asked && !bucket.overdue) {
    lines.push(capitalize(t('plugins.habits.notScheduled')));
  } else if (isCheckbox(habit.type)) {
    if (bucket.asked)
      lines.push(t('plugins.habits.chartDoneDays', { met: bucket.met, count: bucket.asked }));
    if (bucket.overdue) lines.push(t('plugins.habits.chartOverdueDays', { count: bucket.overdue }));
  } else if (habit.type === 'scale' || habit.type === 'mood') {
    if (bucket.average !== null)
      lines.push(
        t('plugins.habits.chartAverage', {
          value: `${bucket.average.toLocaleString(i18n.language, { maximumFractionDigits: 1 })}/${bucket.max}`,
        }),
      );
    lines.push(
      t('plugins.habits.chartRecordedDays', { recorded: bucket.recorded, count: bucket.asked }),
    );
  } else {
    lines.push(
      t('plugins.habits.chartAverage', {
        value: formatHabitValue(habit, Math.round((bucket.average ?? 0) * 10) / 10, last),
      }),
    );
    if (bucket.target !== undefined)
      lines.push(t('plugins.habits.chartMetDays', { met: bucket.met, count: bucket.asked }));
  }

  if (bucket.target !== undefined)
    lines.push(
      t('plugins.habits.chartGoal', { value: formatHabitValue(habit, bucket.target, last) }),
    );

  // The name it went by then, when that is no longer the one on the card.
  const then = configAt(habit, last).name;
  if (then !== habit.name) lines.push(t('plugins.habits.chartNamedThen', { name: then }));

  return <ReadoutCard title={title} lines={lines} changes={changes} style={style} />;
}

function ReadoutCard({
  title,
  lines,
  changes,
  style,
}: {
  title: string;
  lines: string[];
  changes: HabitChange[];
  style: CSSProperties;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 w-56 rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-md"
      style={style}
    >
      <p className="font-medium">{title}</p>
      {lines.map((line) => (
        <p key={line} className="text-muted-foreground">
          {line}
        </p>
      ))}
      {changes.map((change) => (
        <div key={change.since} className="mt-1.5 border-t pt-1.5">
          <p className="font-medium">
            {t('plugins.habits.chartEdited', {
              date: formatDateKey(change.since, i18n.language, 'PP'),
            })}
          </p>
          {change.lines.map((line) => (
            <p key={line} className="text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
