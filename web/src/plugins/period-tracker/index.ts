import i18n from '@/i18n';
import type { PluginModule } from '../types';
import { PeriodCalendarView } from './PeriodCalendarView';
import { PeriodDayWidget } from './PeriodDayWidget';
import PeriodPage from './PeriodPage';
import { PeriodSettingsSection } from './PeriodSettingsSection';
import { exportPeriodMarkdown } from './markdown';
import { parsePeriodDay } from './model';
import { collectPeriodNotifications } from './notifications';

/* The period tracker. Six surfaces, matching the `surfaces` list in ../registry (a test asserts it —
   see registry.surfaces.test.tsx): the day widget is "did it happen, and is it close", the calendar
   view is "where has it been / is it likely" at a glance, the page is the history the day card has no
   room for, the settings card is the device-local heads-up reminder, the collector is that reminder
   actually being armed, and the export is a plain log for taking elsewhere. No `widget` surface —
   deliberately no Android home-screen widget, unlike habits. */

const periodTracker: PluginModule = {
  DayWidget: PeriodDayWidget,
  Page: PeriodPage,
  SettingsSection: PeriodSettingsSection,
  collectNotifications: collectPeriodNotifications,
  exportMarkdown: exportPeriodMarkdown,
  CalendarView: PeriodCalendarView,
  /* Every row this plugin writes is a day row — there is no undated "definition" collection the way
     habits has one — so the only thing worth saying about a row, for the backup-import review, is
     what was recorded on it. */
  describeRecord: (record) => {
    const day = parsePeriodDay(record);
    if (!day) return record.dateKey;
    const flow = i18n.t(
      `plugins.period-tracker.flow${day.flow.charAt(0).toUpperCase()}${day.flow.slice(1)}`,
    );
    return i18n.t('plugins.period-tracker.confirmedLabel', { flow });
  },
};

export default periodTracker;
