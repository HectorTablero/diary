import type { PluginDocumentDto } from '@diary/shared';
import { diffSentences, sentences, words } from '@/lib/textDiff';
import { applyPatch, decodePatch, diffText, encodePatch, type PatchOp } from './patch';

/**
 * A document's history, reconstructed from its patch chain.
 *
 * ## The model in one paragraph
 *
 * Revisions are ordered by day. Each holds a *forward* patch from the previous day's text to its
 * own, with the first patch running from the empty string. Replaying them all therefore yields the
 * text as of the last day it was edited — which is what the document's own `body` holds. The
 * document is the fast path (open it and it is simply there); the chain is only walked when someone
 * asks to look back.
 *
 * ## Why the document's text is authoritative and the chain is not
 *
 * The two can disagree, for two reasons that are nobody's mistake: a person rename rewrites document
 * bodies without touching patches (see renamePersonMentionsInDocuments — it must reach a disabled
 * plugin's prose, and a patch is not prose), and a three-way merge rewrites a body when two devices'
 * edits meet (see reconcilePluginDocuments in db/pluginDocuments.ts). Neither is worth an error
 * message.
 *
 * So the rule is: **`document.body` is the present, the chain is the past, and the next save
 * reconciles them.** A save always diffs against the reconstructed past, so whatever the disagreement
 * was is recorded as that day's change and the chain is exact again from then on.
 */

/** One entry in the timeline: a day, and the full text as of the end of it. */
export interface HistoryDay {
  dateKey: string;
  text: string;
  /** Characters written and characters taken out that day, as stored on the row. */
  added: number;
  removed: number;
}

/**
 * Whether a day's revision recorded any work at all.
 *
 * A row can exist and say nothing happened. A save only writes a revision when the text actually
 * moved (see `revisionFor`'s `changed`) — but a day that *had* moved and was then put back exactly
 * as it was found has to rewrite its existing row to describe no change, because deleting it is not
 * something the chain can express. So `+0 −0` days are real rows, and they are the one thing in this
 * plugin nobody wants listed: a document appearing under "written in today" that is character for
 * character what it was this morning is a link offering to show you nothing.
 *
 * A predicate rather than the comparison written out at each of the two call sites, because those
 * two — the day card and the history — have to agree about it, and this is where they do.
 */
export const wasWrittenIn = (revision: { added: number; removed: number }): boolean =>
  revision.added > 0 || revision.removed > 0;

/**
 * Replay a chain into one text per day, oldest first.
 *
 * Linear in the number of revisions and in the size of the document, which is the trade the patch
 * format was chosen for: opening the history of a thought edited on three hundred days applies three
 * hundred small patches, and every one of them was a few hundred bytes to store.
 *
 * Every revision is applied; only the ones that changed nothing are left out of the *answer*. The
 * two are not the same thing — a patch is applied for its effect on the text, and a `+0 −0` patch
 * has none, so skipping it outright would give the same result. Applying it anyway is what keeps
 * this loop a plain replay of the chain rather than a replay with an exception in it.
 */
export function replay(revisions: readonly PluginDocumentDto[]): HistoryDay[] {
  const days: HistoryDay[] = [];
  let text = '';
  for (const revision of revisions) {
    text = applyPatch(text, decodePatch(revision.body));
    if (!wasWrittenIn(revision)) continue;
    days.push({
      dateKey: revision.dateKey,
      text,
      added: revision.added,
      removed: revision.removed,
    });
  }
  return days;
}

/**
 * The text this document had before today's edits began.
 *
 * The base every save diffs against. It is the replay of every revision *except* today's, so
 * rewriting today's patch as the day goes on never compounds: the day's whole change is always one
 * patch from where the day started, however many times it is saved.
 */
export function baseTextBefore(revisions: readonly PluginDocumentDto[], dateKey: string): string {
  let text = '';
  for (const revision of revisions) {
    if (revision.dateKey >= dateKey) break;
    text = applyPatch(text, decodePatch(revision.body));
  }
  return text;
}

