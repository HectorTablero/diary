import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';
import { PageContainer } from '@/components/layout/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { captureError } from '@/lib/telemetry';
import { useEnabledPlugins } from './enabled';
import { ensurePluginLocales } from './i18n';
import { findPlugin } from './registry';
import type { PluginModule } from './types';

/**
 * The single route behind every plugin's own screen: `/plugins/:pluginId`.
 *
 * One parameterised route rather than one per plugin, because the router walks its table on every
 * navigation — N routes would make every page transition in the app slightly slower for the benefit
 * of people who have plugins. It is also deliberately absent from `pages/lazyPages.ts`: AppLayout
 * warms every entry of that map on idle, so a plugin registered there would download for everyone.
 *
 * An unknown id, or one whose plugin is switched off, redirects to the diary rather than showing an
 * error. Both are reachable by ordinary means — a bookmark kept after disabling a plugin, a link
 * from another device — and neither is a mistake worth interrupting someone over.
 */
export default function PluginPage() {
  const { pluginId = '' } = useParams<{ pluginId: string }>();
  const enabled = useEnabledPlugins();
  const manifest = findPlugin(pluginId);
  const available = manifest?.surfaces.includes('page') && enabled.has(pluginId);

  if (!available) return <Navigate to="/diary" replace />;
  // Keyed so switching between two plugin pages remounts rather than reusing the loaded module.
  return <LoadedPluginPage key={pluginId} pluginId={pluginId} />;
}

function LoadedPluginPage({ pluginId }: { pluginId: string }) {
  const { i18n } = useTranslation();
  const [state, setState] = useState<{ Page: ComponentType | null; failed: boolean }>({
    Page: null,
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const manifest = findPlugin(pluginId);
      if (!manifest) return;
      try {
        const [module] = await Promise.all([manifest.load(), ensurePluginLocales(pluginId)]);
        if (cancelled) return;
        setState({ Page: (module.default as PluginModule).Page ?? null, failed: false });
      } catch (err) {
        captureError(err, { scope: 'plugin.page', plugin: pluginId });
        if (!cancelled) setState({ Page: null, failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pluginId, i18n.language]);

  /* A whole screen, so unlike the day widget this does show a placeholder: here the chunk is the
     only thing on the page, and an empty container would read as a broken app rather than as
     something arriving. A failure falls back to the diary for the same reason the guard above
     does — there is nothing useful to say about a chunk that would not load. */
  if (state.failed) return <Navigate to="/diary" replace />;
  if (!state.Page) {
    return (
      <PageContainer>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-4 h-32 w-full" />
      </PageContainer>
    );
  }
  return <state.Page />;
}
