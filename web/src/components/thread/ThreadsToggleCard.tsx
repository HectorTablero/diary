import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSetThreadsEnabled, useThreadsEnabled } from '@/api/hooks';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { notifyError } from '@/lib/notify';
import { cn } from '@/lib/utils';

/**
 * The Threads switch as a standalone card, for the two places that offer it outside Settings: the
 * /threads page while the feature is off, and the Threads step of the tour. Drawn like the
 * importance-shapes card in that tour, and with no success toast for the same reason: what the
 * switch does appears right there (the page fills in, the chips show up later).
 */
export function ThreadsToggleCard({ id, className }: { id: string; className?: string }) {
  const { t } = useTranslation();
  const on = useThreadsEnabled();
  const setEnabled = useSetThreadsEnabled();

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-xs',
        className,
      )}
    >
      <GitBranch aria-hidden className="size-6.5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Label htmlFor={id}>{t('settings.entries.threads')}</Label>
        <p className="text-xs text-muted-foreground">{t('settings.entries.threadsDescription')}</p>
      </div>
      <Switch
        id={id}
        checked={on}
        onCheckedChange={(checked) =>
          setEnabled.mutate(checked, { onError: () => notifyError(t('errors.unknown')) })
        }
      />
    </div>
  );
}
