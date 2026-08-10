import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import { UNDATED_KEY } from '@diary/shared';
import { db } from '@/db/db';
import i18n from '@/i18n';
import { toDateKey } from '@/lib/dates';
import { nextDailyReminderAt } from '@/lib/notificationSchedule';
import { pluginNotificationId } from '@/lib/notificationIds';
import { getPluginPreference } from '../reminders';
import type { PluginNotificationContext } from '../types';
import { isArchived, parseHabit, parseValues } from './model';

/**
 * The habit tracker's one reminder: a nudge if the day's habits are still untouched.
 *
 * Modelled on the diary's own daily nudge (`collectDailyReminder`) and idempotent for the same
 * reason — the id's *meaning* shifts forward each day rather than being tracked, so there is no
 * "already announced" bookkeeping to keep and nothing to go stale. Returning nothing is how it is
 * cancelled: the reconcile sweeps any pending id this pass did not ask for.
 *
 * Quiet hours deliberately do not apply, matching the diary's nudge: this is a time the user picked,
 * and deferring it by a window they also picked would be one setting overruling another.
 */

/** Distinct from any other key this plugin might notify on; hashed into the plugin's own slice. */
const DAILY_KEY = 'daily';

export async function collectHabitNotifications({
  slot,
}: PluginNotificationContext): Promise<LocalNotificationSchema[]> {
  if (!getPluginPreference('habits', 'reminder', false)) return [];

  const time = getPluginPreference('habits', 'reminderTime', '21:00');
  /* Today if the chosen time hasn't passed, otherwise tomorrow — and the day the alarm is *for* is
     the day whose ticks decide whether it should exist at all. */
  const candidate = nextDailyReminderAt(new Date(), time);
  const candidateKey = toDateKey(candidate);

  const rows = await db.pluginRecords
    .where('[pluginId+scope]')
    .equals(['habits', 'record'])
    .toArray();

  // Nothing to be reminded about: no habits defined yet.
  const habits = rows
    .filter((row) => row.dateKey === UNDATED_KEY)
    .flatMap((row) => parseHabit(row) ?? [])
    // A retired habit is not being asked about any more, so it cannot be what is 'left today'.
    .filter((habit) => !isArchived(habit));
  if (!habits.length) return [];

  /* Already done is a cancellation, not a quieter reminder. A partial day still nudges — the point
     is the habits that haven't been touched — but a day where every habit is ticked has nothing
     left to say, so it returns nothing and the reconcile cancels the pending alarm. */
  const recorded = parseValues(rows.find((row) => row.dateKey === candidateKey));
  const remaining = habits.filter((habit) => (recorded[habit.id] ?? 0) === 0);
  if (!remaining.length) return [];

  const body = i18n.t('plugins.habits.reminderBody', { count: remaining.length });
  return [
    {
      id: pluginNotificationId(slot, DAILY_KEY),
      title: i18n.t('plugins.habits.reminderTitle'),
      body,
      largeBody: body,
      schedule: { at: candidate, allowWhileIdle: true },
      extra: { kind: 'plugin', pluginId: 'habits' },
    },
  ];
}
