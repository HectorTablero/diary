import type { PluginModule } from '../types';
import { HabitsCalendarView } from './HabitsCalendarView';
import { HabitsDayWidget } from './HabitsDayWidget';
import HabitsPage from './HabitsPage';
import { HabitsSettingsSection } from './HabitsSettingsSection';
import { exportHabitsMarkdown } from './markdown';
import { parseHabit } from './model';
import { collectHabitNotifications } from './notifications';
import { habitsOnboardingSteps } from './onboarding/steps';
import { syncHabitsWidget } from './widgetBridge';

/* The habit tracker — the first plugin, and the one the plugin API was shaped around.

   Six surfaces, each answering a different question: the day widget is "what should I tick
   today", the page is "how has this been going", the settings card is the device-local reminder,
   the collector is that reminder actually being armed, the calendar view is "how has this month
   gone" at a glance, in the diary's own calendar, and the tour is "what does any of this actually
   look like" for someone who hasn't turned the plugin on yet. They must match the `surfaces` list
   in ../registry — a test asserts it, because a declared surface with nothing behind it makes a
   slot fetch this whole chunk to find undefined. */

const habits: PluginModule = {
  DayWidget: HabitsDayWidget,
  Page: HabitsPage,
  SettingsSection: HabitsSettingsSection,
  collectNotifications: collectHabitNotifications,
  exportMarkdown: exportHabitsMarkdown,
  CalendarView: HabitsCalendarView,
  /* The Android home-screen widget's two directions in one call: bank whatever was pressed on it
     while the app was closed, then restate today for it to draw. Headless and native-only — off a
     device it is a no-op, which is what lets every lifecycle hook call it unconditionally. */
  syncNativeWidget: syncHabitsWidget,
  /* What a row is, in one line, for the backup review — which otherwise has nothing to show but an
     opaque blob. A definition names itself; a day names its date. */
  describeRecord: (record) => parseHabit(record)?.name ?? record.dateKey,
  onboardingSteps: habitsOnboardingSteps,
};

export default habits;
