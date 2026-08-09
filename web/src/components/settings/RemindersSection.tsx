import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { TimePicker } from '@/components/ui/time-picker';
import {
  getExactAlarmStatus,
  getNotificationPermission,
  requestExactAlarms,
  requestNotificationPermission,
} from '@/lib/notifications';
import { setPreference, usePreferences, type Preferences } from '@/lib/preferences';
import { notifyDeviceSaved, Section, ToggleRow } from './Section';

/**
 * The time a reminder fires, under the switch that turns it on.
 *
 * Indented behind a rule, and led by a word rather than standing alone. A bare picker sitting
 * full-width below a row whose switch is at the far right reads as the next setting down rather
 * than as part of the one above it — the two are the same distance apart as any two settings in
 * the section, so nothing says they belong together.
 */
export function ReminderTime({
  value,
  onChange,
  minHour,
}: {
  value: string;
  onChange: (value: string) => void;
  minHour?: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="ml-1 flex items-center gap-2 border-l pl-3">
      <span className="text-xs text-muted-foreground">{t('settings.reminders.sendAt')}</span>
      <TimePicker
        value={value}
        minHour={minHour}
        aria-label={t('settings.reminders.sendAt')}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * Every alarm this device sends. Rendered only on the phone build — a switch that cannot do
 * anything is worse than an absent one, and the web has no local notifications at all.
 *
 * All device-local, so none of this touches the page's draft or its save path. The reason is
 * blunter than it looks: signing out wipes the account settings back to their defaults, and a
 * synced "off" would quietly become "on" again — a phone buzzing at a time the user turned off.
 */
export function RemindersSection() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const [permission, setPermission] = useState<'granted' | 'denied' | 'prompt'>('granted');
  const [exactAlarms, setExactAlarms] = useState<'granted' | 'denied' | 'unsupported'>(
    'unsupported',
  );

  // Both are changed from outside the app, so re-read whenever the user comes back to it.
  useEffect(() => {
    const check = () => {
      void getNotificationPermission().then(setPermission);
      void getExactAlarmStatus().then(setExactAlarms);
    };
    check();
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPreference(key, value);
    notifyDeviceSaved(t('settings.general.savedOnDevice'));
  };

  return (
    <Section
      title={t('settings.reminders.title')}
      description={t('settings.reminders.description')}
    >
      <div className="flex flex-col gap-5">
        {permission === 'denied' && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t('settings.reminders.blocked')}
          </p>
        )}
        {/* Full width and in the primary colour, unlike every other button on this page. Nothing
            below it can do anything until it has been pressed, so it is not one option among the
            settings — it is the door in front of them. */}
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

        {/* Ordered by how much of the diary each one knows about, which is also roughly how often
            it fires: checkups watch every person, birthdays a date each, the daily nudge only
            whether today is empty — and quiet hours last, since it is the rule over the other
            three rather than a reminder of its own. */}
        <ToggleRow
          id="checkup-reminders"
          label={t('settings.reminders.checkups')}
          description={t('settings.reminders.checkupsDescription')}
          checked={prefs.checkupReminders}
          onCheckedChange={(checked) => set('checkupReminders', checked)}
        />

        <ToggleRow
          id="birthday-reminders"
          label={t('settings.reminders.birthdays')}
          description={t('settings.reminders.birthdaysDescription')}
          checked={prefs.birthdayReminders}
          onCheckedChange={(checked) => set('birthdayReminders', checked)}
        >
          {prefs.birthdayReminders && (
            <ReminderTime
              value={prefs.birthdayReminderTime}
              onChange={(value) => set('birthdayReminderTime', value)}
            />
          )}
        </ToggleRow>

        <ToggleRow
          id="daily-reminder"
          label={t('settings.reminders.daily')}
          description={t('settings.reminders.dailyDescription')}
          checked={prefs.dailyReminder}
          onCheckedChange={(checked) => set('dailyReminder', checked)}
        >
          {prefs.dailyReminder && (
            /* Afternoon onwards only: at 08:00 "you haven't written today" is trivially true, so
               an unrestricted picker would invite a setting that guarantees a useless daily nudge. */
            <ReminderTime
              value={prefs.dailyReminderTime}
              minHour={12}
              onChange={(value) => set('dailyReminderTime', value)}
            />
          )}
        </ToggleRow>

        <div className="flex flex-col gap-2">
          <Label>{t('settings.reminders.quietHours')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('settings.reminders.quietHoursDescription')}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t('settings.reminders.quietFrom')}
            </span>
            <TimePicker
              aria-label={t('settings.reminders.quietFrom')}
              value={prefs.quietHoursStart}
              onChange={(value) => set('quietHoursStart', value)}
            />
            <span className="text-xs text-muted-foreground">
              {t('settings.reminders.quietUntil')}
            </span>
            <TimePicker
              aria-label={t('settings.reminders.quietUntil')}
              value={prefs.quietHoursEnd}
              onChange={(value) => set('quietHoursEnd', value)}
            />
          </div>
        </div>

        {exactAlarms === 'denied' && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">
              {t('settings.reminders.exactAlarmsDescription')}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => void requestExactAlarms()}
            >
              {t('settings.reminders.exactAlarms')}
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
