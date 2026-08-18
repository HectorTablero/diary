import { MAX_PLUGIN_DOCUMENT_BYTES, type PluginDocumentDto } from '@diary/shared';
import { generateKeyBetween } from 'fractional-indexing';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createPluginDocument,
  deletePluginDocuments,
  getAllPluginDocuments,
  getChildDocuments,
  getDocumentRevisions,
  getPluginDocument,
  getRevisionsForDay,
  getRevisionsInRange,
  putDocumentRevision,
  updatePluginDocument,
  type PluginDocumentDeletion,
} from '@/db/pluginDocuments';
import { onSyncApplied } from '@/db/sync';
import { todayKey } from '@/lib/dates';
import { baseTextBefore, netGained, replay, revisionFor, type HistoryDay } from './history';
import { ancestorPath, NOTEBOOK_PLUGIN_ID as PLUGIN_ID, ROOT_ID, subtreeIds } from './model';

/**
 * The notebook's reads and writes, as hooks.
 *
 * Every one of them follows the plugin house pattern: load into state, then re-load whenever a sync
 * applies (`onSyncApplied`), so a thought written on the laptop appears on the phone without a
 * refresh. What is different here is what they are careful *not* to read — see the note on
 * `db/pluginDocuments.ts`. A body can be a quarter of a megabyte, so the tree is walked a level at a
 * time and the only two callers that load every document are the move picker and the export.
 */

/** How long typing settles before a save. */
const SAVE_DEBOUNCE_MS = 800;

/* --- Browsing the tree -------------------------------------------------------------------------- */

