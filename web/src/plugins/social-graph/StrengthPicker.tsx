import { useTranslation } from 'react-i18next';
import { HintTooltip } from '@/components/common/HintTooltip';
import { cn } from '@/lib/utils';
import { STRENGTHS, type Strength } from './model';

/**
 * How close two people are, in one tap: five segments in the app's segmented-pill look (the period
 * tracker's flow control, ExploreLayout's switcher), with the chosen one named beside it. Each
 * segment is a bar a little taller than the last, so the scale reads without its numbers.
 *
 * `value` of `null` means not connected yet — nothing pressed, and the first pick creates the link.
 */
export function StrengthPicker({
  value,
  onChange,
  disabled,
}: {
  value: Strength | null;
  onChange: (strength: Strength) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="radiogroup"
        aria-label={t('plugins.social-graph.strengthLabel')}
        className="inline-flex items-end gap-0.5 rounded-full bg-muted p-1"
      >
        {STRENGTHS.map((strength) => {
          const name = t(`plugins.social-graph.strength${strength}`);
          const checked = value === strength;
          const filled = value !== null && strength <= value;
          return (
            <HintTooltip key={strength} content={name}>
              <button
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={name}
                disabled={disabled}
                onClick={() => onChange(strength)}
                className={cn(
                  'flex h-8 w-9 items-center justify-center rounded-full transition-colors',
                  checked ? 'bg-background shadow-xs' : 'hover:bg-background/60',
                  disabled && 'pointer-events-none opacity-60',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'w-1.5 rounded-full transition-colors',
                    filled ? 'bg-primary' : 'bg-muted-foreground/50 dark:bg-muted-foreground/60',
                  )}
                  style={{ height: 6 + strength * 3 }}
                />
              </button>
            </HintTooltip>
          );
        })}
      </div>
      <span className="text-sm text-muted-foreground" aria-hidden>
        {value === null
          ? t('plugins.social-graph.strengthUnset')
          : t(`plugins.social-graph.strength${value}`)}
      </span>
    </div>
  );
}

/** The same five bars, read-only and small — for lists that show a link's strength in passing. */
export function StrengthBars({ value, className }: { value: Strength; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t(`plugins.social-graph.strength${value}`)}
      className={cn('inline-flex shrink-0 items-end gap-px', className)}
    >
      {STRENGTHS.map((strength) => (
        <span
          key={strength}
          className={cn(
            'w-[3px] rounded-full',
            strength <= value ? 'bg-primary' : 'bg-muted-foreground/40 dark:bg-muted-foreground/50',
          )}
          style={{ height: 3 + strength * 1.6 }}
        />
      ))}
    </span>
  );
}
