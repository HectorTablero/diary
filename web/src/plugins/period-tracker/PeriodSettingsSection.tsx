import { useTranslation } from 'react-i18next';
import { notifyDeviceSaved, Section, ToggleRow } from '@/components/settings/Section';
import { TimePicker } from '@/components/ui/time-picker';
import { isNative } from '@/lib/native';
import { usePluginPreference } from '../reminders';

/**
 * The period tracker's settings card — device-local, same shape and the same reasoning as
 * HabitsSettingsSection: the plugin being on follows the account, but a reminder that arms an alarm
 * on this phone must not survive a sign-out and start buzzing on whoever signs in next. See
 * lib/preferences.ts.
 */
export function PeriodSettingsSection() {
  const { t } = useTranslation();
  const [reminder, setReminder] = usePluginPreference<boolean>('period-tracker', 'reminder', false);
  const [time, setTime] = usePluginPreference<string>('period-tracker', 'reminderTime', '09:00');

  if (!isNative) return null;

  return (
    <Section
      title={t('plugins.period-tracker.remindersTitle')}
      description={t('plugins.period-tracker.remindersDescription')}
    >
      <ToggleRow
        id="period-tracker-reminder"
        label={t('plugins.period-tracker.reminder')}
        description={t('plugins.period-tracker.reminderDescription')}
        checked={reminder}
        onCheckedChange={(checked) => {
          setReminder(checked);
          notifyDeviceSaved(t('settings.general.savedOnDevice'));
        }}
      >
        <div className="ml-1 flex items-center gap-2 border-l pl-3">
          <span className="text-xs text-muted-foreground">
            {t('plugins.period-tracker.reminderTime')}
          </span>
          <TimePicker
            value={time}
            aria-label={t('plugins.period-tracker.reminderTime')}
            onChange={(next) => {
              setTime(next);
              notifyDeviceSaved(t('settings.general.savedOnDevice'));
            }}
          />
        </div>
      </ToggleRow>
    </Section>
  );
}