/**
 * The patch and the two character counts one save should store for today.
 *
 * `added` and `removed` are counted from the diff itself, not from the two lengths — a day that
 * replaced four hundred characters with four hundred others did real work, and a net figure would
 * report it as nothing at all. They are the numbers the day card shows as `+n −m` and the calendar
 * shades a month by.
 *
 * Counted at the diff's own granularity, which is sentences: a reworded sentence contributes its
 * whole old length to `removed` and its whole new length to `added`. That reads higher than a
 * character-level count would, and it is the same unit the history view draws, so what the day card
 * reports and what the diff shows can never disagree. It also reads *lower* than it used to, and
 * that is the improvement: at line granularity, fixing a typo in a six-sentence paragraph was
 * reported as the whole paragraph rewritten.
 *
 * The one exception is a change that only *inserted* or only *cut* text. Segments own their trailing
 * whitespace and a sentence is only closed by its terminator, so adding a line after the last one
 * (`Line` → `Line\nNew`) or carrying on an unfinished sentence (`I went to the` → `I went to the
 * store.`) rewrites a segment that lost nothing. Counted per segment, that reported the untouched
 * sentence as removed and written again — a `−n` on a day nothing was taken out. So each run of
 * changed segments is checked first: if everything on one side survives, intact, around what the
 * other side put in or cut, only the difference is counted. See `settleHunk`.
 */
export function revisionFor(
  base: string,
  next: string,
): { patch: string; added: number; removed: number; changed: boolean } {
  const ops: PatchOp[] = diffText(base, next);
  const source = sentences(base);

  let added = 0;
  let removed = 0;
  let cursor = 0;
  let cut = '';
  let put = '';
  const settle = () => {
    const counts = settleHunk(cut, put);
    added += counts.added;
    removed += counts.removed;
    cut = '';
    put = '';
  };
  for (const op of ops) {
    if (op[0] === '=') {
      settle();
      cursor += op[1];
    } else if (op[0] === '-') {
      if (put) settle(); // `+` then `-` is two edits, as in `changesBetween`
      cut += source.slice(cursor, cursor + op[1]).join('');
      cursor += op[1];
    } else {
      put += op[1].join('');
    }
  }
  settle();

  return {
    patch: encodePatch(ops),
    added,
    removed,
    /* Nothing but `=` ops means the text came back to exactly where it started — an edit typed and
       undone. Storing that would put a day in the timeline whose diff is empty. */
    changed: ops.some((op) => op[0] !== '='),
  };
}

/**
 * Whether one run of changed segments only inserted or only cut text — and if so, how much of it
 * stood still either side.
 *
 * `cut` is what the run took from between two unchanged segments and `put` is what it left there.
 * It was a pure insertion when the whole of `cut` is still there, as a head of `put` and a tail of
 * it with the new text between them; a pure deletion the other way round. `null` means a rewrite,
 * which everything here treats at sentence granularity — a typo fixed mid-sentence still reads as
 * that sentence rewritten.
 *
 * Compared word by word, not letter by letter: `one` → `ones` is a word rewritten, not an `s`
 * inserted, and a history or an export quoting a lone `s` says nothing. `head` and `tail` are still
 * returned in characters, because that is what every caller slices by.
 *
 * All-or-nothing on purpose. Trimming whatever words two unrelated sentences happen to share
 * (`The cat sat.` → `The dog ran.` share `The ` and `.`) would shave coincidental text off a
 * genuine rewrite; the question asked here is only "did anything actually go?".
 *
 * One function for the counts, the history view and the export, so the three can never disagree
 * about which edits were rewrites.
 */
