import { useTranslation } from 'react-i18next';
import { notifyDeviceSaved, Section, ToggleRow } from '@/components/settings/Section';
import { usePluginPreference } from '../reminders';

/**
 * The notebook's settings card: one switch, for one trade-off.
 *
 * Device-local, like every plugin settings card — and for once, that's the *entire* reason it's
 * worth stating separately from the account-wide "notebook is on" switch above it: caching an
 * image is spending *this device's* storage, not the account's. A laptop with room to spare and a
 * phone running low have no reason to make the same choice, and signing out here would otherwise
 * revert a synced flag exactly the way `lib/preferences.ts` warns a synced reminder would.
 *
 * Off by default. Caching costs storage silently in the background — the honest default is the one
 * that asks first, the same call `syncOnWifiOnly` makes in the app's own General settings.
 */
export function NotebookSettingsSection() {
  const { t } = useTranslation();
  const [cacheImages, setCacheImages] = usePluginPreference<boolean>(
    'notebook',
    'cacheImages',
    false,
  );

  return (
    <Section
      title={t('plugins.notebook.settingsTitle')}
      description={t('plugins.notebook.settingsDescription')}
    >
      <ToggleRow
        id="notebook-cache-images"
        label={t('plugins.notebook.cacheImages')}
        description={t('plugins.notebook.cacheImagesDescription')}
        checked={cacheImages}
        onCheckedChange={(checked) => {
          setCacheImages(checked);
          notifyDeviceSaved(t('settings.general.savedOnDevice'));
        }}
      />
    </Section>
  );
}
