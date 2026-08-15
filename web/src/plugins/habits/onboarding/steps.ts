import { isNative } from '@/lib/native';
import type { PluginOnboardingStep } from '../../types';
import { AddHabitsStep } from './AddHabitsStep';
import { CalendarStep } from './CalendarStep';
import { TypesStep } from './TypesStep';
import { WidgetStep } from './WidgetStep';

/**
 * The habit tracker's own tour — see `PluginModule.onboardingSteps`.
 *
 * `widget` is appended only on Android, the same pattern OnboardingFlow itself uses for its
 * native-only reminders step: `isNative` is read once, at module scope, rather than inside a
 * component, so the step list is a plain constant and the driver never has to know that one
 * plugin's tour is shorter on the web.
 */
export const habitsOnboardingSteps: readonly PluginOnboardingStep[] = [
  { id: 'add', Component: AddHabitsStep },
  { id: 'types', Component: TypesStep },
  { id: 'calendar', Component: CalendarStep },
  ...(isNative ? [{ id: 'widget', Component: WidgetStep }] : []),
];
