import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * What the notebook's one page shape looks like: a document's own prose, with the documents inside
 * it beneath.
 *
 * Hand-drawn rather than rendered through NotebookPage. Unlike the calendar step next door — which
 * borrows the app's real shading function so a changed hue cannot drift out of step with its own
 * tour — there is nothing here whose *value* could go stale: this is a picture of a layout, and
 * mounting the real page would mean standing up an editor, a Dexie read and a router for it.
 */
export function TreeStep() {
  const { t } = useTranslation();
  /* Three flat keys rather than one array value. `returnObjects` puts a structure into a locale
     file, and checkI18n reasons about keys — an array member added in one language and not another
     is exactly the drift it exists to catch, and it could not see it. */
  const children = [
    t('plugins.notebook.onboarding.tree.childOne'),
    t('plugins.notebook.onboarding.tree.childTwo'),
    t('plugins.notebook.onboarding.tree.childThree'),
  ];

  return (
    <div className="rounded-xl border bg-card p-4 text-left shadow-xs">
      <p className="text-xs text-muted-foreground">
        {t('plugins.notebook.title')} › {t('plugins.notebook.onboarding.tree.crumb')}
      </p>
      <h3 className="mt-1 text-sm font-semibold">
        {t('plugins.notebook.onboarding.tree.heading')}
      </h3>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">
        {t('plugins.notebook.onboarding.tree.body')}
      </p>

      <p className="mt-4 mb-1 text-xs font-medium text-muted-foreground">
        {t('plugins.notebook.inside')}
      </p>
      <ul className="divide-y rounded-lg border">
        {children.map((child) => (
          <li key={child} className="flex items-center gap-2 px-3 py-2 text-xs">
            <span className="min-w-0 flex-1 truncate">{child}</span>
            <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          </li>
        ))}
      </ul>
    </div>
  );
}
