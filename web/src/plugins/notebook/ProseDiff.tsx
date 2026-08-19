import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { DiffBlock, DiffPiece } from './history';

/**
 * A diff of two versions of a thought, drawn as the prose it is.
 *
 * ## Why it does not look like a code diff
 *
 * Because it is not one, and it stopped being able to pretend the moment the diff's unit became a
 * sentence. A row per unit is right when a unit is a line — one line, one row, and the rows below
 * each other are the document. A sentence is not a line, so the same rendering broke every
 * paragraph into a stack of short rows with nothing to say which of them had been sitting next to
 * each other all along: a clause rewritten mid-paragraph read as a row torn out of a list, and the
 * two halves of one sentence being rewritten read as two unrelated edits.
 *
 * So the paragraph is the outer structure and the changes are marked *inside* it, the way a change
 * to prose is marked anywhere else — in a tracked-changes document, in a wiki history, in a
 * proofread manuscript. What you read is the paragraph, with the old words struck through where
 * they stood and the new ones in place.
 *
 * ## `<del>` and `<ins>` rather than two coloured spans
 *
 * They are the elements HTML has for exactly this, so a screen reader announces the change rather
 * than reading a deleted sentence as though it were still there — where two coloured spans would
 * have been read out as ordinary prose, with the old sentence and the new one running together into
 * something nobody wrote. The strike-through and underline are what carry the same distinction for
 * a sighted reader who cannot use the colour.
 *
 * `font-mono` is gone for the same reason the rows are: this is someone's writing, and it should be
 * legible as writing.
 */

/* `underline` and `line-through` are spelled out rather than left to the browser's own styling of
   `<ins>` and `<del>`: preflight is entitled to reset either of them, and these are the cues a
   reader who cannot use the colour is relying on. */
const pieceClass: Record<DiffPiece['kind'], string> = {
  context: '',
  added:
    'rounded bg-emerald-500/10 px-0.5 text-emerald-700 underline decoration-emerald-500/60 underline-offset-2 dark:text-emerald-400',
  removed:
    'rounded bg-destructive/10 px-0.5 text-destructive line-through decoration-destructive/60',
};

function Piece({ piece }: { piece: DiffPiece }) {
  if (piece.kind === 'added') return <ins className={pieceClass.added}>{piece.text}</ins>;
  if (piece.kind === 'removed') return <del className={pieceClass.removed}>{piece.text}</del>;
  return <span>{piece.text}</span>;
}

export function ProseDiff({ blocks, className }: { blocks: DiffBlock[]; className?: string }) {
  const { t } = useTranslation();

  return (
    <div className={cn('text-sm leading-6', className)}>
      {blocks.map((block, index) =>
        block.kind === 'gap' ? (
          /* Not aria-hidden: a reader who cannot see the ellipsis would otherwise hear two distant
             paragraphs run together as though they were consecutive. */
          <p key={index} className="py-1 text-center text-muted-foreground select-none">
            <span aria-hidden>…</span>
            <span className="sr-only">{t('plugins.notebook.diffUnchangedHidden')}</span>
          </p>
        ) : (
          /* One line's worth of minimum height, so a blank line between two paragraphs draws as the
             blank line it is rather than collapsing — the shape of the document is part of what a
             history view has to show. */
          <p key={index} className="min-h-[1lh] whitespace-pre-wrap">
            {block.pieces.map((piece, pieceIndex) => (
              <Piece key={pieceIndex} piece={piece} />
            ))}
          </p>
        ),
      )}
    </div>
  );
}