export interface NotebookLevel {
  /** The document being looked at, or `undefined` at the root. */
  current: PluginDocumentDto | undefined;
  /** Root first, ending with `current`. Empty at the root. */
  path: PluginDocumentDto[];
  children: PluginDocumentDto[];
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * One level of the notebook: what is here, and the way back up.
 *
 * The ancestors are fetched by walking `parentId` one `get` at a time rather than by loading the
 * tree and filtering it. That is at most MAX_PLUGIN_DOCUMENT_DEPTH reads of a primary key, against
 * a whole-table scan that would pull every body in the notebook to render a breadcrumb.
 */
export function useNotebookLevel(documentId: string): NotebookLevel {
  const [state, setState] = useState<{
    current: PluginDocumentDto | undefined;
    path: PluginDocumentDto[];
    children: PluginDocumentDto[];
  }>({ current: undefined, path: [], children: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const children = await getChildDocuments(PLUGIN_ID, documentId);
    if (documentId === ROOT_ID) {
      setState({ current: undefined, path: [], children });
      setLoading(false);
      return;
    }
    const chain = new Map<string, PluginDocumentDto>();
    let cursor: string = documentId;
    while (cursor !== ROOT_ID && !chain.has(cursor)) {
      const doc = await getPluginDocument(cursor);
      if (!doc) break;
      chain.set(doc.id, doc);
      cursor = doc.parentId;
    }
    setState({
      current: chain.get(documentId),
      path: ancestorPath(documentId, chain),
      children,
    });
    setLoading(false);
  }, [documentId]);

  useEffect(() => {
    setLoading(true);
    void load();
    return onSyncApplied(() => void load());
  }, [load]);

  return { ...state, loading, reload: load };
}

/* --- Creating, moving, deleting ----------------------------------------------------------------- */

/**
 * Add a document as the last child of `parentId`.
 *
 * The sibling order is a fractional index, the same scheme entries sort by — so a document created
 * on the phone and one created on the laptop, both offline, both "last", get different keys and
 * survive the merge in the order they were made rather than one of them winning.
 */
export async function createDocument(parentId: string, title = ''): Promise<PluginDocumentDto> {
  const siblings = await getChildDocuments(PLUGIN_ID, parentId);
  const last = siblings.at(-1)?.sortKey || null;
  return createPluginDocument(PLUGIN_ID, {
    parentId,
    title,
    body: '',
    sortKey: generateKeyBetween(last, null),
  });
}

/** Move a document (and everything under it) to a new parent, as its last child. */
export async function moveDocument(documentId: string, parentId: string): Promise<void> {
  const siblings = await getChildDocuments(PLUGIN_ID, parentId);
  const last = siblings.filter((s) => s.id !== documentId).at(-1)?.sortKey || null;
  await updatePluginDocument(documentId, {
    parentId,
    sortKey: generateKeyBetween(last, null),
  });
}

/**
 * Delete a document, everything beneath it, and every revision of every part.
 *
 * The whole set in one batch — one sync kick for what the user experienced as one action. The
 * revisions have to be named explicitly because the route deliberately doesn't cascade: the tree is
 * the client's knowledge, and a server walking `parentId` would be the server holding an opinion
 * about a shape it otherwise never parses.
 */
export async function deleteDocument(
  documentId: string,
): Promise<{ deletion: PluginDocumentDeletion; count: number }> {
  const documents = await getAllPluginDocuments(PLUGIN_ID);
  const ids = subtreeIds(documentId, documents);
  const revisions = await Promise.all([...ids].map((id) => getDocumentRevisions(id)));
  const all = [...ids, ...revisions.flat().map((r) => r.id)];
  const deletion = await deletePluginDocuments(all);
  /* The count is documents, not rows: "3 documents deleted" is what happened, where the row total
     would also be counting however many days each of them was written on. The *deletion* still
     carries every row, because putting it back means putting the history back too. */
  return { deletion, count: ids.size };
}

/** Every document, for the "move to…" picker — the one screen that has to see the whole tree. */
export function useAllDocuments(): PluginDocumentDto[] {
  const [documents, setDocuments] = useState<PluginDocumentDto[]>([]);
  const load = useCallback(async () => {
    setDocuments(await getAllPluginDocuments(PLUGIN_ID));
  }, []);
  useEffect(() => {
    void load();
    return onSyncApplied(() => void load());
  }, [load]);
  return documents;
}

/* --- Writing ------------------------------------------------------------------------------------ */

export interface DocumentEditor {
  document: PluginDocumentDto | undefined;
  /** The text in the box right now — local, ahead of what is stored while typing settles. */
  body: string;
  loading: boolean;
  /** Set when the body has grown past what a row can hold; the save is refused, not truncated. */
  tooLong: boolean;
  setBody: (next: string) => void;
  setTitle: (next: string) => Promise<void>;
  /** Write now rather than waiting out the debounce — navigating away, closing the tab. */
  flush: () => Promise<void>;
}

/**
 * Editing one document, with the day's revision kept in step.
 *
 * ## What a save actually does
 *
 * Two writes: the document's `body` (the present) and today's revision (the day's change). The
 * revision is always a patch from `baseTextBefore(revisions, today)` — where the *day* started, not
 * where the last save left off — so saving fifty times in an afternoon leaves one revision holding
 * the whole afternoon rather than fifty holding a keystroke each.
 *
 * ## Why it is debounced
 *
 * Every enqueue kicks a sync pass, and writing prose produces keystrokes by the hundred. Same
 * reasoning as the habits day card, with a longer window: a habit is a tap and a thought is a
 * paragraph, so the moment worth banking is the pause between sentences.
 */
export function useDocumentEditor(documentId: string, onDiscarded?: () => void): DocumentEditor {
  const [document, setDocument] = useState<PluginDocumentDto | undefined>(undefined);
  const [body, setBodyState] = useState('');
  const [loading, setLoading] = useState(true);

  /* Refs rather than state for everything the *save* reads. The debounced write fires from a timer,
     long after the render that scheduled it, and a closure over state would bank whatever the text
     was when the user stopped typing two paragraphs ago. */
  const revisionsRef = useRef<PluginDocumentDto[]>([]);
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* The unmount cleanup runs after the last render, so everything it inspects has to be reachable
     from a ref rather than from that render's closure. */
  const latestRef = useRef<{ document: PluginDocumentDto | undefined; body: string }>({
    document: undefined,
    body: '',
  });
  latestRef.current = { document, body };
  const discardedRef = useRef(onDiscarded);
  discardedRef.current = onDiscarded;

  const load = useCallback(async () => {
    const [doc, revisions] = await Promise.all([
      getPluginDocument(documentId),
      getDocumentRevisions(documentId),
    ]);
    revisionsRef.current = revisions;
    setDocument(doc);
    /* Only adopt the stored text when nothing local is waiting to be written. A sync landing
       mid-sentence must not replace the sentence — the pull already skipped this row if a write was
       queued for it (dirtyIds in db/sync.ts), and this is the same rule one layer up, for the window
       between a keystroke and its debounce firing. */
    if (pendingRef.current === null) setBodyState(doc?.body ?? '');
    setLoading(false);
  }, [documentId]);

  useEffect(() => {
    setLoading(true);
    pendingRef.current = null;
    void load();
    return onSyncApplied(() => void load());
  }, [load]);

  const write = useCallback(async () => {
    const next = pendingRef.current;
    if (next === null) return;
    pendingRef.current = null;

    const dateKey = todayKey();
    const base = baseTextBefore(revisionsRef.current, dateKey);
    const { patch, added, removed, changed } = revisionFor(base, next);

    await updatePluginDocument(documentId, { body: next });
    setDocument((current) => (current ? { ...current, body: next } : current));

    /* A day whose net change is nothing gets no revision — an edit typed and undone should not
       leave a day in the timeline whose diff is empty. An *existing* revision for today is still
       rewritten in that case, because it has to go back to describing no change. */
    const existing = revisionsRef.current.find((r) => r.dateKey === dateKey);
    if (changed || existing) {
      const row = await putDocumentRevision(PLUGIN_ID, documentId, dateKey, patch, added, removed);
      revisionsRef.current = [
        ...revisionsRef.current.filter((r) => r.dateKey !== dateKey),
        row,
      ].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    }
  }, [documentId]);

  const tooLong = useMemo(
    () => new TextEncoder().encode(body).length > MAX_PLUGIN_DOCUMENT_BYTES,
    [body],
  );

  const setBody = useCallback(
    (next: string) => {
      setBodyState(next);
      /* Refused rather than truncated. Silently dropping the tail of what someone just wrote is the
         one failure mode worse than saying no — and the editor shows the count and blocks, so this
         is a state the user is looking at rather than one they discover later. */
      if (new TextEncoder().encode(next).length > MAX_PLUGIN_DOCUMENT_BYTES) return;
      pendingRef.current = next;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void write(), SAVE_DEBOUNCE_MS);
    },
    [write],
  );

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await write();
  }, [write]);

  /**
   * Throw away a document that was created and never used.
   *
   * Pressing "New" has to create the row up front — the editor needs something to write into, and
   * an unsaved draft held in memory is a draft a closed tab loses. The cost is that backing out of
   * a document you thought better of leaves an empty one behind, and a notebook slowly fills with
   * blanks nobody meant to make.
   *
   * The four conditions are all necessary, and the third is the one that matters: **it must never
   * have been written in**. A document with any revision at all is one that had prose in it on some
   * day, and emptying such a document is an edit — possibly a mistake, and undoing a mistake is
   * what the history is for. Deleting it here would be deleting the history along with it.
   */
  const discardIfUntouched = useCallback(async () => {
    const { document: current, body: text } = latestRef.current;
    if (!current) return;
    if (current.title.trim() || text.trim()) return;
    if (revisionsRef.current.length) return;
    // A container, even an unwritten one, is doing a job: it is holding the documents inside it.
    if ((await getChildDocuments(PLUGIN_ID, current.id)).length) return;

    await deletePluginDocuments([current.id]);
    discardedRef.current?.();
  }, []);

  /* Unmounting is the commonest way a debounce is cut short — tapping a child document, or the
     breadcrumb, a moment after typing. The pending text is in a ref, so this fires the write with
     what was actually typed rather than with whatever the last render closed over.

     The discard runs *after* the write, never instead of it: a document typed into and left within
     the debounce window has a pending body, and checking emptiness before banking it would read
     that document as blank and delete what was just written. */
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void write().then(() => discardIfUntouched());
    },
    [write, discardIfUntouched],
  );

  const setTitle = useCallback(
    async (next: string) => {
      await updatePluginDocument(documentId, { title: next });
      setDocument((current) => (current ? { ...current, title: next } : current));
    },
    [documentId],
  );

  return { document, body, loading, tooLong, setBody, setTitle, flush };
}

