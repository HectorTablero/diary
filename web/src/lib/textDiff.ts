/**
 * How this app compares two pieces of prose: segment it into sentences, then diff the segments.
 *
 * ## Why sentences rather than lines
 *
 * A line diff is what a code host shows, and it is the wrong unit for writing. A paragraph in this
 * app is one line, so "the paragraph changed" is the finest thing a line diff can say — a typo
 * fixed in the middle of a six-sentence paragraph reads as the whole paragraph being torn out and a
 * near-identical one put back. That is misleading in the history view, wasteful in storage (every
 * save of a long paragraph re-stores all of it), and, worst of the three, it is *coarse where the
 * merge needs to be fine*: two devices editing different sentences of one paragraph are a conflict
 * at line granularity and are not a conflict at all at sentence granularity.
 *
 * ## Why Intl.Segmenter rather than a regex
 *
 * Because the app ships in English, Spanish, Italian, Japanese and Chinese, and "a sentence ends
 * with a full stop" is an English sentence about English. Japanese ends one with `。`, asks a
 * question with `？`, and puts the terminator *inside* the closing quote (`「はい」と言った。`);
 * Chinese uses the same fullwidth forms; Spanish opens a question with `¿`. `Intl.Segmenter` is the
 * Unicode segmentation algorithm (UAX #29) that already knows all of that, and it is in the
 * platform — no dependency, no chunk, and nothing for a sixth locale to break. A regex survives
 * below only as the fallback for a runtime without it.
 *
 * ## The one invariant everything here rests on
 *
 * **`sentences(text).join('') === text`.** Segments carry their own trailing spaces and newlines,
 * so a document is *tiled* by its segments rather than sampled from them. That is what lets a patch
 * be stored as segments and applied by concatenation, with no separator to re-invent and no blank
 * line quietly lost at a paragraph boundary — a failure mode the old line format needed its own
 * test for.
 */

/* 'und' — the root locale — rather than the device's own.
 *
 * Sentence breaking in ICU is untailored for every language this app ships in, so the answer is the
 * same either way today. Naming it explicitly is about tomorrow: segmentation decides where a
 * patch's units fall and where a merge finds its anchors, and two devices that disagreed about that
 * because one of them is set to a locale with a tailoring would produce two different merges of the
 * same three texts. A fixed locale keeps (text) → (segments) the same function everywhere. */
const SEGMENT_LOCALE = 'und';

type Granularity = 'sentence' | 'grapheme';

/* Constructing a Segmenter loads ICU data and costs far more than using one, and the merge path
   reaches for one per conflicted region. Two instances, for the life of the tab. */
const segmenters = new Map<Granularity, Intl.Segmenter | null>();

function segmenterFor(granularity: Granularity): Intl.Segmenter | null {
  const cached = segmenters.get(granularity);
  if (cached !== undefined) return cached;
  /* Feature-detected rather than assumed. Every browser this app supports has had it for years and
     the Android WebView is Chrome, but a stale WebView on an old device is exactly the environment
     nobody tests on, and "the notebook throws on open" is not an acceptable answer there. */
  const made =
    typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(SEGMENT_LOCALE, { granularity })
      : null;
  segmenters.set(granularity, made);
  return made;
}

/* Sentence terminators, for the fallback path only — the list Intl.Segmenter exists to make
   unnecessary. Latin, then the CJK fullwidth forms, then the ones a hand-written list always
   forgets: Arabic, Urdu, Devanagari, Armenian, Ethiopic. */
const FALLBACK_TERMINATOR = /[.!?…‥。．！？｡؟۔।॥։።‼⁇⁈⁉]/u;
/* Punctuation belonging to the sentence that just ended rather than to the next one: a closing
   quote or bracket after the full stop, and the space before the next capital. */
const FALLBACK_TRAILING = /["'”’»)\]）】」』\s]/u;

function fallbackSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\n') {
      out.push(text.slice(start, i + 1));
      i += 1;
      start = i;
      continue;
    }
    if (FALLBACK_TERMINATOR.test(text[i])) {
      i += 1;
      while (i < text.length && FALLBACK_TERMINATOR.test(text[i])) i += 1;
      // Stops before a newline: that is the *next* segment's boundary, handled above.
      while (i < text.length && text[i] !== '\n' && FALLBACK_TRAILING.test(text[i])) i += 1;
      out.push(text.slice(start, i));
      start = i;
      continue;
    }
    i += 1;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/**
 * A text as its sentences, tiling it exactly — see the invariant above.
 *
 * The empty string is no segments rather than one empty one, so "how much is there" and "is there
 * anything at all" stay the same question for the diff below.
 */
export function sentences(text: string): string[] {
  if (text === '') return [];
  const segmenter = segmenterFor('sentence');
  if (!segmenter) return fallbackSentences(text);
  const out: string[] = [];
  for (const { segment } of segmenter.segment(text)) out.push(segment);
  return out;
}

