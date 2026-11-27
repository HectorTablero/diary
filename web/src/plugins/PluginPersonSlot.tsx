import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { captureError } from '@/lib/telemetry';
import { useEnabledPlugins } from './enabled';
import { ensurePluginLocales } from './i18n';
import { PLUGINS, type PluginManifest } from './registry';

/**
 * The profile page's plugin surface, under the person's contact details.
 *
 * The day slot's contract, unchanged (see PluginDaySlot): `enabled`, then `surfaces`, then
 * `load()`, so a profile with no `person` plugin on renders `null` having fetched nothing. Nothing
 * is shown while loading, and a plugin that fails to load renders nothing — a broken plugin must
 * not be able to take a profile down with it.
 */
export function PluginPersonSlot({ personId }: { personId: string }) {
  const enabled = useEnabledPlugins();
  const active = PLUGINS.filter(
    (plugin) => enabled.has(plugin.id) && plugin.surfaces.includes('person'),
  );
  if (!active.length) return null;
  return (
    <>
      {active.map((plugin) => (
        <PluginPersonWidget key={plugin.id} plugin={plugin} personId={personId} />
      ))}
    </>
  );
}

function PluginPersonWidget({ plugin, personId }: { plugin: PluginManifest; personId: string }) {
  const { i18n } = useTranslation();
  const [Widget, setWidget] = useState<ComponentType<{ personId: string }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [module] = await Promise.all([plugin.load(), ensurePluginLocales(plugin.id)]);
        if (!cancelled) setWidget(() => module.default.PersonWidget ?? null);
      } catch (err) {
        captureError(err, { scope: 'plugin.personWidget', plugin: plugin.id });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plugin, i18n.language]);

  if (!Widget) return null;
  return <Widget personId={personId} />;
}
