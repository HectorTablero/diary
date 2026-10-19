import type { PluginDocumentDto } from '@diary/shared';
import {
  ChevronRight,
  Clock,
  Eye,
  FilePlus2,
  FolderInput,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { updatePluginDocument } from '@/db/pluginDocuments';
import { EmptyState } from '@/components/common/EmptyState';
import { IconPickerDialog } from '@/components/icons/IconPickerDialog';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { ContextMenu } from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { notifyDeleted } from '@/lib/undo';
import { cn } from '@/lib/utils';
import { DocumentEditorPanel } from './DocumentEditorPanel';
import { DocumentIcon } from './DocumentIcon';
import { HistoryDialog } from './HistoryDialog';
import { setDocumentIcon, useDocumentIcons } from './icons';
import { documentLabel, ROOT_ID } from './model';
import { MoveDialog } from './MoveDialog';
import { documentPreview } from './preview';
import { referencedDocumentIds } from './syntax';
import { TitleField } from './TitleField';
import { createDocument, deleteDocument, useDocumentLabels, useNotebookLevel } from './useNotebook';

/**
 * The notebook, as one page shape used at every level.
 *
 * A document is a page: its own prose at the top, the documents inside it beneath. A "folder" is
 * simply a document that has children — there is no second concept, and the container can be written
 * in like anything else, which is the whole reason the tree is a real `parentId` rather than
 * Obsidian's trick of making an index note that links to its members. Obsidian does that because a
 * filesystem folder cannot hold prose; this isn't a filesystem.
 *
 * ## Why the current document lives in the query string
 *
 * `/plugins/:pluginId` is a single route — the router walks its table on every navigation, so
 * plugins deliberately don't add their own. Keeping the open document in `?doc=` gets the browser's
 * back button, deep links and the Android hardware back key for free, which internal state would
 * each have had to reimplement badly.
 */
export default function NotebookPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const documentId = params.get('doc') ?? ROOT_ID;
  const { current, path, children, loading, reload } = useNotebookLevel(documentId);

  const [focus, setFocus] = useState(false);
  /* Owned here rather than in the editor because the control that toggles it sits in this page's
     header, beside the other things done *to* a document.

     Deliberately *not* reset by `go()` below, unlike `focus`. Reading is what someone is doing
     across a whole sitting with the notebook — following a `[[link]]` or a breadcrumb mid-read
     should land in the same mode, not snap back to source every time. Focus mode is the opposite:
     a screen-size affordance for the document just left, not a preference carried to the next one. */
  const [preview, setPreview] = useState(false);
  /* Which dialog is open, and the document it acts on: the open one from its header, or a child
     row from its right-click menu. Kept apart so closing (`dialog` → null) leaves `target` in place
     for the exit animation. */
  const [dialog, setDialog] = useState<'history' | 'move' | 'icon' | 'delete' | null>(null);
  const [target, setTarget] = useState<PluginDocumentDto | null>(null);
  const openDialog = (kind: NonNullable<typeof dialog>, doc: PluginDocumentDto) => {
    setTarget(doc);
    setDialog(kind);
  };
  const closeDialog = (open: boolean) => !open && setDialog(null);
  const icons = useDocumentIcons();
  const currentIcon = current ? (icons.get(current.id) ?? null) : null;
  /** The document `onNew` just created, so its `TitleField` can mount already in edit mode. Cleared
      by every navigation so revisiting it later doesn't reopen the title editor uninvited. */
  const [newDocId, setNewDocId] = useState<string | null>(null);

  const go = useCallback(
    (id: string) => {
      setParams(id === ROOT_ID ? {} : { doc: id });
      // Leaving a document means leaving its editor — a screen-size choice made for that document,
      // not a preference carried to the next one.
      setFocus(false);
      setNewDocId(null);
    },
    [setParams],
  );

  const onRename = useCallback(
    async (next: string) => {
      if (!current || next === current.title) return;
      await updatePluginDocument(current.id, { title: next });
      await reload();
    },
    [current, reload],
  );

  const onNew = useCallback(async () => {
    const created = await createDocument(documentId);
    await reload();
    go(created.id);
    // After go(), which just cleared it — creating is the one moment this should be set.
    setNewDocId(created.id);
  }, [documentId, go, reload]);

  const onDelete = useCallback(
    async (doc: PluginDocumentDto) => {
      const { deletion, count } = await deleteDocument(doc.id);
      /* An undo on the toast, like every other delete in this app — and this is the one that most
       needs it. An entry can be typed again from memory; a document is prose that existed nowhere
       else, and deleting a container takes everything under it in one press. */
      notifyDeleted(t('plugins.notebook.deleted', { count }), deletion);
      if (doc.id === current?.id) go(doc.parentId);
      else await reload();
    },
    [current, go, reload, t],
  );

  const label = current ? documentLabel(current, t('plugins.notebook.untitled')) : '';
  const targetLabel = target ? documentLabel(target, t('plugins.notebook.untitled')) : '';

  /* One lookup for every `[[id]]` in every row's preview, rather than one per row. */
  const referencedIds = useMemo(
    () => [...new Set(children.flatMap((child) => referencedDocumentIds(child.body)))],
    [children],
  );
  const { labels: documentLabels } = useDocumentLabels(referencedIds);

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-40 w-full" />
      </PageContainer>
    );
  }

  return (
    <PageContainer className={cn(focus && 'max-w-2xl')}>
      {!focus && (
        <>
          <Breadcrumb path={path} onNavigate={go} />
          <PageHeader
            /* The heading *is* the title field — one string on screen, edited where it is shown.
               See TitleField for why there is no second copy of it inside the editor. */
            title={
              current ? (
                <span className="flex items-center gap-2">
                  {/* The icon is its own control, in front of the title it belongs to. With none
                      chosen ("No icon" is the default) the slot stays, faint, so there is always
                      somewhere to click to add one. */}
                  <button
                    type="button"
                    onClick={() => openDialog('icon', current)}
                    aria-label={t('plugins.notebook.changeIcon')}
                    className={cn(
                      'shrink-0 rounded-md p-1 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
                      currentIcon ? 'text-muted-foreground' : 'text-muted-foreground/40',
                    )}
                  >
                    {currentIcon ? (
                      <DocumentIcon icon={currentIcon} className="size-5" />
                    ) : (
                      <SmilePlus aria-hidden className="size-5" />
                    )}
                  </button>
                  <span className="min-w-0 flex-1">
                    <TitleField
                      key={current.id}
                      title={current.title}
                      label={label}
                      startEditing={newDocId === current.id}
                      onCommit={(next) => void onRename(next)}
                    />
                  </span>
                </span>
              ) : (
                t('plugins.notebook.title')
              )
            }
            actions={
              <>
                {current && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={preview}
                    onClick={() => setPreview((value) => !value)}
                  >
                    {preview ? (
                      <Pencil className="size-4" aria-hidden />
                    ) : (
                      <Eye className="size-4" aria-hidden />
                    )}
                    <span className="hidden sm:inline">
                      {t(preview ? 'plugins.notebook.edit' : 'plugins.notebook.preview')}
                    </span>
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => void onNew()}>
                  <FilePlus2 className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{t('plugins.notebook.new')}</span>
                </Button>
                {current && (
                  <DocumentMenu
                    onFocus={() => setFocus(true)}
                    onHistory={() => openDialog('history', current)}
                    onMove={() => openDialog('move', current)}
                    onDelete={() => openDialog('delete', current)}
                  />
                )}
              </>
            }
          />
        </>
      )}

      {current ? (
        <DocumentEditorPanel
          key={current.id}
          documentId={current.id}
          focus={focus}
          preview={preview}
          /* Leaving an untouched new document deletes it (see discardIfUntouched). That happens
             during the editor's unmount, which races this level's own reload for the parent — so
             the reload is re-run afterwards rather than left showing a row that no longer exists. */
          onDiscarded={() => void reload()}
        />
      ) : (
        children.length === 0 && (
          <EmptyState
            icon={NotebookPen}
            title={t('plugins.notebook.emptyTitle')}
            description={t('plugins.notebook.emptyDescription')}
          />
        )
      )}

      {focus && (
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setFocus(false)}>
            <Minimize2 className="size-4" aria-hidden />
            {t('plugins.notebook.focusExit')}
          </Button>
        </div>
      )}

      {!focus && (children.length > 0 || current) && (
        <section className="mt-8" aria-labelledby="notebook-children">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="notebook-children" className="text-sm font-medium text-muted-foreground">
              {t('plugins.notebook.inside')}
            </h2>
          </div>
          {children.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {t('plugins.notebook.noChildren')}
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {children.map((child) => {
                const childLabel = documentLabel(child, t('plugins.notebook.untitled'));
                const preview = documentPreview(child.body, childLabel, documentLabels);
                const childIcon = icons.get(child.id);
                return (
                  <ContextMenu
                    key={child.id}
                    menu={
                      <>
                        <DropdownMenuItem onSelect={() => go(child.id)}>
                          <ChevronRight className="size-4" aria-hidden />
                          {t('plugins.notebook.open')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => openDialog('icon', child)}>
                          <SmilePlus className="size-4" aria-hidden />
                          {t('plugins.notebook.changeIcon')}
                        </DropdownMenuItem>
                        <DocumentActions
                          onHistory={() => openDialog('history', child)}
                          onMove={() => openDialog('move', child)}
                          onDelete={() => openDialog('delete', child)}
                        />
                      </>
                    }
                  >
                    <li>
                      <button
                        type="button"
                        onClick={() => go(child.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
                      >
                        {childIcon && (
                          <DocumentIcon
                            icon={childIcon}
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{childLabel}</span>
                          {preview && (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {preview}
                            </span>
                          )}
                        </span>
                        <ChevronRight
                          aria-hidden
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                      </button>
                    </li>
                  </ContextMenu>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {target && dialog === 'history' && (
        <HistoryDialog documentId={target.id} title={targetLabel} open onOpenChange={closeDialog} />
      )}
      {target && dialog === 'move' && (
        <MoveDialog
          document={target}
          open
          onOpenChange={closeDialog}
          onMoved={() => void reload()}
        />
      )}
      {target && (
        <IconPickerDialog
          open={dialog === 'icon'}
          onOpenChange={closeDialog}
          title={t('plugins.notebook.iconFor', { name: targetLabel })}
          value={icons.get(target.id) ?? null}
          emptyOption={{ label: t('iconPicker.none') }}
          onChange={(icon) => void setDocumentIcon(target.id, icon)}
        />
      )}
      {target && (
        <ConfirmDialog
          open={dialog === 'delete'}
          onOpenChange={closeDialog}
          title={t('plugins.notebook.deleteTitle')}
          description={t('plugins.notebook.deleteDescription', { name: targetLabel })}
          onConfirm={() => void onDelete(target)}
        />
      )}
    </PageContainer>
  );
}

/** The way back up. The root is a link too, so there is always somewhere to go from any depth. */
function Breadcrumb({
  path,
  onNavigate,
}: {
  path: PluginDocumentDto[];
  onNavigate: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (!path.length) return null;

  return (
    <nav aria-label={t('plugins.notebook.breadcrumb')} className="mb-3">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <li>
          <button
            type="button"
            onClick={() => onNavigate(ROOT_ID)}
            className="rounded px-1 py-0.5 hover:text-foreground hover:underline"
          >
            {t('plugins.notebook.title')}
          </button>
        </li>
        {/* The last crumb is the page's own heading, so it is not repeated as a link here. */}
        {path.slice(0, -1).map((doc) => (
          <li key={doc.id} className="flex items-center gap-1">
            <ChevronRight aria-hidden className="size-3" />
            <button
              type="button"
              onClick={() => onNavigate(doc.id)}
              className="max-w-40 truncate rounded px-1 py-0.5 hover:text-foreground hover:underline"
            >
              {documentLabel(doc, t('plugins.notebook.untitled'))}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Everything a document can have done to it, behind one button.
 *
 * A menu rather than a row of buttons because of the phone: the user asked for the same capabilities
 * there as on the desktop, and four actions in a header is how a phone header stops fitting its
 * title. Focus mode lives here for the same reason — it is most useful exactly where the screen is
 * smallest.
 */
function DocumentMenu({
  onFocus,
  onHistory,
  onMove,
  onDelete,
}: {
  onFocus: () => void;
  onHistory: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('plugins.notebook.documentActions')}>
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onFocus}>
          <Maximize2 className="size-4" aria-hidden />
          {t('plugins.notebook.focus')}
        </DropdownMenuItem>
        <DocumentActions onHistory={onHistory} onMove={onMove} onDelete={onDelete} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What can be done to any document, open or not: the header's ⋯ menu and a child row's
    right-click menu both end with these. */
function DocumentActions({
  onHistory,
  onMove,
  onDelete,
}: {
  onHistory: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenuItem onSelect={onHistory}>
        <Clock className="size-4" aria-hidden />
        {t('plugins.notebook.history')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onMove}>
        <FolderInput className="size-4" aria-hidden />
        {t('plugins.notebook.move')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={onDelete}>
        <Trash2 className="size-4" aria-hidden />
        {t('plugins.notebook.delete')}
      </DropdownMenuItem>
    </>
  );
}
