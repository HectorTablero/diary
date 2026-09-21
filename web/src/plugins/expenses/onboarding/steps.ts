import type { PluginOnboardingStep } from '../../types';
import { CalendarStep } from './CalendarStep';
import { DayStep } from './DayStep';
import { StatsStep } from './StatsStep';

/** The expense tracker's own tour — see `PluginModule.onboardingSteps`. */
export const expensesOnboardingSteps: readonly PluginOnboardingStep[] = [
  { id: 'day', Component: DayStep },
  { id: 'stats', Component: StatsStep },
  { id: 'calendar', Component: CalendarStep },
];
