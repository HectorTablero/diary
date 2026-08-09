import { BellRing } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReminderTime } from '@/components/settings/RemindersSection';
import { ToggleRow } from '@/components/settings/Section';
import { Button } from '@/components/ui/button';
import { getNotificationPermission, requestNotificationPermission } from '@/lib/notifications';
import { setPreference, usePreferences } from '@/lib/preferences';

/**
 * The daily nudge, asked for once, on the phone build only.
 *
 * Nothing here schedules an alarm directly: `main.tsx` subscribes to the preference store and
 * re-runs `refreshNotifications()` on every change, so writing the preference *is* the scheduling
 * path — the same one the Settings switch uses, rather than a second one that could drift from it.
 *
 * The permission ask is behind an explicit button, exactly as in RemindersSection, and never fired
 * by merely arriving on this screen. It also deliberately does not go through
 * `requestPermissionFor('daily')`: that helper waits until the diary has a few entries in it before
 * asking, which on a device that has not signed in yet is always true and would make the button do
 * nothing at all.
 */
export function RemindersStep() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const [permission, setPermission] = useState<'granted' | 'denied' | 'prompt'>('granted');

  useEffect(() => {
    void getNotificationPermission().then(setPermission);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {permission === 'denied' && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t('settings.reminders.blocked')}
        </p>
      )}
      {permission === 'prompt' && (
        <Button
          className="w-full gap-1.5"
          onClick={() =>
            void requestNotificationPermission().then(() =>
              getNotificationPermission().then(setPermission),
            )
          }
        >
          <BellRing className="size-4" />
          {t('settings.reminders.allow')}
        </Button>
      )}

      <div className="rounded-xl border bg-card p-3 shadow-xs">
        <ToggleRow
          id="onboarding-daily-reminder"
          label={t('settings.reminders.daily')}
          description={t('settings.reminders.dailyDescription')}
          checked={prefs.dailyReminder}
          // No notifyDeviceSaved(), for the same reason as the shapes switch on the previous step.
          onCheckedChange={(checked) => setPreference('dailyReminder', checked)}
        >
          {prefs.dailyReminder && (
            /* Afternoon onwards, matching Settings: at 08:00 "you haven't written today" is
               trivially true, so an unrestricted picker invites a guaranteed-useless nudge. */
            <ReminderTime
              value={prefs.dailyReminderTime}
              minHour={12}
              onChange={(value) => setPreference('dailyReminderTime', value)}
            />
          )}
        </ToggleRow>
      </div>
    </div>
  );
}
