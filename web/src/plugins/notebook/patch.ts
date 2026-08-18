/**
 * The notebook's diff and patch format: line-based, dependency-free, stored as JSON.
 *
 * ## Why patches at all
 *
 * A document keeps its current text in full and its history as one patch per day it changed. The
 * alternative — a snapshot per day — is simpler and was rejected on storage: a 6 kB thought edited
 * on two hundred days is 1.2 MB of near-identical copies, all of which sync. Patches make that same
 * history a few kilobytes, and they are also *what the history view wants to draw*, so the compact
 * form and the readable form are the same object.
 *
 * ## Why lines
 *
 * Character diffs are smaller still and need either a real algorithm (Myers, with its own
 * dependency) or a fallback that degrades badly. Prose is written in paragraphs, a paragraph is a
 * line, and a line diff of prose is both small and legible — "these two paragraphs changed" is
 * exactly what someone re-reading their own thinking wants to see, where a character diff would
 * scatter the same information across a hundred fragments.
 *
 * ## Why no dependency
 *
 * A diff library would live in the plugin's chunk, which is allowed — but it must never be named in
 * `VENDOR_CHUNKS` (registry rule 5), and the two hundred lines below are the whole of what is
 * needed. The trimming step is what makes it practical: the expensive part of a diff only ever runs
 * on the region that actually differs.
 */

/** Keep N lines, insert these lines, or drop N lines. Applied in order against the source. */
export type PatchOp = ['=', number] | ['+', string[]] | ['-', number];

/**
 * Cap on the region the quadratic step is allowed to see, per side.
 *
 * Reached only when a *scattered* edit leaves a large differing middle — a find-and-replace over a
 * long document, or a paste that rewrites it wholesale. Typing, which is what actually happens,
 * trims down to a handful of lines however long the document is. Past the cap the middle is emitted
 * as one replacement, which costs storage for that one day and stays correct.
 */
const MAX_LCS_LINES = 400;

const splitLines = (text: string): string[] => (text === '' ? [] : text.split('\n'));

/**
 * The longest common subsequence of two line arrays, as a patch over them.
 *
 * Textbook dynamic programming, over the *trimmed middles only* — see the cap above. Int32Array
 * rather than nested arrays because at the cap this is 160,000 cells and a JS array of arrays would
 * allocate 400 objects to hold them.
 */
function diffMiddle(before: string[], after: string[]): PatchOp[] {
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
     insert holding twelve lines rather than twelve inserts. The patch is stored as JSON, where each
     op costs brackets and quotes, so coalescing is most of the size win. */
  const ops: PatchOp[] = [];
  const push = (op: PatchOp) => {
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

/** The ops turning `before` into `after`. */
export function diffLines(before: string, after: string): PatchOp[] {
  const a = splitLines(before);
  const b = splitLines(after);

  /* Trim the identical head and tail first. This is the step that makes the whole file viable:
     editing one paragraph of a five-hundred-line document leaves a middle of one line on each side,
     so the quadratic pass below sees two lines rather than a quarter of a million cells. */
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

  const ops: PatchOp[] = [];
  if (prefix) ops.push(['=', prefix]);
  if (midA.length || midB.length) {
    if (midA.length > MAX_LCS_LINES || midB.length > MAX_LCS_LINES) {
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

/**
 * Rebuild the text a patch produces from the text it was made against.
 *
 * Tolerant of a patch that runs past the end of its source rather than throwing. A chain can be
 * inconsistent for real reasons that are nobody's bug — a rename rewrote the document's text
 * (see renamePersonMentionsInDocuments), or two devices' same-day writes converged on the server —
 * and the honest response to "this history no longer lines up" is a shorter reconstruction, not a
 * crash on a screen someone opened to read an old thought.
 */
export function applyPatch(before: string, ops: PatchOp[]): string {
  const source = splitLines(before);
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
  return out.join('\n');
}

/** Patches are stored in a row's `body`, so they cross the wire and Dexie as text like any other. */
export const encodePatch = (ops: PatchOp[]): string => JSON.stringify(ops);

/**
 * Read a stored patch back, defensively.
 *
 * Same posture as every other plugin read in this app: the server never looked at this string, so
 * nothing guarantees it is what this build wrote. A row that fails to parse becomes an empty patch —
 * one day of history that shows no change — rather than an exception on the history screen.
 */
export function decodePatch(body: string): PatchOp[] {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((op): op is PatchOp => {
      if (!Array.isArray(op) || op.length !== 2) return false;
      if (op[0] === '=' || op[0] === '-') return typeof op[1] === 'number' && op[1] >= 0;
      return op[0] === '+' && Array.isArray(op[1]) && op[1].every((l) => typeof l === 'string');
    });
  } catch {
    return [];
  }
}
