import type { TagWithStats } from '@diary/shared';
import { Pencil, Plus, Tag as TagIcon, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from '@/api/hooks';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { BOTTOM_NAV_ONLY, SIDEBAR_ONLY, SIDEBAR_ONLY_SR } from '@/components/layout/ExploreLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { notifyError, notifySuccess } from '@/lib/notify';
import { notifyDeleted } from '@/lib/undo';
import { ApiError } from '@/lib/apiClient';
import { cn } from '@/lib/utils';

function TagFormDialog({
  tag,
  open,
  onOpenChange,
}: {
  tag: TagWithStats | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const createTag = useCreateTag();
  const updateTag = useUpdateTag();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#4ECDC4');

  // Reset fields each time the dialog opens for a (possibly different) tag.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (open && openedFor !== (tag?.id ?? 'new')) {
    setOpenedFor(tag?.id ?? 'new');
    setName(tag?.name ?? '');
    setColor(tag?.color ?? '#4ECDC4');
  }
  if (!open && openedFor !== null) setOpenedFor(null);

  const pending = createTag.isPending || updateTag.isPending;

  const submit = async () => {
    if (!name.trim() || pending) return;
    try {
      if (tag) await updateTag.mutateAsync({ id: tag.id, input: { name: name.trim(), color } });
      else await createTag.mutateAsync({ name: name.trim(), color });
      notifySuccess(t('tags.tagSaved'));
      onOpenChange(false);
    } catch (err) {
      notifyError(t(err instanceof ApiError ? err.code : 'errors.unknown'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{tag ? t('tags.editTag') : t('tags.addTag')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tag-name">{t('tags.name')}</Label>
            <Input
              id="tag-name"
              value={name}
              autoFocus
              placeholder={t('tags.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tag-color">{t('tags.color')}</Label>
            <div className="flex items-center gap-2">
              <input
                id="tag-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="size-9 cursor-pointer rounded-md border bg-transparent p-1"
              />
              <Input
                value={color}
                onChange={(e) => {
                  if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setColor(e.target.value);
                }}
                className="w-28 font-mono text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={submit}
              disabled={!name.trim() || !/^#[0-9A-Fa-f]{6}$/.test(color) || pending}
            >
              {pending && <Spinner className="size-3.5" />}
              {t('common.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function TagsPage() {
  const { t } = useTranslation();
  const { data: tags, isLoading } = useTags();
  const deleteTag = useDeleteTag();
  const [editing, setEditing] = useState<TagWithStats | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<TagWithStats | null>(null);

  return (
    <>
      {/* Only the page's *name* collapses under the bottom tab bar, not the row: the create button
          has to stay reachable, and PageHeader's `ml-auto` keeps it on the right once the h1 has
          nothing but the count left in it. */}
      <PageHeader
        title={
          <span className="flex items-baseline gap-2">
            {/* Under the bottom tab bar the switcher above is what names the page, so the word
                itself only has to reach a screen reader — but it must still reach one, or the
                page would have no heading at all. */}
            <span className={SIDEBAR_ONLY_SR}>{t('tags.title')}</span>
            {tags && tags.length > 0 && (
              <>
                <span
                  className={cn(
                    'flex h-6 min-w-6 items-center justify-center rounded-full bg-muted text-[12px] font-medium text-muted-foreground',
                    SIDEBAR_ONLY,
                  )}
                >
                  <span className="sr-only">{t('tags.count', { count: tags.length })}</span>
                  <span className="px-2">{tags.length}</span>
                </span>
                {/* Spelled out rather than a bare badge here: with the title hidden, a lone number
                    sitting next to a button reads as nothing in particular. */}
                <span className={cn('text-sm font-normal text-muted-foreground', BOTTOM_NAV_ONLY)}>
                  {t('tags.count', { count: tags.length })}
                </span>
              </>
            )}
          </span>
        }
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t('tags.addTag')}
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : tags && tags.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs"
            >
              <span
                className="size-4 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  <span className="text-muted-foreground">#</span>
                  {tag.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('tags.usage', { entries: tag.entryCount, people: tag.personCount })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label={t('tags.editTag')}
                onClick={() => {
                  setEditing(tag);
                  setFormOpen(true);
                }}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                aria-label={t('tags.deleteTag')}
                onClick={() => setDeleting(tag)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={TagIcon}
          title={t('tags.noTags')}
          description={t('tags.noTagsDescription')}
        />
      )}

      <TagFormDialog tag={editing} open={formOpen} onOpenChange={setFormOpen} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('tags.deleteConfirmTitle', { name: deleting?.name ?? '' })}
        description={t('tags.deleteConfirmDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (!deleting) return;
          deleteTag.mutate(deleting.id, {
            onSuccess: (deletion) => notifyDeleted(t('tags.tagDeleted'), deletion),
            onError: () => notifyError(t('errors.unknown')),
          });
        }}
      />
    </>
  );
}
