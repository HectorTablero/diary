import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import { addDays } from 'date-fns';
import { db } from '@/db/db';
import i18n from '@/i18n';
import { parseDateKey, toDateKey, todayKey } from '@/lib/dates';
import { atTimeOfDay } from '@/lib/notificationSchedule';
import { pluginNotificationId } from '@/lib/notificationIds';
import { getPluginPreference } from '../reminders';
import type { PluginNotificationContext } from '../types';
import { parsePeriodDay } from './model';
import { groupCycles, predictNext } from './predict';

const PLUGIN_ID = 'period-tracker';

/** How many days ahead of the predicted start the heads-up fires. Fixed rather than a setting: a
    plugin whose whole design leans lean does not need a second number to configure alongside the
    reminder time it already offers. */
const LEAD_DAYS = 2;

/**
 * The period tracker's one reminder: a heads-up a couple of days before a period is predicted to
 * start.
 *
 * A single occurrence per predicted cycle, not a recurring nag — the day page's own "should be coming
 * soon" banner already carries the ongoing story once the window opens, so this only needs to open
 * it. Idempotent the way habits' own reminder is, but keyed to the *prediction* rather than to a
 * fixed daily slot: a cycle that runs long or short changes `prediction.start`, which changes the id,
 * which means the reconcile sweeps the stale one on its own — there is no "was this the same
 * estimate as last time" bookkeeping to keep.
 */
export async function collectPeriodNotifications({
  slot,
}: PluginNotificationContext): Promise<LocalNotificationSchema[]> {
  if (!getPluginPreference('period-tracker', 'reminder', false)) return [];

  const time = getPluginPreference('period-tracker', 'reminderTime', '09:00');
  const today = todayKey();

  const rows = await db.pluginRecords
    .where('[pluginId+scope]')
    .equals([PLUGIN_ID, 'record'])
    .toArray();
  const marked = rows.flatMap((row) => (parsePeriodDay(row) ? [row.dateKey] : []));
  const prediction = predictNext(groupCycles(marked));
  if (!prediction) return [];

  // Already here: today has already been logged as a period day, so the thing this would have
  // warned about has already happened. The same "done is a cancellation" rule the habit nudge
  // follows — returning nothing is how the reconcile is told to cancel any pending alarm.
  if (marked.includes(today)) return [];

  const leadDay = toDateKey(addDays(parseDateKey(prediction.start), -LEAD_DAYS));
  // Never a day that has already gone by, and never past the whole predicted window unremarked —
  // a stale estimate several weeks in the past is not worth a notification any more.
  const targetDay = leadDay > today ? leadDay : today;
  if (targetDay > prediction.end) return [];

  let fireAt = atTimeOfDay(parseDateKey(targetDay), time);
  // The target day's own slot has already passed today (a catch-up case: the app was closed
  // through the lead day) — the next occurrence of the chosen time is tomorrow's.
  if (fireAt <= new Date()) fireAt = atTimeOfDay(addDays(parseDateKey(targetDay), 1), time);

  const body = i18n.t('plugins.period-tracker.reminderBody');
  return [
    {
      id: pluginNotificationId(slot, prediction.start),
      title: i18n.t('plugins.period-tracker.reminderTitle'),
      body,
      largeBody: body,
      schedule: { at: fireAt, allowWhileIdle: true },
      extra: { kind: 'plugin', pluginId: PLUGIN_ID },
    },
  ];
}
