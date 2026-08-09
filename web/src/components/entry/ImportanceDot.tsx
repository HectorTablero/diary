import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

const DOT_CLASSES: Record<number, string> = {
  1: 'bg-importance-1',
  2: 'bg-importance-2',
  3: 'bg-importance-3',
  4: 'bg-importance-4',
  5: 'bg-importance-5',
};

/**
 * A second, redundant encoding of importance for anyone the colours don't separate.
 *
 * The ramp runs red → orange → amber → green → slate, which is precisely the axis red-green
 * colour blindness collapses: levels 1, 2 and 4 can land within a shade of each other, and the
 * dot is the only indicator on an entry row. Rather than re-hueing per deficiency — which asks
 * the user to self-diagnose and does nothing for achromatopsia — each level gets a silhouette as
 * well, so the colour stops being load-bearing for everyone at once.
 *
 * clip-path rather than borders or extra elements: it works at any size, inherits the same
 * background colour, and leaves every call site's existing `size-*` class untouched.
 */
const SHAPE_CLASSES: Record<number, string> = {
  1: 'rounded-full',
  2: '[clip-path:polygon(50%_0%,100%_100%,0%_100%)]',
  3: 'rounded-[1px]',
  4: '[clip-path:polygon(50%_0%,100%_50%,50%_100%,0%_50%)]',
  5: '[clip-path:polygon(0%_32%,100%_32%,100%_68%,0%_68%)]',
};

const level = (importance: number) => (importance >= 1 && importance <= 5 ? importance : 3);

/** Colour only. For the few places that tint something other than a marker (the calendar's
    heatmap cell), where a silhouette has nowhere to appear. */
export const importanceDotClass = (importance: number) => DOT_CLASSES[level(importance)];

/**
 * Colour plus, when the preference is on, a distinct shape — the classes every importance marker
 * in the app should be built from.
 *
 * A hook rather than a bare function so toggling the setting repaints immediately; it returns a
 * mapper so one call at the top of a component covers a whole `.map()` of levels.
 */
export function useImportanceMarkerClass(): (importance: number) => string {
  const { importanceShapes } = usePreferences();
  return (importance) =>
    cn(
      DOT_CLASSES[level(importance)],
      importanceShapes ? SHAPE_CLASSES[level(importance)] : 'rounded-full',
    );
}

export function ImportanceDot({
  importance,
  className,
}: {
  importance: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const markerClass = useImportanceMarkerClass();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn('inline-block size-2.5 shrink-0', markerClass(importance), className)}
          /* `role="img"` is what makes the aria-label below legal, and it is not a formality: ARIA
             forbids a name on a generic element, so a bare `<span aria-label>` is stripped by the
             accessibility tree — the level was announced to nobody. The dot is a graphic carrying
             meaning that appears nowhere else on the row, which is exactly what role="img" is for. */
          role="img"
          aria-label={t(`importance.levels.${importance}`)}
        />
      </TooltipTrigger>
      <TooltipContent>{t(`importance.levels.${importance}`)}</TooltipContent>
    </Tooltip>
  );
}

export function ImportancePicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (importance: number) => void;
}) {
  const { t } = useTranslation();
  const markerClass = useImportanceMarkerClass();
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={t('importance.label')}>
      {[1, 2, 3, 4, 5].map((importance) => (
        <Tooltip key={importance}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="radio"
              aria-checked={value === importance}
              aria-label={t(`importance.levels.${importance}`)}
              onClick={() => onChange(importance)}
              className={cn(
                'flex size-7 items-center justify-center rounded-full transition-all',
                value === importance ? 'bg-accent ring-1 ring-ring' : 'hover:bg-accent/60',
              )}
            >
              <span className={cn('size-3', markerClass(importance))} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="font-medium mr-1">{t(`importance.levels.${importance}`)}</p>
            <div className="w-[0.75px] self-stretch bg-muted-foreground" />
            <p className="max-w-48 text-xs opacity-80">
              {t(`importance.descriptions.${importance}`)}
            </p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
