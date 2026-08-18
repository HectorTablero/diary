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
  Trash2,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { updatePluginDocument } from '@/db/pluginDocuments';
import { EmptyState } from '@/components/common/EmptyState';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
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
import { HistoryDialog } from './HistoryDialog';
import { documentLabel, documentPreview, ROOT_ID } from './model';
import { MoveDialog } from './MoveDialog';
import { TitleField } from './TitleField';
import { createDocument, deleteDocument, useNotebookLevel } from './useNotebook';

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
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

  const onDelete = useCallback(async () => {
    if (!current) return;
    const parentId = current.parentId;
    const { deletion, count } = await deleteDocument(current.id);
    /* An undo on the toast, like every other delete in this app — and this is the one that most
       needs it. An entry can be typed again from memory; a document is prose that existed nowhere
       else, and deleting a container takes everything under it in one press. */
    notifyDeleted(t('plugins.notebook.deleted', { count }), deletion);
    go(parentId);
  }, [current, go, t]);

  const label = current ? documentLabel(current, t('plugins.notebook.untitled')) : '';

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
                <TitleField
                  key={current.id}
                  title={current.title}
                  label={label}
                  startEditing={newDocId === current.id}
                  onCommit={(next) => void onRename(next)}
                />
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
                    onHistory={() => setHistoryOpen(true)}
                    onMove={() => setMoveOpen(true)}
                    onDelete={() => setDeleteOpen(true)}
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
                const preview = documentPreview(child, childLabel);
                return (
                  <li key={child.id}>
                    <button
                      type="button"
                      onClick={() => go(child.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{childLabel}</span>
                        {preview && (
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {preview}
                          </span>
                        )}
                      </span>
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {current && historyOpen && (
        <HistoryDialog
          documentId={current.id}
          title={label}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
        />
      )}
      {current && moveOpen && (
        <MoveDialog
          document={current}
          open={moveOpen}
          onOpenChange={setMoveOpen}
          onMoved={() => void reload()}
        />
      )}
      {current && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t('plugins.notebook.deleteTitle')}
          description={t('plugins.notebook.deleteDescription', { name: label })}
          onConfirm={() => void onDelete()}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
