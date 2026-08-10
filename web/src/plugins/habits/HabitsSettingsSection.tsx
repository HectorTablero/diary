import { useTranslation } from 'react-i18next';
import { notifyDeviceSaved, Section, ToggleRow } from '@/components/settings/Section';
import { TimePicker } from '@/components/ui/time-picker';
import { isNative } from '@/lib/native';
import { usePluginPreference } from '../reminders';

/**
 * The habit tracker's settings card.
 *
 * Everything here is **device-local**, and that is the whole reason the card exists separately from
 * the Plugins switch above it. Turning the plugin on follows the account; being reminded about it
 * does not — because signing out runs `clearLocalData()`, and a synced reminder flag would revert
 * to its default and start a phone buzzing at a time its owner had switched off. The rule and its
 * reasoning are in lib/preferences.ts; this is a plugin obeying it.
 *
 * So each row here announces itself with `notifyDeviceSaved`, the same "saved on this device" toast
 * the app's own reminder settings use. The difference between the two halves is real and a user
 * will meet it — better to say so at the moment they change something than to let them discover it
 * when a second device doesn't follow.
 *
 * Native-only, like RemindersSection: there is no web notification path in this app, so on the web
 * the card would be a switch that does nothing.
 */
export function HabitsSettingsSection() {
  const { t } = useTranslation();
  /* Explicit type arguments: without them the fallback narrows the preference to the literal
     `false` / `'21:00'`, and the setter would only accept the value it already has. */
  const [reminder, setReminder] = usePluginPreference<boolean>('habits', 'reminder', false);
  const [time, setTime] = usePluginPreference<string>('habits', 'reminderTime', '21:00');

  if (!isNative) return null;

  return (
    <Section
      title={t('plugins.habits.remindersTitle')}
      description={t('plugins.habits.remindersDescription')}
    >
      <ToggleRow
        id="habits-reminder"
        label={t('plugins.habits.reminder')}
        description={t('plugins.habits.reminderDescription')}
        checked={reminder}
        onCheckedChange={(checked) => {
          setReminder(checked);
          notifyDeviceSaved(t('settings.general.savedOnDevice'));
        }}
      >
        {/* Indented under the switch, the same shape RemindersSection uses for its own send-at
            row — a plugin's settings should be indistinguishable from the app's own. */}
        <div className="ml-1 flex items-center gap-2 border-l pl-3">
          <span className="text-xs text-muted-foreground">{t('plugins.habits.reminderTime')}</span>
          <TimePicker
            value={time}
            aria-label={t('plugins.habits.reminderTime')}
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