/* --- Looking back -------------------------------------------------------------------------------- */

/** A document's timeline, oldest first. Loaded only when the history screen is opened. */
export function useDocumentHistory(documentId: string): { days: HistoryDay[]; loading: boolean } {
  const [days, setDays] = useState<HistoryDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const revisions = await getDocumentRevisions(documentId);
      if (cancelled) return;
      setDays(replay(revisions));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  return { days, loading };
}

/* --- The day page and the calendar ---------------------------------------------------------------- */

export interface TouchedDocument {
  id: string;
  document: PluginDocumentDto | undefined;
  added: number;
  removed: number;
}

/**
 * The documents written in on one day, for the day card's quick links.
 *
 * One indexed read for the day's revisions, then one primary-key `get` per document touched — which
 * is a handful, since a day of writing is a handful of thoughts. The alternative, joining against
 * every document in the notebook, would make an ordinary day page proportional to the whole
 * notebook's size.
 */
export function useTouchedDocuments(dateKey: string): {
  touched: TouchedDocument[];
  loading: boolean;
} {
  const [touched, setTouched] = useState<TouchedDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const revisions = await getRevisionsForDay(PLUGIN_ID, dateKey);
    const documents = await Promise.all(
      revisions.map((revision) => getPluginDocument(revision.documentId)),
    );
    setTouched(
      revisions
        .map((revision, index) => ({
          id: revision.documentId,
          document: documents[index],
          added: revision.added,
          removed: revision.removed,
        }))
        // A revision whose document is gone is a delete that hasn't finished syncing, not a link.
        .filter((row) => row.document !== undefined),
    );
    setLoading(false);
  }, [dateKey]);

  useEffect(() => {
    setLoading(true);
    void load();
    return onSyncApplied(() => void load());
  }, [load]);

  return { touched, loading };
}

