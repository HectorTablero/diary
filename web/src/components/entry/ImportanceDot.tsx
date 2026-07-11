import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const DOT_CLASSES: Record<number, string> = {
  1: 'bg-importance-1',
  2: 'bg-importance-2',
  3: 'bg-importance-3',
  4: 'bg-importance-4',
  5: 'bg-importance-5',
};

export const importanceDotClass = (importance: number) => DOT_CLASSES[importance] ?? DOT_CLASSES[3];

export function ImportanceDot({
  importance,
  className,
}: {
  importance: number;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn('inline-block size-2.5 shrink-0 rounded-full', importanceDotClass(importance), className)}
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
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={t('importance.label')}>
      {[1, 2, 3, 4, 5].map((level) => (
        <Tooltip key={level}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="radio"
              aria-checked={value === level}
              onClick={() => onChange(level)}
              className={cn(
                'flex size-7 items-center justify-center rounded-full transition-all',
                value === level ? 'bg-accent ring-1 ring-ring' : 'hover:bg-accent/60',
              )}
            >
              <span className={cn('size-3 rounded-full', importanceDotClass(level))} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="font-medium">{t(`importance.levels.${level}`)}</p>
            <p className="max-w-48 text-xs opacity-80">{t(`importance.descriptions.${level}`)}</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
