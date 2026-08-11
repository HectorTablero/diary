import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEnabledPlugins } from './enabled';
import { ensurePluginLocales } from './i18n';
import { PLUGINS } from './registry';

/**
 * The calendar page's view switcher: one entry per enabled plugin with a calendar view of its own.
 *
 * Same shape, and the same "nothing enabled costs nothing" posture, as `usePluginNav`: with no
 * plugin enabled the filter below is empty and the effect returns before importing anything, and a
 * label waits on the plugin's own locale rather than showing `plugins.habits.name` for a frame.
 * See usePluginNav's notes for the reasoning in full — this is the calendar's copy of it rather
 * than a shared abstraction, because the two lists key off different surfaces and diverging later
 * (per-view badges, say) should not have to fight a shared hook to do it.
 */
export interface PluginCalendarViewItem {
  id: string;
  icon: LucideIcon;
  label: string;
}

export function usePluginCalendarViews(): PluginCalendarViewItem[] {
  const { t, i18n } = useTranslation();
  const [ready, setReady] = useState<ReadonlySet<string>>(new Set());
  const enabled = useEnabledPlugins();

  const candidates = useMemo(
    () =>
      PLUGINS.filter((plugin) => enabled.has(plugin.id) && plugin.surfaces.includes('calendar')),
    [enabled],
  );

  useEffect(() => {
    if (!candidates.length) return;
    let cancelled = false;
    void Promise.all(
      candidates.map(async (plugin) => {
        try {
          await ensurePluginLocales(plugin.id);
          return plugin.id;
        } catch {
          // A plugin whose strings can't be fetched stays out of the switcher rather than showing a
          // raw key.
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
  }, [candidates, i18n.language]);

  return useMemo(
    () =>
      candidates
        .filter((plugin) => ready.has(plugin.id))
        .map((plugin) => ({
          id: plugin.id,
          icon: plugin.icon,
          label: t(`plugins.${plugin.id}.name`),
        })),
    [candidates, ready, t],
  );
}
