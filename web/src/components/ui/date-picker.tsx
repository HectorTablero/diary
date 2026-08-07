import { CalendarDays } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatDateKey, todayKey } from '@/lib/dates';
import { cn } from '@/lib/utils';

interface DatePickerProps {
  /** YYYY-MM-DD, or '' for empty. */
  value: string;
  onChange: (value: string) => void;
  /** Inclusive bounds passed through to the grid. */
  min?: string;
  max?: string;
  /** The other end of the range this field is half of — makes the grid preview the whole span. */
  rangeAnchor?: string;
  id?: string;
  /** Shown in place of a date when the value is empty. */
  placeholder?: string;
  /** Offers a "Clear" action in the popover footer. Only for genuinely optional dates. */
  clearable?: boolean;
  disabled?: boolean;
  /** 'sm' is the h-7 inline variant used in toolbars; 'default' matches an <Input>. */
  size?: 'sm' | 'default';
  align?: 'start' | 'center' | 'end';
  className?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  /** Id of the element describing this field — its hint, or the reason it is invalid. Listed
      explicitly like the two above: this component does not spread arbitrary props, so an aria-*
      attribute that isn't named here is dropped without warning. */
  'aria-describedby'?: string;
  /**
   * Opens the same calendar from something that isn't a field — the diary's own date heading.
   * Same escape hatch `EntityPicker` offers, and for the same reason: the popover and its
   * calendar are the reusable part, the field-shaped button is not. Must be a single element
   * that forwards ref and props (Radix `asChild`); when set, `size`, `placeholder` and the
   * built-in label are unused.
   */
  trigger?: React.ReactNode;
}

/**
 * Replaces `<input type="date">`. The native control is a different widget in every
 * browser and on Android renders a full-screen Material dialog, so nothing about it could be
 * made to match the rest of the app — this is the app's own calendar in a popover instead.
 *
 * The value stays the same `YYYY-MM-DD` string the native input produced, so callers only swap
 * `e.target.value` for the value argument.
 */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  rangeAnchor,
  id,
  placeholder,
  clearable = false,
  disabled = false,
  size = 'default',
  align = 'start',
  className,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  trigger,
}: DatePickerProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);

  // Short numeric form in the tight variant, spelled-out month where there's room for it.
  const label = value ? formatDateKey(value, i18n.language, size === 'sm' ? 'P' : 'PP') : '';

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Portal into the enclosing Dialog (if any) so this survives Radix's scroll-lock —
        // see PopoverContent's `container` doc.
        if (next) {
          setDialogContainer(triggerRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
        }
      }}
    >
      <PopoverTrigger asChild ref={triggerRef}>
        {trigger ?? (
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className={cn(
            'flex w-full min-w-0 items-center gap-1.5 rounded-lg border border-input bg-transparent text-left transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:border-ring aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
            size === 'sm' ? 'h-7 gap-1 px-2 text-xs' : 'h-8 px-2.5 text-sm',
            className,
          )}
        >
          <CalendarDays className={cn('shrink-0 text-muted-foreground', size === 'sm' ? 'size-3.5' : 'size-4')} />
          <span className={cn('flex-1 truncate', !value && 'text-muted-foreground')}>
            {label || placeholder || t('common.selectDate')}
          </span>
        </button>
        )}
      </PopoverTrigger>
      {/* collisionPadding keeps the popover off the screen edges on a phone, where the trigger is
          often flush with the viewport; the available-height variable Radix sets alongside it lets
          the content scroll instead of being clipped when it opens near the bottom. */}
      <PopoverContent
        container={dialogContainer}
        align={align}
        collisionPadding={12}
        className="max-h-[var(--radix-popover-content-available-height)] w-auto max-w-[calc(100vw-1.5rem)] overflow-y-auto"
      >
        <Calendar
          value={value}
          min={min}
          max={max}
          rangeAnchor={rangeAnchor}
          onSelect={(dateKey) => {
            onChange(dateKey);
            setOpen(false);
          }}
        />
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <button
            type="button"
            className="rounded-md px-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              onChange(todayKey());
              setOpen(false);
            }}
          >
            {t('common.today')}
          </button>
          {clearable && value && (
            <button
              type="button"
              className="rounded-md px-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              {t('common.clear')}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
