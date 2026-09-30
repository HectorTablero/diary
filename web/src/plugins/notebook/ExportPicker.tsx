import type { PluginDocumentDto } from '@diary/shared';
import { ListChecks, ListX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { DocumentIcon } from './DocumentIcon';
import { useDocumentIcons } from './icons';
import { loadExportExclusions, saveExportExclusions } from './markdown';
import { documentLabel, ROOT_ID, sortDocuments } from './model';
import { useAllDocuments } from './useNotebook';

/**
 * Which documents the notebook export includes, shown in the export dialog under the plugin's own
 * options. The same flat, indented tree MoveDialog draws. Every box is its own document's alone —
 * ticking a parent never ticks its children — and a document with children gets one extra button
 * that flips all of them at once: include everything below when anything below is left out,
 * otherwise leave everything below out.
 *
 * Saved on every change, so the export builders (which read the same key) and the next visit to
 * this dialog see exactly what's ticked here.
 */
export function NotebookExportPicker() {
  const { t } = useTranslation();
  const documents = useAllDocuments();
  const icons = useDocumentIcons();
  const [excluded, setExcluded] = useState(loadExportExclusions);

  const rows = useMemo(() => {
    const childrenOf = new Map<string, PluginDocumentDto[]>();
    for (const doc of documents) {
      childrenOf.set(doc.parentId, [...(childrenOf.get(doc.parentId) ?? []), doc]);
    }
    const out: { doc: PluginDocumentDto; depth: number; descendants: string[] }[] = [];
    /* Returns every id it visited, so each row's descendants come out of the same single pass. */
    const walk = (parentId: string, depth: number): string[] => {
      const visited: string[] = [];
      for (const child of sortDocuments(childrenOf.get(parentId) ?? [])) {
        const row = { doc: child, depth, descendants: [] as string[] };
        out.push(row);
        row.descendants = walk(child.id, depth + 1);
        visited.push(child.id, ...row.descendants);
      }
      return visited;
    };
    walk(ROOT_ID, 0);
    return out;
  }, [documents]);

  const update = (change: (next: Set<string>) => void) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      change(next);
      saveExportExclusions(next);
      return next;
    });

  if (!rows.length) return null;

  return (
    <>
      <Label className="mt-2">{t('plugins.notebook.exportDocuments')}</Label>
      <div className="max-h-72 overflow-y-auto rounded-lg border">
        <ul className="divide-y">
          {rows.map(({ doc, depth, descendants }) => {
            const label = documentLabel(doc, t('plugins.notebook.untitled'));
            const icon = icons.get(doc.id);
            const anyBelowExcluded = descendants.some((id) => excluded.has(id));
            const toggleLabel = t(
              anyBelowExcluded
                ? 'plugins.notebook.exportIncludeChildren'
                : 'plugins.notebook.exportExcludeChildren',
              { name: label },
            );
            return (
              <li key={doc.id} className="flex items-center hover:bg-accent/40">
                <label
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-2 pe-2"
                  style={{ paddingInlineStart: `${0.75 + depth}rem` }}
                >
                  <Checkbox
                    checked={!excluded.has(doc.id)}
                    onCheckedChange={(v) =>
                      update((next) => (v === true ? next.delete(doc.id) : next.add(doc.id)))
                    }
                  />
                  {icon && (
                    <DocumentIcon icon={icon} className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate text-sm">{label}</span>
                </label>
                {descendants.length > 0 && (
                  <button
                    type="button"
                    className="me-1.5 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={toggleLabel}
                    title={toggleLabel}
                    onClick={() =>
                      update((next) =>
                        descendants.forEach((id) =>
                          anyBelowExcluded ? next.delete(id) : next.add(id),
                        ),
                      )
                    }
                  >
                    {anyBelowExcluded ? (
                      <ListChecks className="size-4" />
                    ) : (
                      <ListX className="size-4" />
                    )}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
