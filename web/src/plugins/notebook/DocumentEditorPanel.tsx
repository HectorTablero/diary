import { MAX_PLUGIN_DOCUMENT_BYTES } from '@diary/shared';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { usePeople } from '@/api/hooks';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { MarkdownView } from './MarkdownView';
import { MentionTextarea } from './MentionTextarea';
import { useDocumentEditor } from './useNotebook';

/**
 * One document, being written in or read.
 *
 * ## Two modes, not one
 *
 * Markdown source with a preview toggle, rather than a live-rendering editor. The reason is
 * honesty about what is stored: the document *is* the text in the box, so what is exported, what is
 * diffed in the history, and what a future version of this app reads back are all the same string
 * the user typed. A styled-as-you-type surface would have to keep a second representation in step
 * with that one, and the failure mode is silent.
 *
 * The preview is where `@mentions` become links to people — see MarkdownView.tsx. In the editor they
 * are left as plain text on purpose: highlighting them means laying the whole document out twice on
 * every keystroke, which the composer can afford for one line and a thousand-word thought cannot.
 *
 * ## Nothing says "saving"
 *
 * A write lands in Dexie immediately and syncs whenever it can — that is what local-first means, and
 * it is true of every other screen in this app, none of which narrates it either. A spinner here
 * would invite the user to wait for something that has already happened, and to worry about a queue
 * the sync pill already speaks for. The only status this screen shows is the one that means writing
 * is genuinely *not* being kept: a document past the size a row can hold.
 */

/* The editor's resting height, in pixels, mirrored by the min-h-* classes on the textarea itself.
   Both are needed: the class sizes the very first paint, before anything has been measured, and the
   number is the floor the grow-to-fit pass must not shrink below. */
const MIN_HEIGHT = 280;
const MIN_HEIGHT_FOCUS = 480;

export function DocumentEditorPanel({
  documentId,
  focus,
  preview,
  onDiscarded,
}: {
  documentId: string;
  focus: boolean;
  /** Owned by the page, because the control that toggles it lives in the page header. */
  preview: boolean;
  /** Fired when leaving discarded an untouched document, so the level behind can drop it. */
  onDiscarded?: () => void;
}) {
  const { t } = useTranslation();
  const { data: people = [] } = usePeople();
  const { document, body, loading, tooLong, setBody, flush } = useDocumentEditor(
    documentId,
    onDiscarded,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* Grow the box to the text. A prose editor with an inner scrollbar puts the document in a window
     inside a window — the page should scroll, not the field.

     `useLayoutEffect`, and a floor that lives in CSS rather than only here. A plain effect measures
     after the browser has already painted, so a reload showed a default-sized two-row textarea for a
     frame and then jumped to full height. The class below sizes it correctly before any measurement
     happens, and this only ever grows it past that. */
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || preview) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, focus ? MIN_HEIGHT_FOCUS : MIN_HEIGHT)}px`;
  }, [body, preview, focus]);

  /* Anything unwritten goes in before the tab does. `flush` is also called when this unmounts (see
     useDocumentEditor), which covers navigating inside the app; this is the other half — closing
     the tab, or the phone backgrounding the browser. */
  useEffect(() => {
    const bank = () => void flush();
    window.addEventListener('pagehide', bank);
    return () => window.removeEventListener('pagehide', bank);
  }, [flush]);

  if (loading || !document) return <Skeleton className="h-64 w-full" />;

  const bytes = new TextEncoder().encode(body).length;

  return (
    <div className="space-y-3">
      {preview ? (
        <div className="min-h-70 rounded-lg border px-4 py-3">
          {body.trim() ? (
            <MarkdownView text={body} people={people} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('plugins.notebook.previewEmpty')}</p>
          )}
        </div>
      ) : (
        <div
          className={cn(
            'rounded-lg border px-4 py-3 focus-within:ring-2 focus-within:ring-ring/40',
            tooLong && 'border-destructive',
          )}
        >
          <MentionTextarea
            value={body}
            onChange={setBody}
            people={people}
            textareaRef={textareaRef}
            placeholder={t('plugins.notebook.bodyPlaceholder')}
            autoFocus={focus}
            className={focus ? 'min-h-120' : 'min-h-70'}
          />
        </div>
      )}

      {/* The one status worth showing — see the note on this component. Kept mounted and empty
          rather than conditionally rendered, so the live region exists before it has anything to
          announce; a region inserted at the same moment as its text is often not read at all. */}
      <p aria-live="polite" className="h-4 text-xs text-destructive">
        {tooLong ? t('plugins.notebook.tooLong', { over: bytes - MAX_PLUGIN_DOCUMENT_BYTES }) : ''}
      </p>
    </div>
  );
}