function survivingEdges(cut: string, put: string): { head: number; tail: number } | null {
  if (!cut || !put) return null;
  const a = words(cut);
  const b = words(put);
  const shorter = Math.min(a.length, b.length);
  let head = 0;
  let headChars = 0;
  while (head < shorter && a[head] === b[head]) headChars += a[head++].length;
  let tail = 0;
  let tailChars = 0;
  while (tail < shorter - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
    tailChars += a[a.length - 1 - tail++].length;
  }
  return head + tail === shorter ? { head: headChars, tail: tailChars } : null;
}

/** The counts for one run of changed segments — see `survivingEdges` for what is left out. */
function settleHunk(cut: string, put: string): { added: number; removed: number } {
  const kept = survivingEdges(cut, put) ? Math.min(cut.length, put.length) : 0;
  return { added: put.length - kept, removed: cut.length - kept };
}

/**
 * How much a day's work grew the document — what was written less what was cut, never below zero.
 *
 * The calendar's number, and deliberately *not* the day card's. The card reports both sides because
 * that is what happened to the document; the grid asks the narrower question of what is there now
 * that was not there before, so a day of rewriting shades like a quiet one.
 *
 * A named function rather than three characters of arithmetic inside the hook, because which of the
 * two readings the calendar uses is a product decision that has already been changed once — this is
 * where it is stated, and the tests below are what stop it drifting back by accident.
 */
export const netGained = (revision: { added: number; removed: number }): number =>
  Math.max(0, revision.added - revision.removed);

/** One run of text inside a paragraph, and what became of it. */
export interface DiffPiece {
  kind: 'context' | 'added' | 'removed';
  text: string;
}

/**
 * One paragraph of a rendered diff, or a marker standing in for the untouched ones between two
 * changes.
 */
export type DiffBlock =
  { kind: 'paragraph'; changed: boolean; pieces: DiffPiece[] } | { kind: 'gap' };

/** Push a run of text as pieces, cut after each newline — `paragraphs` closes a block only at a
    piece that *ends* with one. */
function pushPieces(out: DiffPiece[], kind: DiffPiece['kind'], text: string): void {
  for (const part of text.split(/(?<=\n)/u)) if (part) out.push({ kind, text: part });
}

/**
 * Fold away what a run of changed segments did not actually change.
 *
 * Two cases, both the diff telling the truth about its own units and lying about the document.
 *
 * A segment owns its own trailing newline — that is what makes segments tile a document exactly
 * (see textDiff.ts) — so *appending* to a document rewrites the segment appended to, purely to give
 * it the newline that now separates it from what follows. Left alone, the commonest edit anyone
 * makes would draw the last paragraph struck through and then immediately retyped, identically,
 * above the new one. Matched from the front of each run, because that is the shape the case has:
 * one segment reappears unchanged and the genuinely new segments follow it.
 *
 * And a sentence only ends at its terminator, so carrying on an unfinished one (`I went to the` →
 * `I went to the store.`) or slipping a word into one replaces the whole segment. What is left of the
 * run after the first rule is checked with `survivingEdges`, and a pure insertion or deletion is
 * drawn as just the words that came or went, standing where they stand.
 */
function settleHunks(pieces: readonly DiffPiece[]): DiffPiece[] {
  const out: DiffPiece[] = [];
  let i = 0;
  while (i < pieces.length) {
    if (pieces[i].kind === 'context') {
      out.push(pieces[i++]);
      continue;
    }
    const removed: DiffPiece[] = [];
    const added: DiffPiece[] = [];
    // Removed then added, and no further: `+` then `-` is two edits (see `changesBetween`).
    while (pieces[i]?.kind === 'removed') removed.push(pieces[i++]);
    while (pieces[i]?.kind === 'added') added.push(pieces[i++]);

    let paired = 0;
    while (
      paired < removed.length &&
      paired < added.length &&
      removed[paired].text.trimEnd() === added[paired].text.trimEnd()
    ) {
      // The added form, not the removed one: it carries the whitespace the document has now.
      out.push({ kind: 'context', text: added[paired].text });
      paired++;
    }

    const cut = removed.slice(paired);
    const put = added.slice(paired);
    const cutText = cut.map((piece) => piece.text).join('');
    const putText = put.map((piece) => piece.text).join('');
    const edges = survivingEdges(cutText, putText);
    if (!edges) {
      out.push(...cut, ...put);
      continue;
    }
    const inserted = putText.length >= cutText.length;
    const longer = inserted ? putText : cutText;
    pushPieces(out, 'context', longer.slice(0, edges.head));
    pushPieces(
      out,
      inserted ? 'added' : 'removed',
      longer.slice(edges.head, longer.length - edges.tail),
    );
    pushPieces(out, 'context', longer.slice(longer.length - edges.tail));
  }
  return out;
}

