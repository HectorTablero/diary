import { useTranslation } from 'react-i18next';
import { diffView } from '../history';
import { ProseDiff } from '../ProseDiff';

/**
 * What a thought's history looks like, drawn by the real diff.
 *
 * `diffView` is the same function the history dialog calls and the same one the stored patch format
 * is built on, and `ProseDiff` is the same component the dialog renders it with — so this preview
 * cannot show a shape the app doesn't actually produce. Only the two texts are fabricated, and they
 * are the tour's example thought, one day apart.
 */
export function HistoryStep() {
  const { t } = useTranslation();
  const before = t('plugins.notebook.onboarding.history.before');
  const after = t('plugins.notebook.onboarding.history.after');

  return (
    <div className="rounded-xl border bg-card p-4 text-left shadow-xs">
      <p className="text-xs text-muted-foreground">
        {t('plugins.notebook.onboarding.history.caption')}
      </p>
      <ProseDiff
        blocks={diffView(before, after)}
        className="mt-3 rounded-lg border p-2 text-[13px] leading-5"
      />
    </div>
  );
}
