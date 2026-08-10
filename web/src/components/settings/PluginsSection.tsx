import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, ToggleRow } from '@/components/settings/Section';
import { countPluginRecords } from '@/db/pluginRecords';
import { notifyError } from '@/lib/notify';
import { captureError } from '@/lib/telemetry';
import { setPluginEnabled, useEnabledPlugins } from '@/plugins/enabled';
import { ensurePluginLocales } from '@/plugins/i18n';
import { PLUGINS } from '@/plugins/registry';

/**
 * The Plugins card: every plugin that exists, and a switch for each.
 *
 * This is the one screen that needs a *disabled* plugin's strings — its name and description have
 * to be readable before you decide to turn it on — so it is the one place that loads every
 * plugin's locale rather than only the enabled ones. That cost is paid on opening Settings, by
 * someone who came here to look at exactly this, and nowhere else in the app.
 *
 * Switching a plugin on writes its `config` row, which syncs: a plugin turned on here appears on
 * every device. Its *reminders* do not — those are device-local for the reason in
 * lib/preferences.ts, and the plugin's own section below says so with the "saved on this device"
 * toast rather than leaving the difference to be discovered.
 */
export function PluginsSection() {
  const { t, i18n } = useTranslation();
  const enabled = useEnabledPlugins();
  const [ready, setReady] = useState(false);
  const [rowCounts, setRowCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(PLUGINS.map((plugin) => ensurePluginLocales(plugin.id).catch(() => {}))).then(
      () => !cancelled && setReady(true),
    );
    return () => {
      cancelled = true;
    };
  }, [i18n.language]);

  /* How much data each plugin already holds on this account. Shown only for plugins that are off:
     it is the answer to "if I turn this on, is there anything in it?", which is otherwise invisible
     — and it is what makes a plugin that was enabled on another device discoverable here. */
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      PLUGINS.filter((plugin) => !enabled.has(plugin.id)).map(
        async (plugin) => [plugin.id, await countPluginRecords(plugin.id)] as const,
      ),
    ).then((entries) => !cancelled && setRowCounts(Object.fromEntries(entries)));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!PLUGINS.length) return null;

  const toggle = async (pluginId: string, value: boolean) => {
    try {
      await setPluginEnabled(pluginId, value);
    } catch (err) {
      captureError(err, { scope: 'plugins.toggle', plugin: pluginId });
      notifyError(t('settings.plugins.saveFailed'));
    }
  };

  return (
    <Section title={t('settings.plugins.title')} description={t('settings.plugins.description')}>
      {PLUGINS.map((plugin) => {
        const on = enabled.has(plugin.id);
        const rows = rowCounts[plugin.id] ?? 0;
        return (
          <ToggleRow
            key={plugin.id}
            id={`plugin-${plugin.id}`}
            // Before the locales land the switch would read as its own key, so hold the row back.
            label={ready ? t(`plugins.${plugin.id}.name`) : '…'}
            description={
              !on && rows > 0
                ? t('settings.plugins.hasData', { count: rows })
                : ready
                  ? t(`plugins.${plugin.id}.description`)
                  : ''
            }
            checked={on}
            onCheckedChange={(value) => void toggle(plugin.id, value)}
          />
        );
      })}
    </Section>
  );
}

/**
 * Each enabled plugin's own settings card, loaded on demand.
 *
 * Separate from the card above so a plugin's settings sit as a section of their own rather than
 * nested inside a list of switches — and so that turning a plugin off removes its settings from the
 * page entirely rather than leaving a dead card behind.
 */
export function PluginSettingsSections() {
  const enabled = useEnabledPlugins();
  const active = PLUGINS.filter(
    (plugin) => enabled.has(plugin.id) && plugin.surfaces.includes('settings'),
  );
  if (!active.length) return null;
  return (
    <>
      {active.map((plugin) => (
        <PluginSettingsSection key={plugin.id} pluginId={plugin.id} />
      ))}
    </>
  );
}

function PluginSettingsSection({ pluginId }: { pluginId: string }) {
  const { i18n } = useTranslation();
  const [SettingsSection, setSettingsSection] = useState<ComponentType | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const manifest = PLUGINS.find((plugin) => plugin.id === pluginId);
      if (!manifest) return;
      try {
        const [module] = await Promise.all([manifest.load(), ensurePluginLocales(pluginId)]);
        if (!cancelled) setSettingsSection(() => module.default.SettingsSection ?? null);
      } catch (err) {
        // A plugin whose chunk won't load must not take the Settings page down with it.
        captureError(err, { scope: 'plugin.settings', plugin: pluginId });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pluginId, i18n.language]);

  return SettingsSection ? <SettingsSection /> : null;
}
