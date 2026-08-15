import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HintTooltip } from '@/components/common/HintTooltip';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import type { PeriodDay } from '../model';
import { CycleCard } from '../PeriodPage';
import { demoCycle } from './demoCycle';

/**
 * A preview of the plugin's own page — one period, through the exact `CycleCard` the real page
 * renders, with its per-day intensity list opened by default rather than left for a first click to
 * discover. The list is genuinely live (tapping a day's icon actually changes it, in local state
 * that goes nowhere), because that toggle is the one thing this screen exists to demonstrate; Edit
 * and Delete are disabled instead — real actions on a period that was invented for the tour.
 */
export function CyclePageStep() {
  const { t } = useTranslation();
  const { cycle, byDate: initial } = useMemo(demoCycle, []);
  const [byDate, setByDate] = useState<Map<string, PeriodDay>>(initial);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t('plugins.period-tracker.title')}
        className="mb-0"
        actions={
          <HintTooltip content={t('plugins.period-tracker.onboarding.cycle.previewNote')}>
            {/* See AddHabitsStep's own note on wrapping a disabled button for HintTooltip: a
                disabled element fires neither hover nor focus, so the trigger has to be the span
                around it. */}
            <span className="inline-flex" tabIndex={0}>
              <Button size="sm" className="gap-1.5" disabled>
                <Plus className="size-3.5" />
                {t('plugins.period-tracker.addPeriod')}
              </Button>
            </span>
          </HintTooltip>
        }
      />

      {/* The real page keeps every `CycleCard` inside a `<ul>` — Tailwind's reset strips list
          styling from `ul`/`ol`, not from a bare `<li>`, so `CycleCard`'s own root (an `<li>`,
          matching the real list it's normally one row of) rendered alone here would keep the
          browser's default bullet. One-item list, same reason. */}
      <ul>
        <CycleCard
          cycle={cycle}
          byDate={byDate}
          disclosureDefaultOpen
          disableActions
          onEdit={() => {}}
          onDelete={() => {}}
          onSetDayFlow={(dateKey, flow) =>
            setByDate((current) => new Map(current).set(dateKey, { flow }))
          }
        />
      </ul>

      <p className="text-xs text-muted-foreground">
        {t('plugins.period-tracker.onboarding.cycle.previewNote')}
      </p>
    </div>
  );
}
