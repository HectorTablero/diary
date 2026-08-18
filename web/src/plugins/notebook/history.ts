import type { PluginDocumentDto } from '@diary/shared';
import { applyPatch, decodePatch, diffLines, encodePatch, type PatchOp } from './patch';

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
 * plugin's prose, and a patch is not prose), and two devices writing the same day converge on the
 * server by one of them losing. Neither is worth an error message.
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
 * Counted at the diff's own granularity, which is lines: a reworded line contributes its whole old
 * length to `removed` and its whole new length to `added`. That reads higher than a character-level
 * count would, and it is the same unit the history view draws, so what the day card reports and what
 * the diff shows can never disagree.
 */
export function revisionFor(
  base: string,
  next: string,
): { patch: string; added: number; removed: number; changed: boolean } {
  const ops: PatchOp[] = diffLines(base, next);
  const source = base === '' ? [] : base.split('\n');

  let added = 0;
  let removed = 0;
  let cursor = 0;
  for (const op of ops) {
    if (op[0] === '=') {
      cursor += op[1];
    } else if (op[0] === '-') {
      removed += source.slice(cursor, cursor + op[1]).join('\n').length;
      cursor += op[1];
    } else {
      added += op[1].join('\n').length;
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

/** One line of a rendered diff. `context` lines are unchanged and shown for orientation. */
export interface DiffLine {
  kind: 'context' | 'added' | 'removed';
  text: string;
}

/**
 * Two texts, as lines to draw.
 *
 * Reuses the same diff the storage format is built on, so what the history screen shows and what the
 * row actually stores can never drift apart — they are one computation.
 *
 * Long unchanged stretches are collapsed to a few lines of context either side, the way a diff tool
 * does: the interesting thing about re-reading a thought six months on is what moved, and a screen
 * of unchanged paragraphs between two edits buries it.
 */
export function diffView(before: string, after: string, context = 2): DiffLine[] {
  const source = before === '' ? [] : before.split('\n');
  const lines: DiffLine[] = [];
  let i = 0;
  for (const op of diffLines(before, after)) {
    if (op[0] === '=') {
      const run = source.slice(i, i + op[1]);
      i += op[1];
      if (run.length <= context * 2 + 1) {
        lines.push(...run.map((text): DiffLine => ({ kind: 'context', text })));
      } else {
        lines.push(...run.slice(0, context).map((text): DiffLine => ({ kind: 'context', text })));
        // A gap marker rather than a count of hidden lines: the number is never the question.
        lines.push({ kind: 'context', text: '…' });
        lines.push(...run.slice(-context).map((text): DiffLine => ({ kind: 'context', text })));
      }
    } else if (op[0] === '-') {
      lines.push(
        ...source.slice(i, i + op[1]).map((text): DiffLine => ({ kind: 'removed', text })),
      );
      i += op[1];
    } else {
      lines.push(...op[1].map((text): DiffLine => ({ kind: 'added', text })));
    }
  }
  return lines;
}
