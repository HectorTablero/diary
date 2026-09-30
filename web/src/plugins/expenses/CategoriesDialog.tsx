import { Archive, ArchiveRestore, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HintTooltip } from '@/components/common/HintTooltip';
import { iconOrDefault } from '@/components/icons/iconCatalog';
import { IconPickerDialog } from '@/components/icons/IconPickerDialog';
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
import { cn } from '@/lib/utils';
import {
  CATEGORY_NAME_MAX,
  CUSTOM_CATEGORY_ICON,
  CUSTOM_CATEGORY_ICON_NAME,
  type Category,
} from './model';
import type { CategoriesState } from './useExpenses';

/**
 * Renaming, re-iconing, retiring, deleting and adding categories.
 *
 * A category that is in use is retired, never deleted — the rule habits follows, for the same
 * reason: expenses already filed under it are diary history, and deleting it would leave them
 * pointing at nothing. A retired category drops out of the picker and keeps its name everywhere it
 * was already used.
 *
 * A category nothing was ever filed under has no history to protect, so the same button deletes it
 * outright (with an Undo) instead of leaving an empty husk in the retired list. That includes the
 * starters: they used to be retire-only because they were the only categories with icons, so
 * deleting one lost something a custom category could not give back. Every category can have any
 * icon now, and a starter's default is still one tap away under "Default" in the icon picker.
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
  const [newIcon, setNewIcon] = useState<string | null>(null);
  /** Whose icon the picker is choosing: a category, the one being added, or nobody. */
  const [picking, setPicking] = useState<Category | 'new' | null>(null);
  const active = state.categories.filter((category) => !category.retired);
  const retired = state.categories.filter((category) => category.retired);

  const nameOf = (category: Category) =>
    category.name ??
    (category.builtinKey ? t(`plugins.expenses.category.${category.builtinKey}`) : '');

  const guard = (work: Promise<unknown>) =>
    work.catch((error: unknown) => {
      captureError(error, { scope: 'plugin.expenses.categories' });
      notifyError(t('plugins.expenses.saveFailed'));
    });

  /* The Undo lives in the dialog rather than on a toast: a modal dialog makes everything outside it
     inert, so a toast's button would be unreachable until the dialog closed — by which point the
     undo is no longer the thing anyone is thinking about. */
  const [deleted, setDeleted] = useState<{ name: string; undo: () => Promise<void> } | null>(null);

  const remove = async (category: Category) => {
    const name = nameOf(category);
    const undo = await state.deleteCategory(category);
    setDeleted({ name, undo });
  };

  const undoDelete = () => {
    if (deleted === null) return;
    void guard(deleted.undo());
    setDeleted(null);
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    setNewIcon(null);
    void guard(state.addCategory(name, newIcon));
  };

  const NewIcon = iconOrDefault(newIcon, CUSTOM_CATEGORY_ICON);
  const pickingCategory = picking !== null && picking !== 'new' ? picking : null;

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
          {active.map((category) => {
            const deletable = !usage.get(category.id);
            return (
              <CategoryRow
                key={category.id}
                category={category}
                onRename={(name) => void guard(state.renameCategory(category, name))}
                onPickIcon={() => setPicking(category)}
                deletable={deletable}
                onToggleRetired={() =>
                  void guard(deletable ? remove(category) : state.setRetired(category, true))
                }
              />
            );
          })}
        </ul>

        {deleted !== null && (
          <div
            className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 text-sm"
            role="status"
          >
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {t('plugins.expenses.categoryDeleted', { name: deleted.name })}
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
          <IconButton
            icon={NewIcon}
            label={t('plugins.expenses.newCategoryIcon')}
            onClick={() => setPicking('new')}
          />
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
                  onPickIcon={() => setPicking(category)}
                  onToggleRetired={() => void guard(state.setRetired(category, false))}
                />
              ))}
            </ul>
          </div>
        )}
      </DialogContent>

      <IconPickerDialog
        open={picking !== null}
        onOpenChange={(next) => !next && setPicking(null)}
        title={
          pickingCategory
            ? t('plugins.expenses.iconFor', { name: nameOf(pickingCategory) })
            : t('plugins.expenses.newCategoryIcon')
        }
        value={pickingCategory ? pickingCategory.iconName : newIcon}
        emptyOption={{
          label: t('iconPicker.default'),
          icon: pickingCategory ? pickingCategory.defaultIcon : CUSTOM_CATEGORY_ICON,
          iconName: pickingCategory ? pickingCategory.defaultIconName : CUSTOM_CATEGORY_ICON_NAME,
        }}
        onChange={(icon) => {
          if (pickingCategory) void guard(state.setIcon(pickingCategory, icon));
          else setNewIcon(icon);
        }}
      />
    </Dialog>
  );
}

/** The round icon at the start of a row, which is also the way to change it. */
function IconButton({
  icon: Icon,
  label,
  onClick,
  muted = false,
}: {
  icon: Category['icon'];
  label: string;
  onClick: () => void;
  muted?: boolean;
}) {
  return (
    <HintTooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full bg-muted transition-colors',
          'hover:bg-muted-foreground/15 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          muted ? 'text-muted-foreground/70' : 'text-muted-foreground',
        )}
      >
        <Icon aria-hidden className="size-3.5" />
      </button>
    </HintTooltip>
  );
}

function CategoryRow({
  category,
  onRename,
  onPickIcon,
  onToggleRetired,
  deletable = false,
}: {
  category: Category;
  onRename: (name: string) => void;
  onPickIcon: () => void;
  onToggleRetired: () => void;
  /** An unused category: the button deletes rather than retires, and says so. */
  deletable?: boolean;
}) {
  const { t } = useTranslation();
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
      <IconButton
        icon={category.icon}
        label={t('plugins.expenses.changeIcon', { name: category.name ?? builtinName ?? '' })}
        onClick={onPickIcon}
        muted={category.retired}
      />
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
