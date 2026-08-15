import i18n from '@/i18n';
import type { PluginModule } from '../types';
import { PeriodCalendarView } from './PeriodCalendarView';
import { PeriodDayWidget } from './PeriodDayWidget';
import PeriodPage from './PeriodPage';
import { PeriodSettingsSection } from './PeriodSettingsSection';
import { exportPeriodMarkdown } from './markdown';
import { parsePeriodDay } from './model';
import { collectPeriodNotifications } from './notifications';
import { periodTrackerOnboardingSteps } from './onboarding/steps';

/* The period tracker. Seven surfaces, matching the `surfaces` list in ../registry (a test asserts
   it — see registry.surfaces.test.tsx): the day widget is "did it happen, and is it close", the
   calendar view is "where has it been / is it likely" at a glance, the page is the history the day
   card has no room for, the settings card is the device-local heads-up reminder, the collector is
   that reminder actually being armed, the export is a plain log for taking elsewhere, and the tour
   is "what does any of this actually look like" for someone who hasn't turned the plugin on yet.
   No `widget` surface — deliberately no Android home-screen widget, unlike habits. */

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
  onboardingSteps: periodTrackerOnboardingSteps,
};

export default periodTracker;
