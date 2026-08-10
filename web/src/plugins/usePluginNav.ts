import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { useEnabledPlugins } from './enabled';
import { ensurePluginLocales } from './i18n';
import { PLUGINS } from './registry';

/**
 * The nav entries enabled plugins contribute.
 *
 * Runs in the app shell, so it is on everyone's critical path and has to cost nothing when there
 * is nothing to show: with no plugins enabled the filter below produces an empty array, the effect
 * body returns immediately, and no plugin chunk or locale is ever requested.
 *
 * Labels are the one thing that cannot be answered synchronously — a plugin's name lives in its own
 * locale file, which is fetched with the plugin. So an entry appears only once its strings have
 * landed. That is the right way round: a nav item that reads `plugins.habits.name` for a moment is
 * worse than one that arrives a beat late, and this only ever happens on the first render after
 * enabling.
 */
export interface PluginNavItem {
  id: string;
  to: string;
  icon: LucideIcon;
  label: string;
}

export function usePluginNav(): PluginNavItem[] {
  const { t, i18n } = useTranslation();
  const [ready, setReady] = useState<ReadonlySet<string>>(new Set());
  const enabled = useEnabledPlugins();

  const pages = useMemo(
    () => PLUGINS.filter((plugin) => enabled.has(plugin.id) && plugin.surfaces.includes('page')),
    [enabled],
  );

  useEffect(() => {
    if (!pages.length) return;
    let cancelled = false;
    void Promise.all(
      pages.map(async (plugin) => {
        try {
          await ensurePluginLocales(plugin.id);
          return plugin.id;
        } catch {
          // A plugin whose strings can't be fetched stays out of the nav rather than showing a key.
          return null;
        }
      }),
    ).then((ids) => {
      if (!cancelled) setReady(new Set(ids.filter((id): id is string => id !== null)));
    });
    return () => {
      cancelled = true;
    };
    // Re-run on language change: the label has to come from the language now on screen.
  }, [pages, i18n.language]);

  return useMemo(
    () =>
      pages
        .filter((plugin) => ready.has(plugin.id))
        .map((plugin) => ({
          id: plugin.id,
          to: `/plugins/${plugin.id}`,
          icon: plugin.icon,
          label: t(`plugins.${plugin.id}.name`),
        })),
    [pages, ready, t],
  );
}
