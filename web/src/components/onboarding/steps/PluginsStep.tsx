import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { ensurePluginLocales } from '@/plugins/i18n';
import { PLUGINS } from '@/plugins/registry';

/**
 * The final onboarding step: extra functionality is available via plugins.
 *
 * Previews every plugin in the catalogue directly from `PLUGINS` in `registry.ts`,
 * pre-loading their locale strings so names and descriptions render cleanly, and
 * explaining that they can be toggled anytime from Settings.
 */
export function PluginsStep() {
  const { t, i18n } = useTranslation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(PLUGINS.map((plugin) => ensurePluginLocales(plugin.id).catch(() => {}))).then(
      () => !cancelled && setReady(true),
    );
    return () => {
      cancelled = true;
    };
  }, [i18n.language]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {PLUGINS.map((plugin) => {
          const Icon = plugin.icon;
          const name = ready ? t(`plugins.${plugin.id}.name`) : plugin.id;
          const description = ready ? t(`plugins.${plugin.id}.description`) : '';
          return (
            <div
              key={plugin.id}
              className="flex items-start gap-3 rounded-xl border bg-card p-3.5 shadow-xs"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{name}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2.5 rounded-xl border border-muted bg-muted/40 p-3 text-xs text-muted-foreground">
        <Settings className="size-4 shrink-0 text-foreground" />
        <p className="min-w-0 flex-1 leading-snug">{t('onboarding.plugins.settingsNote')}</p>
      </div>
    </div>
  );
}
