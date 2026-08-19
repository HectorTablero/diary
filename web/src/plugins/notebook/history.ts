import type { PluginDocumentDto } from '@diary/shared';
import { diffSentences, sentences } from '@/lib/textDiff';
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
 * Replay a chain into one text per day, oldest first.
 *
 * Linear in the number of revisions and in the size of the document, which is the trade the patch
 * format was chosen for: opening the history of a thought edited on three hundred days applies three
 * hundred small patches, and every one of them was a few hundred bytes to store.
 */
export function replay(revisions: readonly PluginDocumentDto[]): HistoryDay[] {
  const days: HistoryDay[] = [];
  let text = '';
  for (const revision of revisions) {
    text = applyPatch(text, decodePatch(revision.body));
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
  for (const op of ops) {
    if (op[0] === '=') {
      cursor += op[1];
    } else if (op[0] === '-') {
      removed += source.slice(cursor, cursor + op[1]).join('').length;
      cursor += op[1];
    } else {
      added += op[1].join('').length;
    }
  }

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

/**
 * Fold away a change that is only in the whitespace at the end of a segment.
 *
 * A segment owns its own trailing newline — that is what makes segments tile a document exactly
 * (see textDiff.ts) — so *appending* to a document rewrites the segment appended to, purely to give
 * it the newline that now separates it from what follows. Left alone, the commonest edit anyone
 * makes would draw the last paragraph struck through and then immediately retyped, identically,
 * above the new one. It is the diff telling the truth about its own units and lying about the
 * document.
 *
 * Matched from the front of each removed/added run, because that is the shape the case has: one
 * segment reappears unchanged and the genuinely new segments follow it.
 */
function settleWhitespace(pieces: readonly DiffPiece[]): DiffPiece[] {
  const out: DiffPiece[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const removed: DiffPiece[] = [];
    while (pieces[i]?.kind === 'removed') removed.push(pieces[i++]);
    const added: DiffPiece[] = [];
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
    out.push(...removed.slice(paired), ...added.slice(paired));
    if (i < pieces.length && pieces[i].kind === 'context') out.push(pieces[i]);
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
  return collapse(paragraphs(settleWhitespace(pieces)), context);
}

/** Whether a rendered diff has anything to show — a day can legitimately have changed nothing. */
export const hasChanges = (blocks: readonly DiffBlock[]): boolean =>
  blocks.some((block) => block.kind === 'paragraph' && block.changed);
