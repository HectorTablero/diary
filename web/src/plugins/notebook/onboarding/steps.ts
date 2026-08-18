import type { PluginOnboardingStep } from '../../types';
import { CalendarStep } from './CalendarStep';
import { HistoryStep } from './HistoryStep';
import { TreeStep } from './TreeStep';

/** The notebook's own tour — see `PluginModule.onboardingSteps`. Three screens for the three things
    that are not obvious from the name: a folder is a document, every day is kept, and the calendar
    grows a view of it. */
export const notebookOnboardingSteps: readonly PluginOnboardingStep[] = [
  { id: 'tree', Component: TreeStep },
  { id: 'history', Component: HistoryStep },
  { id: 'calendar', Component: CalendarStep },
];
