import type { PluginDocumentDto } from '@diary/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { canMoveUnder, documentLabel, ROOT_ID, sortDocuments } from './model';
import { moveDocument, useAllDocuments } from './useNotebook';

/**
 * Where a thought should live instead.
 *
 * A flat, indented list of every document rather than an expanding tree: the notebook is the one
 * screen that legitimately loads all of them (see `getAllPluginDocuments`), and a picker whose
 * branches have to be opened one at a time is a picker you cannot scan. Indentation carries the
 * shape; the list carries the choice.
 *
 * Destinations that would break the tree are shown **disabled rather than hidden** — into itself,
 * into its own subtree (which would detach the whole branch), or deep enough to pass the depth cap.
 * Hiding them would leave someone hunting for a document that is right there; showing them greyed
 * says "not that one" without making them wonder whether they mis-remembered where it was.
 */
export function MoveDialog({
  document,
  open,
  onOpenChange,
  onMoved,
}: {
  document: PluginDocumentDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved: () => void;
}) {
  const { t } = useTranslation();
  const documents = useAllDocuments();
  const [target, setTarget] = useState<string>(document.parentId);

  const byId = useMemo(() => new Map(documents.map((doc) => [doc.id, doc])), [documents]);

  /* Depth-first, so a child always follows its parent and the indentation reads as a tree. Built
     once per open rather than per row: `ancestorPath` per document would be quadratic on a deep
     notebook, and this is the screen holding every document already. */
  const rows = useMemo(() => {
    const childrenOf = new Map<string, PluginDocumentDto[]>();
    for (const doc of documents) {
      childrenOf.set(doc.parentId, [...(childrenOf.get(doc.parentId) ?? []), doc]);
    }
    const out: { doc: PluginDocumentDto; depth: number }[] = [];
    const walk = (parentId: string, depth: number) => {
      for (const child of sortDocuments(childrenOf.get(parentId) ?? [])) {
        out.push({ doc: child, depth });
        walk(child.id, depth + 1);
      }
    };
    walk(ROOT_ID, 0);
    return out;
  }, [documents]);

  const onConfirm = async () => {
    if (target !== document.parentId) await moveDocument(document.id, target);
    onOpenChange(false);
    onMoved();
  };

  const name = documentLabel(document, t('plugins.notebook.untitled'));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('plugins.notebook.moveTitle')}</DialogTitle>
          <DialogDescription>{t('plugins.notebook.moveDescription', { name })}</DialogDescription>
        </DialogHeader>

        <ul
          className="-mx-1 min-h-0 flex-1 overflow-y-auto"
          role="radiogroup"
          aria-label={t('plugins.notebook.moveTitle')}
        >
          <Option
            label={t('plugins.notebook.title')}
            depth={0}
            selected={target === ROOT_ID}
            disabled={!canMoveUnder(document.id, ROOT_ID, documents, byId)}
            onSelect={() => setTarget(ROOT_ID)}
          />
          {rows.map(({ doc, depth }) => (
            <Option
              key={doc.id}
              label={documentLabel(doc, t('plugins.notebook.untitled'))}
              depth={depth + 1}
              selected={target === doc.id}
              disabled={!canMoveUnder(document.id, doc.id, documents, byId)}
              onSelect={() => setTarget(doc.id)}
            />
          ))}
        </ul>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void onConfirm()} disabled={target === document.parentId}>
            {t('plugins.notebook.moveConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Option({
  label,
  depth,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  depth: number;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={onSelect}
        style={{ paddingInlineStart: `${0.75 + depth * 1}rem` }}
        className={cn(
          'w-full truncate rounded-md py-2 pe-3 text-start text-sm transition-colors',
          selected && 'bg-accent text-accent-foreground',
          disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-muted',
        )}
      >
        {label}
      </button>
    </li>
  );
}
