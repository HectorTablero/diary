import { Archive, ArchiveRestore, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HintTooltip } from '@/components/common/HintTooltip';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { notifyError } from '@/lib/notify';
import { captureError } from '@/lib/telemetry';
import { CATEGORY_NAME_MAX, type Category } from './model';
import type { CategoriesState } from './useExpenses';

/**
 * Renaming, retiring and adding categories.
 *
 * A category that is in use is retired, never deleted — the rule habits follows, for the same
 * reason: expenses already filed under it are diary history, and deleting it would leave them
 * pointing at nothing. A retired category drops out of the picker and keeps its name everywhere it
 * was already used.
 *
 * A *custom* category nothing was ever filed under has no history to protect, so the same button
 * deletes it outright (with an Undo) instead of leaving an empty husk in the retired list. The
 * starters are never deleted, used or not: they are the only categories with their own icons, and
 * a retired one can always be brought back as it was.
 */
export function CategoriesDialog({
  open,
  onOpenChange,
  state,
  usage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: CategoriesState;
  /** How many expenses each category id has, across every currency and month. */
  usage: ReadonlyMap<string, number>;
}) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const active = state.categories.filter((category) => !category.retired);
  const retired = state.categories.filter((category) => category.retired);

  const guard = (work: Promise<unknown>) =>
    work.catch((error: unknown) => {
      captureError(error, { scope: 'plugin.expenses.categories' });
      notifyError(t('plugins.expenses.saveFailed'));
    });

  /* The Undo lives in the dialog rather than on a toast: a modal dialog makes everything outside it
     inert, so a toast's button would be unreachable until the dialog closed — by which point the
     undo is no longer the thing anyone is thinking about. */
  const [deleted, setDeleted] = useState<string | null>(null);

  const remove = async (category: Category) => {
    const name = category.name ?? '';
    await state.deleteCategory(category);
    setDeleted(name);
  };

  const undoDelete = () => {
    if (deleted === null) return;
    // A new row, not the old id back — nothing referred to it, which is why it could go.
    void guard(state.addCategory(deleted));
    setDeleted(null);
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    void guard(state.addCategory(name));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setDeleted(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('plugins.expenses.categoriesTitle')}</DialogTitle>
          <DialogDescription>{t('plugins.expenses.categoriesDescription')}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-1.5">
          {active.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              onRename={(name) => void guard(state.renameCategory(category, name))}
              deletable={!category.builtinKey && !usage.get(category.id)}
              onToggleRetired={() =>
                void guard(
                  !category.builtinKey && !usage.get(category.id)
                    ? remove(category)
                    : state.setRetired(category, true),
                )
              }
            />
          ))}
        </ul>

        {deleted !== null && (
          <div
            className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 text-sm"
            role="status"
          >
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {t('plugins.expenses.categoryDeleted', { name: deleted })}
            </span>
            <Button variant="ghost" size="sm" className="h-7" onClick={undoDelete}>
              {t('common.undo')}
            </Button>
          </div>
        )}

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Input
            value={newName}
            maxLength={CATEGORY_NAME_MAX}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t('plugins.expenses.newCategoryPlaceholder')}
            aria-label={t('plugins.expenses.newCategoryPlaceholder')}
          />
          <Button type="submit" size="sm" className="gap-1" disabled={!newName.trim()}>
            <Plus className="size-3.5" />
            {t('common.add')}
          </Button>
        </form>

        {retired.length > 0 && (
          <div className="border-t pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {t('plugins.expenses.retiredCategories')}
            </p>
            <ul className="space-y-1.5">
              {retired.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  onRename={(name) => void guard(state.renameCategory(category, name))}
                  onToggleRetired={() => void guard(state.setRetired(category, false))}
                />
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryRow({
  category,
  onRename,
  onToggleRetired,
  deletable = false,
}: {
  category: Category;
  onRename: (name: string) => void;
  onToggleRetired: () => void;
  /** An unused custom category: the button deletes rather than retires, and says so. */
  deletable?: boolean;
}) {
  const { t } = useTranslation();
  const Icon = category.icon;
  const builtinName = category.builtinKey
    ? t(`plugins.expenses.category.${category.builtinKey}`)
    : null;
  const [draft, setDraft] = useState(category.name ?? '');
  const toggleLabel = t(
    category.retired
      ? 'plugins.expenses.restoreCategory'
      : deletable
        ? 'plugins.expenses.deleteCategory'
        : 'plugins.expenses.retireCategory',
  );

  /* Saved on blur or Enter, like the Settings page's fields — there is no Save button to forget.
     A starter's field shows its translated name as the placeholder, so clearing it reads as what it
     does: going back to that name. A custom category can't be emptied; the old name comes back. */
  const commit = () => {
    const next = draft.trim();
    if (next === (category.name ?? '')) return;
    if (!next && !category.builtinKey) {
      setDraft(category.name ?? '');
      return;
    }
    onRename(next);
  };

  return (
    <li className="flex items-center gap-2">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden
      >
        <Icon className="size-3.5" />
      </span>
      <Input
        value={draft}
        maxLength={CATEGORY_NAME_MAX}
        placeholder={builtinName ?? undefined}
        aria-label={t('plugins.expenses.renameCategory', {
          name: category.name ?? builtinName ?? '',
        })}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
        className={category.retired ? 'text-muted-foreground' : undefined}
      />
      <HintTooltip content={toggleLabel}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          aria-label={toggleLabel}
          onClick={onToggleRetired}
        >
          {category.retired ? (
            <ArchiveRestore className="size-3.5" />
          ) : deletable ? (
            <Trash2 className="size-3.5" />
          ) : (
            <Archive className="size-3.5" />
          )}
        </Button>
      </HintTooltip>
    </li>
  );
}
