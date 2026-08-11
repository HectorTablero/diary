import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { captureError } from '@/lib/telemetry';
import { ensurePluginLocales } from './i18n';
import type { PluginManifest } from './registry';
import type { PluginCalendarDay, PluginCalendarViewProps } from './types';

/**
 * Loads one plugin's calendar chunk and mounts its (headless) `CalendarView`, only while that
 * plugin's tab is the one selected on the calendar page.
 *
 * Renders nothing itself — it exists to own the async loading state the way `PluginDayWidget` does
 * for the day page, and for the same reason: a plugin chunk that fails to fetch must not be able to
 * take down a page whose primary job is browsing the diary. `onData` simply never fires in that
 * case, which leaves the calendar showing no data for the picked view rather than throwing.
 */
export function PluginCalendarSlot({
  plugin,
  start,
  end,
  onData,
}: {
  plugin: PluginManifest;
  start: string;
  end: string;
  onData: (data: ReadonlyMap<string, PluginCalendarDay>) => void;
}) {
  const { i18n } = useTranslation();
  const [View, setView] = useState<ComponentType<PluginCalendarViewProps> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [module] = await Promise.all([plugin.load(), ensurePluginLocales(plugin.id)]);
        if (cancelled) return;
        // `?? null` rather than an assertion: a manifest can claim a surface its module doesn't
        // fill, and the honest response is to report nothing rather than crash the calendar.
        setView(() => module.default.CalendarView ?? null);
      } catch (err) {
        captureError(err, { scope: 'plugin.calendarView', plugin: plugin.id });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plugin, i18n.language]);

  if (!View) return null;
  const CalendarView = View;
  return <CalendarView start={start} end={end} onData={onData} />;
}
