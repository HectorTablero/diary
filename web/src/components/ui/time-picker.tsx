import { Clock } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatTimeOfDay, parseTimeOfDay } from '@/lib/notificationSchedule';
import { useHour12 } from '@/lib/preferences';
import { cn } from '@/lib/utils';

interface TimePickerProps {
  /** `HH:mm`, always 24-hour regardless of how it is displayed. */
  value: string;
  onChange: (value: string) => void;
  /** Hides earlier hours. Used by the daily nudge, which is meaningless in the morning. */
  minHour?: number;
  /** Minute granularity. 15 keeps the second column to four options. */
  step?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

interface Option {
  value: number;
  label: string;
}

/**
 * One column of the picker: a listbox of options that the arrow keys walk, the way a native
 * select's dropdown behaves. Roving tabindex, so Tab crosses from the hours to the minutes in one
 * press instead of stepping through twenty-four buttons to get there.
 */
function TimeColumn({
  heading,
  options,
  value,
  onSelect,
  className,
}: {
  heading: string;
  options: Option[];
  value: number;
  onSelect: (value: number) => void;
  className?: string;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  const movedByKeyboard = useRef(false);

  /* The current choice, centred, as soon as the popover opens: a twenty-four-row hour list
     otherwise opens at midnight with the selected hour somewhere below the fold, hiding the one
     value the user needs to see to know what they are about to change. */
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  // The keyboard moves the selection itself (like a select, not like a menu), so focus has to
  // follow it onto whichever button just became the selected one.
  useEffect(() => {
    if (!movedByKeyboard.current) return;
    movedByKeyboard.current = false;
    selectedRef.current?.focus();
  }, [value]);

  const index = options.findIndex((option) => option.value === value);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target =
      event.key === 'ArrowDown'
        ? index + 1
        : event.key === 'ArrowUp'
          ? index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? options.length - 1
              : null;
    if (target === null || target < 0 || target >= options.length) return;
    event.preventDefault();
    movedByKeyboard.current = true;
    onSelect(options[target].value);
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="px-1 text-[11px] font-medium text-muted-foreground">{heading}</span>
      {/* Fixed height rather than max-height: a four-option minute column next to a twenty-four
          option hour column would otherwise leave the two lists ending at different places. */}
      <div
        role="listbox"
        aria-label={heading}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex h-48 flex-col gap-0.5 overflow-y-auto scroll-py-1 py-1 pr-1"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={selected ? selectedRef : undefined}
              type="button"
              role="option"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(option.value)}
              className={cn(
                'shrink-0 rounded-lg px-3 py-1.5 text-sm tabular-nums transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                selected
                  ? 'bg-primary font-medium text-primary-foreground'
                  : 'text-foreground hover:bg-accent',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Replaces `<input type="time">`, for the same reason DatePicker replaces `<input type="date">`:
 * the native control is a different widget in every browser, and on Android WebView it opens a
 * full-screen Material dialog in the system's own locale and clock convention — a screen the app
 * has no say over, in the middle of a settings page it otherwise owns completely.
 *
 * So: the app's own trigger button, and a popover holding two columns built from the same pieces
 * as the calendar grid — same rounding, same selected-cell colour, same focus ring.
 *
 * The stored value is always 24-hour `HH:mm`; only the labels follow the user's 12/24h preference,
 * so switching that setting re-reads every time on screen without rewriting any of them.
 */
export function TimePicker({
  value,
  onChange,
  minHour = 0,
  step = 15,
  disabled = false,
  id,
  className,
  'aria-label': ariaLabel,
}: TimePickerProps) {
  const { t, i18n } = useTranslation();
  const hour12 = useHour12();
  const [open, setOpen] = useState(false);
  const { hours, minutes } = parseTimeOfDay(value);

  /* Every label comes from Intl rather than from the locale files: it already knows that English
     writes "11 PM" where Spanish writes "23", so this control needs no strings of its own beyond
     the two column headings. */
  const hourOptions = useMemo<Option[]>(() => {
    const format = new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', hour12 });
    return Array.from({ length: 24 }, (_, hour) => ({
      value: hour,
      label: format.format(new Date(2024, 0, 1, hour)),
    })).filter((option) => option.value >= minHour);
  }, [i18n.language, hour12, minHour]);

  const minuteOptions = useMemo<Option[]>(
    () =>
      Array.from({ length: Math.ceil(60 / step) }, (_, index) => ({
        value: index * step,
        label: `:${String(index * step).padStart(2, '0')}`,
      })),
    [step],
  );

  const label = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        hour: 'numeric',
        minute: '2-digit',
        hour12,
      }).format(new Date(2024, 0, 1, hours, minutes)),
    [i18n.language, hour12, hours, minutes],
  );

  const commit = (nextHours: number, nextMinutes: number) =>
    onChange(formatTimeOfDay({ hours: nextHours, minutes: nextMinutes }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-lg border border-input bg-transparent px-2.5 text-sm tabular-nums transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:border-ring dark:bg-input/30',
            className,
          )}
        >
          <Clock className="size-4 shrink-0 text-muted-foreground" />
          {label}
        </button>
      </PopoverTrigger>
      {/* flex-row explicitly: PopoverContent's own classes include flex-col, and `flex` alone does
          not displace it — they set different properties, so tailwind-merge keeps both and the two
          columns stack into one. */}
      <PopoverContent align="start" collisionPadding={12} className="w-auto flex-row gap-2">
        <TimeColumn
          heading={t('common.hour')}
          options={hourOptions}
          value={hours}
          onSelect={(hour) => commit(hour, minutes)}
        />
        <TimeColumn
          heading={t('common.minute')}
          options={minuteOptions}
          value={minutes}
          onSelect={(minute) => commit(hours, minute)}
        />
      </PopoverContent>
    </Popover>
  );
}
