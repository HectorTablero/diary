import { applyUnitOps, diffSentences, sentences, type DiffOp } from '@/lib/textDiff';

/**
 * The notebook's stored patch format: sentence-based, dependency-free, stored as JSON.
 *
 * ## Why patches at all
 *
 * A document keeps its current text in full and its history as one patch per day it changed. The
 * alternative — a snapshot per day — is simpler and was rejected on storage: a 6 kB thought edited
 * on two hundred days is 1.2 MB of near-identical copies, all of which sync. Patches make that same
 * history a few kilobytes, and they are also *what the history view wants to draw*, so the compact
 * form and the readable form are the same object.
 *
 * ## Why this file is now thin
 *
 * The diff itself moved to `lib/textDiff.ts`, because it stopped being the notebook's business: the
 * three-way merge that keeps two devices' edits from overwriting each other runs in the sync layer,
 * against any plugin's documents, and it needs the same segmentation and the same diff. What is
 * left here is the part that really is this plugin's — how a patch is written down, read back, and
 * applied to a text.
 *
 * ## Why the encoding carries a version
 *
 * Because the unit changed. Every patch written before this format existed is a *line* diff, whose
 * ops are joined back together with newlines; every patch written since is a *sentence* diff, whose
 * ops are joined with nothing at all, because a segment carries its own trailing whitespace (see
 * textDiff.ts). Applying one with the other's rule silently produces a document with every line
 * break missing or every one doubled — a corruption that no error would report and that would only
 * show up months later, in someone's history, where the original is by then unrecoverable. So the
 * version travels with the patch, old rows keep replaying exactly as they always did, and there is
 * no migration: a document's chain may be half one format and half the other, and it replays
 * correctly either way.
 */

/** Keep N units, insert these units, or drop N units. Applied in order against the source. */
export type PatchOp = DiffOp;

/** How a stored patch's units are cut, which is also how they are joined back together. */
export type PatchUnits = 'line' | 'sentence';

export interface Patch {
  units: PatchUnits;
  ops: PatchOp[];
}

/** The version stamp on everything this build writes. Absence of one means the line format. */
const SENTENCE_FORMAT = 2;

/** The ops turning `before` into `after`, in the format this build writes. */
export const diffText = (before: string, after: string): PatchOp[] => diffSentences(before, after);

/** Patches live in a row's `body`, so they cross the wire and Dexie as text like any other. */
export const encodePatch = (ops: PatchOp[]): string => JSON.stringify({ v: SENTENCE_FORMAT, ops });

const isPatchOp = (op: unknown): op is PatchOp => {
  if (!Array.isArray(op) || op.length !== 2) return false;
  if (op[0] === '=' || op[0] === '-') return typeof op[1] === 'number' && op[1] >= 0;
  return op[0] === '+' && Array.isArray(op[1]) && op[1].every((u) => typeof u === 'string');
};

/**
 * Read a stored patch back, defensively.
 *
 * Same posture as every other plugin read in this app: the server never looked at this string, so
 * nothing guarantees it is what this build wrote. A row that fails to parse becomes an empty patch —
 * one day of history that shows no change — rather than an exception on the history screen.
 *
 * A bare array is the pre-versioning line format, and is the one shape that must never be guessed
 * at: it is what every revision written before this change looks like.
 */
export function decodePatch(body: string): Patch {
  try {
    const parsed: unknown = JSON.parse(body);
    if (Array.isArray(parsed)) return { units: 'line', ops: parsed.filter(isPatchOp) };
    if (typeof parsed === 'object' && parsed !== null) {
      const { v, ops } = parsed as { v?: unknown; ops?: unknown };
      if (v === SENTENCE_FORMAT && Array.isArray(ops)) {
        return { units: 'sentence', ops: ops.filter(isPatchOp) };
      }
    }
    return { units: 'sentence', ops: [] };
  } catch {
    return { units: 'sentence', ops: [] };
  }
}

const splitFor = (units: PatchUnits, text: string): string[] => {
  if (units === 'sentence') return sentences(text);
  return text === '' ? [] : text.split('\n');
};

/**
 * Rebuild the text a patch produces from the text it was made against.
 *
 * Tolerant of a patch that runs past the end of its source rather than throwing — see the note on
 * `applyUnitOps`, which is where that tolerance lives. A chain can be inconsistent for real reasons
 * that are nobody's bug, and the honest response to "this history no longer lines up" is a shorter
 * reconstruction, not a crash on a screen someone opened to read an old thought.
 */
export function applyPatch(before: string, patch: Patch): string {
  const source = splitFor(patch.units, before);
  const out = applyUnitOps(source, patch.ops);
  return patch.units === 'sentence' ? out.join('') : out.join('\n');
}
