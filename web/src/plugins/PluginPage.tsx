import { Compass } from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { notifyError } from '@/lib/notify';
import { captureError } from '@/lib/telemetry';
import { setPluginEnabled, useEnabledPlugins } from './enabled';
import { ensurePluginLocales } from './i18n';
import { syncNativeWidgets } from './nativeWidgets';
import { PluginOnboarding } from './PluginOnboarding';
import { findPlugin, type PluginManifest } from './registry';
import type { PluginModule } from './types';

/**
 * The single route behind every plugin's own screen: `/plugins/:pluginId`.
 *
 * One parameterised route rather than one per plugin, because the router walks its table on every
 * navigation — N routes would make every page transition in the app slightly slower for the benefit
 * of people who have plugins. It is also deliberately absent from `pages/lazyPages.ts`: AppLayout
 * warms every entry of that map on idle, so a plugin registered there would download for everyone.
 *
 * A plugin that is switched off gets the same answer /threads gives: a page saying so, with the
 * switch right there. It is reachable by ordinary means — a bookmark kept after disabling it, a link
 * from another device — and the one thing that visit was after is the plugin, so offering it beats
 * dropping the person on the diary to go and find the setting. Only its strings are fetched for
 * that, never its chunk.
 *
 * An unknown id, or a plugin with no page of its own, still redirects to the diary: there is
 * nothing to offer there.
 */
export default function PluginPage() {
  const { pluginId = '' } = useParams<{ pluginId: string }>();
  const enabled = useEnabledPlugins();
  const manifest = findPlugin(pluginId);

  if (!manifest?.surfaces.includes('page')) return <Navigate to="/diary" replace />;
  if (!enabled.has(pluginId)) return <DisabledPluginPage key={pluginId} manifest={manifest} />;
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

/** The quick-enable screen for a plugin that is switched off. See the note on PluginPage. */
function DisabledPluginPage({ manifest }: { manifest: PluginManifest }) {
  const { t, i18n } = useTranslation();
  const [ready, setReady] = useState(false);
  const [touring, setTouring] = useState(false);
  const Icon = manifest.icon;
  const switchId = `plugin-page-enable-${manifest.id}`;

  useEffect(() => {
    let cancelled = false;
    ensurePluginLocales(manifest.id)
      .catch((err: unknown) => captureError(err, { scope: 'plugin.page', plugin: manifest.id }))
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [manifest.id, i18n.language]);

  if (!ready) {
    return (
      <PageContainer>
        <Skeleton className="h-40 w-full" />
      </PageContainer>
    );
  }

  // The id stands in if the plugin's strings didn't arrive, rather than a raw translation key.
  const name = t(`plugins.${manifest.id}.name`, { defaultValue: manifest.id });

  return (
    <PageContainer>
      <PageHeader title={name} />
      <EmptyState
        icon={Icon}
        title={t('settings.plugins.disabledTitle', { name })}
        description={t('settings.plugins.disabledDescription')}
      >
        {/* The same shape as the Threads page's switch card, so the two read as one idiom. */}
        <div className="mt-3 flex w-full max-w-sm items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-xs">
          <Icon aria-hidden className="size-6.5 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Label htmlFor={switchId}>{name}</Label>
            <p className="text-xs text-muted-foreground">
              {t(`plugins.${manifest.id}.description`, { defaultValue: '' })}
            </p>
          </div>
          <Switch
            id={switchId}
            checked={false}
            onCheckedChange={(checked) => {
              if (!checked) return;
              /* Once it lands, `enabled` flips and PluginPage renders the real page in this
                 component's place — nothing to navigate. */
              setPluginEnabled(manifest.id, true).then(
                () => void syncNativeWidgets(),
                (err: unknown) => {
                  captureError(err, { scope: 'plugins.toggle', plugin: manifest.id });
                  notifyError(t('settings.plugins.saveFailed'));
                },
              );
            }}
          />
        </div>
        {manifest.surfaces.includes('onboarding') && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 gap-1.5 text-muted-foreground"
            onClick={() => setTouring(true)}
          >
            <Compass className="size-4" />
            {t('settings.plugins.tourButton')}
          </Button>
        )}
      </EmptyState>
      {touring && <PluginOnboarding pluginId={manifest.id} onDone={() => setTouring(false)} />}
    </PageContainer>
  );
}
