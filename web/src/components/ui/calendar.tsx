import { addDays, addMonths, addYears, format, getDaysInMonth, startOfMonth } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  capitalize,
  dateFnsLocale,
  parseDateKey,
  toDateKey,
  todayKey,
  weekdayName,
} from '@/lib/dates';
import { useWeekStart } from '@/lib/preferences';
import { cn } from '@/lib/utils';

interface CalendarProps {
  /** Selected day as a YYYY-MM-DD key, or '' for nothing selected. */
  value: string;
  onSelect: (dateKey: string) => void;
  /** Inclusive bounds. Days outside them render disabled rather than disappearing. */
  min?: string;
  max?: string;
  /**
   * The fixed opposite end of a range this grid edits one half of. When set, the span between it
   * and the day under the pointer is painted as the user moves — the booking-site behaviour,
   * where you see the range you are about to choose before committing to it.
   */
  rangeAnchor?: string;
  className?: string;
}

/**
 * Month grid, laid out like the one on the Calendar page so the app only ever shows one shape of
 * calendar. Date keys are compared as strings throughout — `YYYY-MM-DD` sorts chronologically,
 * which makes the range checks exact and timezone-proof in a way Date comparisons are not.
 */
export function Calendar({ value, onSelect, min, max, rangeAnchor, className }: CalendarProps) {
  const { t, i18n } = useTranslation();
  const locale = dateFnsLocale(i18n.language);
  const weekStart = useWeekStart();
  const today = todayKey();

  const [month, setMonth] = useState(() => startOfMonth(parseDateKey(value || today)));
  const [pickingMonth, setPickingMonth] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  /* The cell that owns the grid's single tab stop. Roving tabindex, so Tab enters the grid once
     and the arrow keys move within it — the pattern a native date field would give us for free. */
  const [cursor, setCursor] = useState(value || today);
  const gridRef = useRef<HTMLDivElement>(null);
  const movedByKeyboard = useRef(false);

  // Follow the selection when it changes from outside (a form reset, the other end of a range).
  useEffect(() => {
    if (!value) return;
    setMonth(startOfMonth(parseDateKey(value)));
    setCursor(value);
  }, [value]);

  const outOfRange = (dateKey: string) =>
    (min !== undefined && min !== '' && dateKey < min) ||
    (max !== undefined && max !== '' && dateKey > max);

  const cells = useMemo(() => {
    const first = startOfMonth(month);
    const leading = (first.getDay() - weekStart + 7) % 7;
    const days: (string | null)[] = Array<null>(leading).fill(null);
    for (let day = 0; day < getDaysInMonth(first); day++) days.push(toDateKey(addDays(first, day)));
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [month, weekStart]);

  /* The painted span runs from the fixed end of the range to whichever day the user is pointing
     at — falling back to the committed value, so reopening the picker still shows the range.
     Either end may be the earlier one: the "from" field is edited with "to" as its anchor and
     vice versa, so the two are sorted rather than assumed. */
  const active = hovered ?? (value || null);
  const span = useMemo(() => {
    if (!rangeAnchor || !active) return null;
    return rangeAnchor <= active
      ? { from: rangeAnchor, to: active }
      : { from: active, to: rangeAnchor };
  }, [rangeAnchor, active]);

  /* In range mode the grid is already carrying two highlights — the span and its two ends — so
     outlining today on top of them reads as a third kind of selection rather than a landmark.
     Ranges are picked relative to each other, not relative to today, so it's dropped there. */
  const markToday = rangeAnchor === undefined;

  /* The grid needs exactly one tab stop. When the cursor is on a day the visible month doesn't
     contain — after paging with the arrows — hand it to the first day of that month instead, so
     Tab can still reach the grid. */
  const tabStop = cells.includes(cursor) ? cursor : cells.find((cell) => cell !== null);

  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        weekdayName((weekStart + i) % 7, i18n.language, 'EEEEEE'),
      ),
    [weekStart, i18n.language],
  );

  /* Focus follows the cursor only when the keyboard moved it — doing it on every change would
     yank focus away from the trigger as the popover opens. */
  useLayoutEffect(() => {
    if (!movedByKeyboard.current) return;
    movedByKeyboard.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${cursor}"]`)?.focus();
  }, [cursor]);

  const moveCursor = (next: Date) => {
    const key = toDateKey(next);
    movedByKeyboard.current = true;
    setCursor(key);
    // Keyboard navigation drives the range preview too, so it isn't a mouse-only affordance.
    setHovered(key);
    // Stepping off the edge of the grid pages the month, like a spreadsheet.
    if (key.slice(0, 7) !== toDateKey(month).slice(0, 7)) setMonth(startOfMonth(next));
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const from = parseDateKey(cursor);
    const step: Record<string, () => Date> = {
      ArrowLeft: () => addDays(from, -1),
      ArrowRight: () => addDays(from, 1),
      ArrowUp: () => addDays(from, -7),
      ArrowDown: () => addDays(from, 7),
      Home: () => addDays(from, -((from.getDay() - weekStart + 7) % 7)),
      End: () => addDays(from, 6 - ((from.getDay() - weekStart + 7) % 7)),
      PageUp: () => addMonths(from, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(from, event.shiftKey ? 12 : 1),
    };
    const next = step[event.key];
    if (!next) return;
    event.preventDefault();
    moveCursor(next());
  };

  // Spanish and Italian month names come out lowercase; every language wants a capital here.
  const title = capitalize(format(month, 'LLLL yyyy', { locale }));

  return (
    /* 16.5rem is exactly seven 2.25rem cells plus the row gaps — the grid sets the width, rather
       than the width squeezing the grid. */
    <div className={cn('flex w-[16.5rem] max-w-full flex-col gap-2', className)}>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('calendar.previous')}
          onClick={() => setMonth((m) => (pickingMonth ? addYears(m, -1) : addMonths(m, -1)))}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 flex-1 font-medium"
          aria-expanded={pickingMonth}
          onClick={() => setPickingMonth((open) => !open)}
        >
          <span className="truncate">{pickingMonth ? format(month, 'yyyy') : title}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('calendar.next')}
          onClick={() => setMonth((m) => (pickingMonth ? addYears(m, 1) : addMonths(m, 1)))}
        >
          <ChevronRight />
        </Button>
      </div>

      {pickingMonth ? (
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, index) => {
            const candidate = new Date(month.getFullYear(), index, 1);
            const selected = index === month.getMonth();
            return (
              <button
                key={index}
                type="button"
                onClick={() => {
                  setMonth(candidate);
                  setPickingMonth(false);
                }}
                className={cn(
                  'h-8 rounded-lg text-xs transition-colors',
                  selected
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {capitalize(format(candidate, 'LLL', { locale }))}
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-7" aria-hidden>
            {weekdays.map((weekday, index) => (
              <div
                key={index}
                className="py-0.5 text-center text-[11px] font-medium text-muted-foreground uppercase"
              >
                {weekday}
              </div>
            ))}
          </div>

          {/* No column gap: the range track is painted on the cell wrappers, and a gap between
              them would chop it into disconnected blocks. The day buttons keep their own size. */}
          <div
            ref={gridRef}
            className="grid grid-cols-7 gap-y-0.5"
            onKeyDown={handleKeyDown}
            onMouseLeave={() => setHovered(null)}
          >
            {cells.map((dateKey, index) => {
              if (!dateKey) return <div key={index} className="h-9" />;
              const disabled = outOfRange(dateKey);
              const selected = dateKey === value;
              const isAnchor = dateKey === rangeAnchor;
              const inSpan = span !== null && dateKey >= span.from && dateKey <= span.to;

              return (
                <div
                  key={dateKey}
                  className={cn(
                    'flex justify-center',
                    inSpan && 'bg-primary/10',
                    inSpan && dateKey === span.from && 'rounded-l-lg',
                    inSpan && dateKey === span.to && 'rounded-r-lg',
                  )}
                >
                  <button
                    type="button"
                    data-date={dateKey}
                    disabled={disabled}
                    aria-pressed={selected}
                    tabIndex={dateKey === tabStop ? 0 : -1}
                    onClick={() => onSelect(dateKey)}
                    onFocus={() => setCursor(dateKey)}
                    onMouseEnter={() => setHovered(dateKey)}
                    className={cn(
                      'size-9 rounded-lg border border-transparent text-[13px] transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30',
                      selected
                        ? 'bg-primary font-medium text-primary-foreground'
                        : isAnchor
                          ? 'bg-primary/25 font-medium text-foreground'
                          : markToday && dateKey === today
                            ? 'border-foreground/80 font-semibold text-foreground'
                            : 'text-muted-foreground hover:border-border',
                    )}
                  >
                    {Number(dateKey.slice(8))}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
