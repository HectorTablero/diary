import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { captureError } from '@/lib/telemetry';
import { getPluginSettings, savePluginSettings, useEnabledPlugins } from './enabled';
import { ensurePluginLocales } from './i18n';
import { PLUGINS } from './registry';

export interface TalkingPointConnections {
  /** The checkbox's label, or null when no enabled plugin offers connections (draw nothing). */
  label: string | null;
  on: boolean;
  setOn: (value: boolean) => void;
  /** Person id → weight, once ticked and loaded. */
  weights: ReadonlyMap<string, number> | undefined;
  /** Still finding out whether to widen the list — hold the list back rather than flash it. */
  pending: boolean;
}

/**
 * The `talkingPoints` surface: the Talking Points tab's "include their connections" checkbox.
 *
 * Same contract as the other slots — `enabled`, then `surfaces`, then `load()` — so a profile with
 * no such plugin on pays an array filter. The tick is synced in the plugin's settings under
 * `talkingPoints` (see PluginModule.talkingPointConnections).
 *
 * ponytail: one checkbox, from the first plugin offering the surface — only the social graph does.
 * One per plugin, with their weights merged by max, if a second ever appears.
 */
export function usePluginTalkingPoints(personId: string): TalkingPointConnections {
  const { t, i18n } = useTranslation();
  const enabled = useEnabledPlugins();
  const plugin = useMemo(
    () =>
      PLUGINS.find(
        (candidate) => enabled.has(candidate.id) && candidate.surfaces.includes('talkingPoints'),
      ),
    [enabled],
  );
  const [state, setState] = useState<{ id: string; on: boolean } | null>(null);

  useEffect(() => {
    if (!plugin) return;
    let cancelled = false;
    void Promise.all([getPluginSettings(plugin.id), ensurePluginLocales(plugin.id)])
      .then(([settings]) => {
        if (!cancelled) setState({ id: plugin.id, on: settings.talkingPoints === true });
      })
      .catch((err: unknown) => {
        // Strings that won't load mean no checkbox, and the plain list — never a stuck skeleton.
        captureError(err, { scope: 'plugin.talkingPoints', plugin: plugin.id });
        if (!cancelled) setState({ id: plugin.id, on: false });
      });
    return () => {
      cancelled = true;
    };
  }, [plugin, i18n.language]);

  const ready = !!plugin && state?.id === plugin.id;
  const on = ready && state.on;

  const weights = useQuery({
    // Under ['people', id] so whatever refreshes the talking points refreshes these too.
    queryKey: ['people', personId, 'plugin-connections', plugin?.id],
    enabled: on,
    // A local read, and the graph is edited on another page: always re-ask on mount.
    staleTime: 0,
    queryFn: async () => {
      try {
        const module = (await plugin!.load()).default;
        return (await module.talkingPointConnections?.(personId)) ?? new Map<string, number>();
      } catch (err) {
        captureError(err, { scope: 'plugin.talkingPoints', plugin: plugin!.id });
        return new Map<string, number>();
      }
    },
  });

  return {
    label: ready ? t(`plugins.${plugin.id}.talkingPointsToggle`) : null,
    on,
    setOn: (value) => {
      if (!plugin) return;
      setState({ id: plugin.id, on: value });
      void savePluginSettings(plugin.id, { talkingPoints: value });
    },
    weights: on ? weights.data : undefined,
    pending: !!plugin && (!ready || (on && weights.isPending)),
  };
}
