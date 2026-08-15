import { Compass } from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, ToggleRow } from '@/components/settings/Section';
import { Button } from '@/components/ui/button';
import { countPluginRecords } from '@/db/pluginRecords';
import { notifyError } from '@/lib/notify';
import { captureError } from '@/lib/telemetry';
import { setPluginEnabled, useEnabledPlugins } from '@/plugins/enabled';
import { ensurePluginLocales } from '@/plugins/i18n';
import { syncNativeWidgets } from '@/plugins/nativeWidgets';
import { PluginOnboarding } from '@/plugins/PluginOnboarding';
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
  /** Which plugin's tour is open, if any — at most one at a time, the same way only one plugin's
      settings card is ever being read. */
  const [touring, setTouring] = useState<string | null>(null);

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
      /* A plugin with a home-screen widget has one surface that does not re-render when this
         screen does, because it is not rendered by this app at all. Switching a plugin off has to
         reach it — otherwise the widget sits on the home screen showing the habits of a plugin
         that is no longer on, and nothing ever comes back to correct it. `alsoInclude` is what
         gets a just-disabled plugin one final pass; see plugins/nativeWidgets.ts. */
      void syncNativeWidgets({ alsoInclude: pluginId });
    } catch (err) {
      captureError(err, { scope: 'plugins.toggle', plugin: pluginId });
      notifyError(t('settings.plugins.saveFailed'));
    }
  };

  return (
    <>
      <Section title={t('settings.plugins.title')} description={t('settings.plugins.description')}>
        <div className="flex flex-col gap-4">
          {PLUGINS.map((plugin) => {
            const on = enabled.has(plugin.id);
            const rows = rowCounts[plugin.id] ?? 0;
            return (
              <ToggleRow
                key={plugin.id}
                id={`plugin-${plugin.id}`}
                icon={plugin.icon}
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
              >
                {/* Not gated on `ready` or `on`: a plugin's tour is what helps someone decide
                    whether to turn it on in the first place, so it has to work before the switch
                    does — and its own strings arrive from the same `ensurePluginLocales` call this
                    section already made to read the switch's own label above. Only shown for a
                    plugin that actually declares one — `surfaces` is readable without loading the
                    plugin's chunk, same guard the day page and calendar slots use.

                    The same indented, ruled row RemindersSection's own "At" qualifies a reminder
                    with — a plugin's tour is exactly that kind of thing: it belongs to the row
                    above, not beside it as a second, equally-weighted setting. */}
                {plugin.surfaces.includes('onboarding') && (
                  <div className="ml-1 flex items-center gap-2 border-l pl-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                      onClick={() => setTouring(plugin.id)}
                    >
                      <Compass className="size-4" />
                      {t('settings.plugins.tourButton')}
                    </Button>
                  </div>
                )}
              </ToggleRow>
            );
          })}
        </div>
      </Section>

      {touring && <PluginOnboarding pluginId={touring} onDone={() => setTouring(null)} />}
    </>
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