/**
 * A text as its user-perceived characters — the finer unit a merge drops to inside a region the
 * sentence pass could not resolve (see `mergeUnits` in textMerge.ts).
 *
 * Graphemes, not code points: splitting `👍🏽` between its base and its modifier, or a Hangul
 * syllable between its jamo, would let a merge emit a sequence that renders as something neither
 * side wrote. `Array.from` is the fallback and is wrong in exactly those cases — tolerable only
 * because a refined result that conflicted is thrown away, so what survives is a concatenation of
 * whole runs taken from one side or the other.
 */
export function graphemes(text: string): string[] {
  if (text === '') return [];
  const segmenter = segmenterFor('grapheme');
  if (!segmenter) return Array.from(text);
  const out: string[] = [];
  for (const { segment } of segmenter.segment(text)) out.push(segment);
  return out;
}

/** Keep N units, insert these units, or drop N units. Applied in order against the source. */
export type DiffOp = ['=', number] | ['+', string[]] | ['-', number];

/**
 * Cap on the region the quadratic step is allowed to see, per side.
 *
 * Reached only when a *scattered* edit leaves a large differing middle — a find-and-replace over a
 * long document, or a paste that rewrites it wholesale. Typing, which is what actually happens,
 * trims down to a handful of units however long the document is. Past the cap the middle is emitted
 * as one replacement, which costs storage for that one save and stays correct.
 *
 * Higher than the 400 the line format used, because the unit got smaller: the same prose is two to
 * four times as many sentences as it was lines, and keeping the old number would have moved the
 * fallback from "never in practice" to "whenever a long note is reorganised".
 */
const MAX_LCS_UNITS = 1200;

/**
 * The longest common subsequence of two unit arrays, as ops over them.
 *
 * Textbook dynamic programming, over the *trimmed middles only* — see the cap above. Int32Array
 * rather than nested arrays because at the cap this is 1.4M cells and a JS array of arrays would
 * allocate 1200 objects to hold them.
 */
function diffMiddle(before: readonly string[], after: readonly string[]): DiffOp[] {
  const n = before.length;
  const m = after.length;
  const width = m + 1;
  const lcs = new Int32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        before[i] === after[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  /* Walked forward, coalescing runs as it goes: one `['-', 12]` rather than twelve of them, and one
     insert holding twelve units rather than twelve inserts. A patch is stored as JSON, where every
     op costs brackets and quotes, so coalescing is most of the size win. */
  const ops: DiffOp[] = [];
  const push = (op: DiffOp) => {
    const last = ops[ops.length - 1];
    if (last && last[0] === op[0]) {
      if (op[0] === '+') (last[1] as string[]).push(...(op[1] as string[]));
      else (last[1] as number) += op[1] as number;
      return;
    }
    ops.push(op);
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      push(['=', 1]);
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      push(['-', 1]);
      i++;
    } else {
      push(['+', [after[j]]]);
      j++;
    }
  }
  if (i < n) push(['-', n - i]);
  if (j < m) push(['+', after.slice(j)]);
  return ops;
}

/** The ops turning one unit array into another. */
export function diffUnits(a: readonly string[], b: readonly string[]): DiffOp[] {
  /* Trim the identical head and tail first. This is the step that makes the whole file viable:
     editing one sentence of a five-hundred-sentence document leaves a middle of one unit on each
     side, so the quadratic pass below sees two units rather than a quarter of a million cells. */
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);

  const ops: DiffOp[] = [];
  if (prefix) ops.push(['=', prefix]);
  if (midA.length || midB.length) {
    if (midA.length > MAX_LCS_UNITS || midB.length > MAX_LCS_UNITS) {
      // Too scattered to diff cheaply: replace the middle outright. Correct, just not compact.
      if (midA.length) ops.push(['-', midA.length]);
      if (midB.length) ops.push(['+', midB]);
    } else {
      ops.push(...diffMiddle(midA, midB));
    }
  }
  if (suffix) ops.push(['=', suffix]);
  return ops;
}

/** The ops turning `before` into `after`, at sentence granularity. */
export const diffSentences = (before: string, after: string): DiffOp[] =>
  diffUnits(sentences(before), sentences(after));

/**
 * Rebuild the unit array a set of ops produces from the units it was made against.
 *
 * Tolerant of ops running past the end of their source rather than throwing. A stored chain can
 * stop lining up for reasons that are nobody's bug — a rename rewrote the document's text (see
 * renamePersonMentionsInDocuments), or a day's revision was rewritten by a merge — and the honest
 * response to "this history no longer lines up" is a shorter reconstruction, not a crash on a
 * screen someone opened to read an old thought.
 */
export function applyUnitOps(source: readonly string[], ops: readonly DiffOp[]): string[] {
  const out: string[] = [];
  let i = 0;
  for (const op of ops) {
    if (op[0] === '=') {
      out.push(...source.slice(i, i + op[1]));
      i += op[1];
    } else if (op[0] === '-') {
      i += op[1];
    } else {
      out.push(...op[1]);
    }
  }
  return out;
}
