import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FlowLevel } from '../model';
import { Card, OutlookText, PeriodControl } from '../PeriodDayWidget';
import type { PeriodOutlook } from '../predict';

/** A fixed, illustrative outlook rather than one run through `outlookFor` on fabricated dates —
    the number in "may arrive in about {{count}} days" is the whole point of the example, so it is
    written here directly instead of being the incidental result of a prediction nobody asked
    for. */
const DEMO_OUTLOOK: PeriodOutlook = { kind: 'approaching', daysUntil: 5 };

/**
 * The two faces the day page's own card can show, through the exact components it renders them
 * with — `Card`, `OutlookText`, `PeriodControl` — stacked as two examples rather than picked apart
 * from one, since the real card only ever shows one at a time (the words are for a day not yet
 * marked; the moment it is, they make way for the control) and a tour showing only whichever one
 * this account happens to be in right now would leave the other undiscovered.
 *
 * The control is genuinely live — the one control in this step worth trying, since watching a
 * choice actually take hold is most of what "select the intensity, or say it's over" means.
 */
export function DayWarningsStep() {
  const { t } = useTranslation();
  const [value, setValue] = useState<FlowLevel | 'off' | undefined>(undefined);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          {t('plugins.period-tracker.onboarding.day.beforeLabel')}
        </p>
        <Card>
          <OutlookText outlook={DEMO_OUTLOOK} />
        </Card>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          {t('plugins.period-tracker.onboarding.day.todayLabel')}
        </p>
        <Card>
          <PeriodControl value={value} onSelect={setValue} />
        </Card>
      </div>
    </div>
  );
}
