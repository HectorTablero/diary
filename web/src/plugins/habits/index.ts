import type { PluginModule } from '../types';
import { HabitsDayWidget } from './HabitsDayWidget';
import HabitsPage from './HabitsPage';
import { HabitsSettingsSection } from './HabitsSettingsSection';
import { exportHabitsMarkdown } from './markdown';
import { parseHabit } from './model';
import { collectHabitNotifications } from './notifications';

/* The habit tracker — the first plugin, and the one the plugin API was shaped around.

   Four surfaces, each answering a different question: the day widget is "what should I tick
   today", the page is "how has this been going", the settings card is the device-local reminder,
   and the collector is that reminder actually being armed. They must match the `surfaces` list in
   ../registry — a test asserts it, because a declared surface with nothing behind it makes a slot
   fetch this whole chunk to find undefined. */

const habits: PluginModule = {
  DayWidget: HabitsDayWidget,
  Page: HabitsPage,
  SettingsSection: HabitsSettingsSection,
  collectNotifications: collectHabitNotifications,
  exportMarkdown: exportHabitsMarkdown,
  /* What a row is, in one line, for the backup review — which otherwise has nothing to show but an
     opaque blob. A definition names itself; a day names its date. */
  describeRecord: (record) => parseHabit(record)?.name ?? record.dateKey,
};

export default habits;