/**
 * Net characters gained per day across the whole notebook, for the calendar heatmap.
 *
 * **Net, not written.** The day card reports both sides of a day's change (`+n −m`) because that is
 * what happened; the calendar asks the narrower question of how much the notebook *grew*, so a day
 * spent rewriting shades the same as a quiet one. Both readings are honest and they belong to
 * different surfaces — a row of the day card is about that document, a cell of a year is about the
 * shape of a habit.
 *
 * Clamped per document before summing, not after: a thought cut in half contributes nothing rather
 * than eating another document's growth on the same day. Nothing here reconstructs anything —
 * painting a month must never mean replaying the patch chains it touches.
 */
export function useNotebookCalendar(start: string, end: string): ReadonlyMap<string, number> {
  const [rows, setRows] = useState<PluginDocumentDto[]>([]);

  const load = useCallback(async () => {
    setRows(await getRevisionsInRange(PLUGIN_ID, start, end));
  }, [start, end]);

  useEffect(() => {
    void load();
    return onSyncApplied(() => void load());
  }, [load]);

  return useMemo(() => {
    const byDate = new Map<string, number>();
    for (const row of rows) {
      const net = netGained(row);
      if (net > 0) byDate.set(row.dateKey, (byDate.get(row.dateKey) ?? 0) + net);
    }
    return byDate;
  }, [rows]);
}
