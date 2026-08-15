import type { PluginOnboardingStep } from '../../types';
import { CalendarStep } from './CalendarStep';
import { CyclePageStep } from './CyclePageStep';
import { DayWarningsStep } from './DayWarningsStep';

/** The period tracker's own tour — see `PluginModule.onboardingSteps`. No native step: unlike
    habits, this plugin has no Android home-screen widget (see index.ts's own note on that). */
export const periodTrackerOnboardingSteps: readonly PluginOnboardingStep[] = [
  { id: 'cycle', Component: CyclePageStep },
  { id: 'day', Component: DayWarningsStep },
  { id: 'calendar', Component: CalendarStep },
];
