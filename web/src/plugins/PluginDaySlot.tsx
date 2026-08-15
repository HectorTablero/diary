import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { captureError } from '@/lib/telemetry';
import { cn } from '@/lib/utils';
import { useEnabledPlugins } from './enabled';
import { ensurePluginLocales } from './i18n';
import { PLUGINS, type PluginManifest } from './registry';

/**
 * The day page's plugin surface, rendered below the composer.
 *
 * Below rather than above: writing an entry is the page's primary action and keeps its position,
 * and a plugin chunk that resolves late then cannot reflow the composer out from under a cursor
 * already in it.
 *
 * ## What this component is really for
 *
 * Rendering widgets is the easy half. The half that matters is *not* rendering them, at no cost, for
 * the people who have no plugins on — which is most people, and stays most people however many
 * plugins ship. So the order of the two checks below is load-bearing and is asserted by a test:
 *
 *   enabled?  →  declares 'day'?  →  only then load()
 *
 * With nothing enabled the first check fails for every manifest and this renders `null` having
 * issued no import, touched no network, and read nothing from Dexie. With something enabled but no
 * day widget, the second check fails and the chunk is still never fetched — which is why `surfaces`
 * exists on the manifest at all.
 */
export function PluginDaySlot({
  dateKey,
  className,
  onHasContentChange,
}: {
  dateKey: string;
  className?: string;
  onHasContentChange?: (hasContent: boolean) => void;
}) {
  const enabled = useEnabledPlugins();
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter on `enabled` first: it is the check that is false for almost everyone, so it is the one
  // that should short-circuit. `surfaces` narrows what is left to plugins that actually draw here.
  // Sorted by `dayOrder` — a display concern, independent of `PLUGINS`' own append-only order (see
  // the field's doc comment in registry.ts). `.filter()` already returns a fresh array, so sorting
  // it in place doesn't touch `PLUGINS` itself.
  const active = PLUGINS.filter(
    (plugin) => enabled.has(plugin.id) && plugin.surfaces.includes('day'),
  ).sort((a, b) => (a.dayOrder ?? 0) - (b.dayOrder ?? 0));

  useEffect(() => {
    if (!active.length) {
      onHasContentChange?.(false);
    }
  }, [active.length, dateKey, onHasContentChange]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const check = () => {
      const visible = el.children.length > 0;
      onHasContentChange?.(visible);
    };

    check();
    const observer = new MutationObserver(check);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [dateKey, active.length, onHasContentChange]);

  if (!active.length) return null;

  return (
    <div ref={containerRef} className={cn('space-y-4 @container', className)}>
      {active.map((plugin) => (
        <PluginDayWidget key={plugin.id} plugin={plugin} dateKey={dateKey} />
      ))}
    </div>
  );
}

/**
 * One plugin's widget: its chunk and its strings, fetched together, rendered when both arrive.
 *
 * Nothing is shown while loading. A skeleton would be worse than the gap it fills — this sits at the
 * bottom of the page, below the fold on a phone, and a placeholder that resolves in a few hundred
 * milliseconds only draws the eye to something that was about to appear anyway.
 *
 * A plugin that fails to load renders nothing and reports itself. It cannot be allowed to throw:
 * this is the diary's main screen, and a broken habit tracker must not be able to take it down.
 */
function PluginDayWidget({ plugin, dateKey }: { plugin: PluginManifest; dateKey: string }) {
  const { i18n } = useTranslation();
  const [Widget, setWidget] = useState<ComponentType<{ dateKey: string }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        /* Strings and code together: a widget that mounts before its locale has landed renders raw
           keys for a frame, which is more jarring than the moment of nothing it replaces. */
        const [module] = await Promise.all([plugin.load(), ensurePluginLocales(plugin.id)]);
        if (cancelled) return;
        // `?? null` rather than an assertion: a manifest can claim a surface its module doesn't
        // fill, and the honest response is to draw nothing rather than crash the day page.
        setWidget(() => module.default.DayWidget ?? null);
      } catch (err) {
        captureError(err, { scope: 'plugin.dayWidget', plugin: plugin.id });
      }
    })();
    return () => {
      cancelled = true;
    };
    // i18n.language is a dependency because ensurePluginLocales is per-language: switching language
    // with a widget on screen has to fetch that language's strings before the re-render reads them.
  }, [plugin, i18n.language]);

  if (!Widget) return null;
  return <Widget dateKey={dateKey} />;
}