/**
 * Gather the pieces into the paragraphs they belong to.
 *
 * The unit that matters to a reader is the paragraph, and in this app a paragraph is a line — so a
 * block ends at the segment that carries the newline, and that newline is dropped, because the
 * paragraph break is the block boundary rather than a character to draw. Several sentences of one
 * paragraph therefore stay together with their changes marked *inside* them, which is the whole
 * point: a sentence rewritten mid-paragraph should read as a sentence rewritten mid-paragraph, not
 * as a row torn out of a list of rows.
 */
function paragraphs(pieces: readonly DiffPiece[]): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let current: DiffPiece[] = [];
  const close = () => {
    blocks.push({
      kind: 'paragraph',
      changed: current.some((piece) => piece.kind !== 'context'),
      pieces: current,
    });
    current = [];
  };
  for (const piece of pieces) {
    const ends = piece.text.endsWith('\n');
    current.push({ kind: piece.kind, text: ends ? piece.text.slice(0, -1) : piece.text });
    if (ends) close();
  }
  if (current.length) close();
  return blocks;
}

/**
 * Replace long untouched stretches with a marker, keeping a few paragraphs either side.
 *
 * What someone re-reading a thought six months on wants is what *moved*; a screen of unchanged
 * paragraphs between two edits buries it. A marker rather than a count of what is hidden, because
 * the number is never the question.
 */
function collapse(blocks: readonly DiffBlock[], context: number): DiffBlock[] {
  const out: DiffBlock[] = [];
  const untouched = (block: DiffBlock | undefined): boolean =>
    block?.kind === 'paragraph' && !block.changed;

  for (let i = 0; i < blocks.length;) {
    const start = i;
    while (untouched(blocks[i])) i++;
    const run = blocks.slice(start, i);
    if (run.length > context * 2 + 1) {
      out.push(...run.slice(0, context), { kind: 'gap' }, ...run.slice(-context));
    } else {
      out.push(...run);
    }
    if (i < blocks.length && i === start) out.push(blocks[i++]);
  }
  return out;
}

/**
 * Two texts, as paragraphs to draw.
 *
 * Reuses the same diff the storage format is built on, so what the history screen shows and what the
 * row actually stores can never drift apart — they are one computation.
 *
 * The shape of the *output* is the part that had to change when the unit became a sentence. A row
 * per unit is what a code host draws, and it was right while a unit was a line: one line, one row.
 * A sentence is not a line, so the same rendering broke a paragraph into a stack of unrelated-looking
 * rows and gave a reader no way to tell which of them had been sitting next to each other all along.
 * Paragraphs are therefore the outer structure and the changes live inside them.
 */
export function diffView(before: string, after: string, context = 2): DiffBlock[] {
  const source = sentences(before);
  const pieces: DiffPiece[] = [];
  let i = 0;
  for (const op of diffSentences(before, after)) {
    if (op[0] === '=') {
      for (const text of source.slice(i, i + op[1])) pieces.push({ kind: 'context', text });
      i += op[1];
    } else if (op[0] === '-') {
      for (const text of source.slice(i, i + op[1])) pieces.push({ kind: 'removed', text });
      i += op[1];
    } else {
      for (const text of op[1]) pieces.push({ kind: 'added', text });
    }
  }
  return collapse(paragraphs(settleHunks(pieces)), context);
}

