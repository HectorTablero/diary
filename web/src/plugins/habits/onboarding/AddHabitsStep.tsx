import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HintTooltip } from '@/components/common/HintTooltip';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DEFAULT_SCALE_MAX,
  DEFAULT_SCALE_MIN,
  HABIT_KINDS,
  MAX_HABIT_NAME_LENGTH,
  MAX_HABIT_UNIT_LENGTH,
  type HabitKind,
} from '../model';

/**
 * A preview of the habit tracker's own creation form — HabitsPage.tsx's `HabitForm`, rebuilt from
 * the same `Input`/`Select`/`Label` it uses so switching the kind here swaps in exactly the fields
 * and hint text switching it there would. The fields are genuinely live: that is the point of
 * showing this rather than describing it. Only the result is fake — the Create button is disabled,
 * and `previewNote` says so in the one place a screen reader or a finger without a mouse can always
 * reach it, since `HintTooltip` on the button itself is a web-only bonus (see its own note on why
 * that is not enough by itself).
 */
export function AddHabitsStep() {
  const { t } = useTranslation();
  const [name, setName] = useState(t('plugins.habits.onboarding.add.exampleName'));
  const [type, setType] = useState<HabitKind>('numeric');
  const [unit, setUnit] = useState(t('plugins.habits.onboarding.add.exampleUnit'));
  const [target, setTarget] = useState('10');
  const [min, setMin] = useState(String(DEFAULT_SCALE_MIN));
  const [max, setMax] = useState(String(DEFAULT_SCALE_MAX));

  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <PageHeader
        title={t('plugins.habits.title')}
        className="mb-4"
        actions={
          <Button size="sm" className="gap-1.5" disabled>
            <Plus className="size-3.5" />
            {t('plugins.habits.newHabit')}
          </Button>
        }
      />

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-habit-name">{t('plugins.habits.nameLabel')}</Label>
          <Input
            id="onboarding-habit-name"
            value={name}
            maxLength={MAX_HABIT_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="onboarding-habit-type">{t('plugins.habits.typeLabel')}</Label>
          <Select value={type} onValueChange={(next) => setType(next as HabitKind)}>
            <SelectTrigger id="onboarding-habit-type" aria-label={t('plugins.habits.typeLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HABIT_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {t(`plugins.habits.type${kind[0].toUpperCase()}${kind.slice(1)}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t(`plugins.habits.type${type[0].toUpperCase()}${type.slice(1)}Hint`)}
          </p>
        </div>

        {type === 'numeric' && (
          <div className="flex gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="onboarding-habit-target">{t('plugins.habits.targetLabel')}</Label>
              <Input
                id="onboarding-habit-target"
                inputMode="numeric"
                value={target}
                onChange={(event) => setTarget(event.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="onboarding-habit-unit">{t('plugins.habits.unitLabel')}</Label>
              <Input
                id="onboarding-habit-unit"
                value={unit}
                maxLength={MAX_HABIT_UNIT_LENGTH}
                onChange={(event) => setUnit(event.target.value)}
              />
            </div>
          </div>
        )}

        {type === 'time' && (
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-habit-target">
              {t('plugins.habits.targetMinutesLabel')}
            </Label>
            <Input
              id="onboarding-habit-target"
              inputMode="numeric"
              value={target}
              onChange={(event) => setTarget(event.target.value.replace(/\D/g, ''))}
            />
          </div>
        )}

        {type === 'scale' && (
          <div className="flex gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="onboarding-habit-min">{t('plugins.habits.minLabel')}</Label>
              <Input
                id="onboarding-habit-min"
                inputMode="numeric"
                value={min}
                onChange={(event) => setMin(event.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="onboarding-habit-max">{t('plugins.habits.maxLabel')}</Label>
              <Input
                id="onboarding-habit-max"
                inputMode="numeric"
                value={max}
                onChange={(event) => setMax(event.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            {t('plugins.habits.onboarding.add.previewNote')}
          </p>
          <HintTooltip content={t('plugins.habits.onboarding.add.previewNote')}>
            {/* HintTooltip needs a single element to attach to, and a disabled button doesn't fire
                the hover/focus events Radix listens for — wrapped in a span for exactly the reason
                MDN gives for this pattern: a disabled control cannot itself be a tooltip trigger. */}
            <span className="inline-flex" tabIndex={0}>
              <Button type="button" disabled>
                {t('common.create')}
              </Button>
            </span>
          </HintTooltip>
        </div>
      </div>
    </div>
  );
}
