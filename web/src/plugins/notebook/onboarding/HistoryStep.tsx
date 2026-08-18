import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { diffView } from '../history';

/**
 * What a thought's history looks like, drawn by the real diff.
 *
 * `diffView` is the same function the history dialog calls and the same one the stored patch format
 * is built on, so this preview cannot show a shape the app doesn't actually produce. Only the two
 * texts are fabricated — and they are the tour's example thought, one day apart.
 */
export function HistoryStep() {
  const { t } = useTranslation();
  const before = t('plugins.notebook.onboarding.history.before');
  const after = t('plugins.notebook.onboarding.history.after');
  const lines = diffView(before, after);

  return (
    <div className="rounded-xl border bg-card p-4 text-left shadow-xs">
      <p className="text-xs text-muted-foreground">
        {t('plugins.notebook.onboarding.history.caption')}
      </p>
      <div className="mt-3 rounded-lg border p-1 font-mono text-[11px] leading-6">
        {lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              'flex gap-2 rounded px-2',
              line.kind === 'added' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
              line.kind === 'removed' && 'bg-destructive/10 text-destructive',
              line.kind === 'context' && 'text-muted-foreground',
            )}
          >
            <span aria-hidden className="shrink-0 select-none opacity-60">
              {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
            </span>
            <span className="min-w-0 flex-1">{line.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