/** Whether a rendered diff has anything to show — a day can legitimately have changed nothing. */
export const hasChanges = (blocks: readonly DiffBlock[]): boolean =>
  blocks.some((block) => block.kind === 'paragraph' && block.changed);

/** One change a day made to a document, at the same sentence granularity everything else here uses. */
export type TextChange =
  /* `within` is the sentence the words went into, or came out of, when the rest of it stood still —
     a fragment like "store." says nothing on its own. */
  | { kind: 'added'; text: string; within?: string }
  | { kind: 'removed'; text: string; within?: string }
  | { kind: 'replaced'; before: string; after: string };

/** A run of segments as one quotable line: the newlines segments carry are what separate them *in
    the document*, and inside a Markdown bullet they would end the bullet instead. */
const oneLine = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/**
 * A day's work as a flat list of labelled changes — what the Markdown export narrates.
 *
 * Deliberately *not* `diffView`. That one builds paragraphs, keeps untouched context either side of
 * a change and collapses the rest behind a marker, because it is drawn on screen next to the
 * document it describes. An export has no document beside it and nobody scrolling it: it wants the
 * changes only, each one whole, in the order they happened.
 *
 * A removed run immediately followed by an added run becomes one `replaced` rather than a `removed`
 * and an `added`, which is the whole reason this reads as prose rather than as a patch — a reworded
 * sentence should say it was reworded. Runs pair whole: four sentences becoming one is one
 * replacement of four by one, not four replacements with three of them empty.
 *
 * Both of `settleHunks`' rules apply, for its reasons (see above). The front-matching loop: a
 * segment owns its trailing newline, so appending to a document rewrites the segment appended to
 * purely to give it the separator it now needs, and would otherwise export as a sentence replaced by
 * a character-for-character copy of itself. And `survivingEdges`: a sentence carried on or with a
 * word slipped in is an addition of those words, quoted with the sentence they landed in, not a
 * replacement of the sentence by a longer copy of itself.
 */
export function changesBetween(before: string, after: string): TextChange[] {
  const source = sentences(before);
  const changes: TextChange[] = [];

  let cursor = 0;
  let cut: string[] = [];
  let put: string[] = [];

  const flush = () => {
    let paired = 0;
    while (
      paired < cut.length &&
      paired < put.length &&
      cut[paired].trimEnd() === put[paired].trimEnd()
    ) {
      paired++;
    }
    const rawCut = cut.slice(paired).join('');
    const rawPut = put.slice(paired).join('');
    cut = [];
    put = [];

    const edges = survivingEdges(rawCut, rawPut);
    if (edges) {
      const inserted = rawPut.length >= rawCut.length;
      const longer = inserted ? rawPut : rawCut;
      const text = oneLine(longer.slice(edges.head, longer.length - edges.tail));
      if (!text) return; // only whitespace moved
      const kept = oneLine(inserted ? rawCut : rawPut);
      const within = kept ? { within: oneLine(longer) } : {};
      changes.push({ kind: inserted ? 'added' : 'removed', text, ...within });
      return;
    }

    const cutText = oneLine(rawCut);
    const putText = oneLine(rawPut);
    if (cutText && putText) changes.push({ kind: 'replaced', before: cutText, after: putText });
    else if (cutText) changes.push({ kind: 'removed', text: cutText });
    else if (putText) changes.push({ kind: 'added', text: putText });
  };

  for (const op of diffSentences(before, after)) {
    if (op[0] === '=') {
      flush();
      cursor += op[1];
    } else if (op[0] === '-') {
      /* A `-` arriving after a `+` opens a new pair rather than joining the one being built: ops are
         coalesced, so `+` then `-` is two separate edits, not one replacement read backwards. */
      if (put.length) flush();
      cut.push(...source.slice(cursor, cursor + op[1]));
      cursor += op[1];
    } else {
      put.push(...op[1]);
    }
  }
  flush();

  return changes;
}
