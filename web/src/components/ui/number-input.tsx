import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface NumberInputProps {
  value: number;
  /** Fires on every edit, including the NaN a field briefly holds while it is empty. */
  onChange: (value: number) => void;
  /** Fires when the value is settled: a step, or the field losing focus. */
  onCommit?: () => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  stepDownLabel?: string;
  stepUpLabel?: string;
}

/**
 * A number field with its own − / + buttons in place of the browser's spinners, which are a
 * different size and shape in every engine, vanish entirely on touch, and can't be styled.
 *
 * The split between `onChange` and `onCommit` is what lets the Settings page save without a Save
 * button: typing is a draft edit, while stepping or leaving the field is the user saying they
 * meant it. An empty field is a legitimate intermediate state — you have to clear `180` before
 * you can type `365` — so it reports NaN through onChange and restores the last good value on
 * blur rather than fighting the user mid-edit.
 */
export function NumberInput({
  value,
  onChange,
  onCommit,
  min = 0,
  max,
  step = 1,
  id,
  disabled = false,
  className,
  'aria-label': ariaLabel,
  stepDownLabel,
  stepUpLabel,
}: NumberInputProps) {
  const lastValid = useRef(value);

  useEffect(() => {
    if (Number.isFinite(value)) lastValid.current = value;
  }, [value]);

  const clamp = (next: number) => Math.min(max ?? Infinity, Math.max(min, Math.round(next)));

  const stepBy = (delta: number) => {
    onChange(clamp((Number.isFinite(value) ? value : lastValid.current) + delta));
    onCommit?.();
  };

  const atMin = Number.isFinite(value) && value <= min;
  const atMax = max !== undefined && Number.isFinite(value) && value >= max;

  return (
    <div
      className={cn(
        'inline-flex h-8 w-28 items-center rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled || atMin}
        aria-label={stepDownLabel}
        className="flex size-7 shrink-0 items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        onClick={() => stepBy(-step)}
      >
        <Minus className="size-3.5" />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        disabled={disabled}
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        onBlur={() => {
          if (!Number.isFinite(value)) onChange(lastValid.current);
          onCommit?.();
        }}
        /* The spinners are hidden rather than merely covered: left visible they'd sit inside the
           field next to our own buttons. */
        className="w-full min-w-0 bg-transparent text-center text-sm tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled || atMax}
        aria-label={stepUpLabel}
        className="flex size-7 shrink-0 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        onClick={() => stepBy(step)}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
