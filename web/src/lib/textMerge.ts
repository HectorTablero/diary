import { diffUnits, graphemes, sentences, type DiffOp } from './textDiff';

/**
 * Three-way merge over prose — the thing that stops two devices' edits being a coin toss.
 *
 * ## What "three-way" buys over last-write-wins
 *
 * Last-write-wins compares two texts and has no way to tell "I added a paragraph" from "I deleted
 * everything you added", because both look like *different*. A third text — the common ancestor
 * both devices started from — turns each side into a set of *changes*, and changes to different
 * parts of a document simply do not collide. This is diff3, the algorithm behind `git merge`, and
 * the shape of it is three rules applied wherever the two sides disagree with the base: if only one
 * side changed something, take that side; if both made the same change, take it once; only if both
 * changed the same thing *differently* is there anything left to decide.
 *
 * ## Why the unit is a sentence
 *
 * Because the unit is what decides whether something counts as "the same region". At line
 * granularity two people editing one paragraph always collide; at sentence granularity they collide
 * only when they edit the same sentence, which is the honest reading of the situation. See the
 * header of textDiff.ts for the rest of that argument, and for why sentences are found with
 * `Intl.Segmenter` rather than by looking for full stops.
 *
 * ## What happens on a real conflict
 *
 * **Both versions are kept, and nothing is marked up.** Not `<<<<<<<` markers: those are a tool for
 * someone holding a merge in their hands right now, and this merge happens in the background of a
 * diary app, possibly on a phone in a pocket. A marker would be saved into the document, synced,
 * exported, and read months later by someone with no idea what it meant. Two versions of a sentence
 * sitting next to each other are self-explanatory, and deleting the one you don't want is one
 * gesture. The count comes back to the caller so the UI can say that it happened.
 *
 * Before giving up on a spot, the merge retries it a level finer — grapheme by grapheme — and
 * takes that result only if it comes back clean. That is what keeps "you fixed a typo in the
 * sentence, I added a clause to it" from being reported as a conflict, while `we are meeting at
 * six` against `we are meeting at seven` still is: refining the second one leaves `six`/`seven`
 * irreconcilable, the refinement is discarded whole, and both sentences survive intact rather than
 * being spliced into `sisxeven`.
 */
export interface MergeResult {
  text: string;
  /** Places where both sides wrote something different, so both versions were kept. */
  conflicts: number;
}

interface Alignment {
  /** Per base index: does this side still have that unit? */
  kept: boolean[];
  /** Per base index (plus one past the end): units this side put in front of it. */
  inserted: string[][];
}

/**
 * One side's diff against the base, re-expressed as a per-base-index answer.
 *
 * The walk below needs to ask "did *both* sides leave this unit alone", which a list of ops cannot
 * answer without being re-walked from the start each time. This is that same walk, once.
 */
function align(base: readonly string[], side: readonly string[]): Alignment {
  const kept = new Array<boolean>(base.length).fill(false);
  const inserted: string[][] = Array.from({ length: base.length + 1 }, () => []);

  /* An insert that follows a delete is the second half of a *replacement*, and it belongs at the
     front of the run that was deleted rather than behind it. Left where the diff emits it, a
     replaced sentence would anchor its new text one position further along, where it would be judged
     against a unit neither side actually touched. Reordering the pair here is the whole fix, and it
     costs one comparison per op. */
  const ops: DiffOp[] = [];
  for (const op of diffUnits(base, side)) {
    const last = ops[ops.length - 1];
    if (op[0] === '+' && last && last[0] === '-') ops.splice(ops.length - 1, 0, op);
    else ops.push(op);
  }

  let i = 0;
  for (const op of ops) {
    if (op[0] === '=') {
      for (let j = 0; j < op[1]; j++) kept[i + j] = true;
      i += op[1];
    } else if (op[0] === '-') {
      i += op[1]; // `kept` is already false for these
    } else {
      inserted[i].push(...op[1]);
    }
  }
  return { kept, inserted };
}

const sameUnits = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((unit, i) => unit === b[i]);

/**
 * Both sides of an irreconcilable spot, one after the other.
 *
 * Ours first, then theirs — the order a conflict marker would have used, and the one that leaves
 * the text this device has been looking at where the reader last saw it. A newline goes between
 * them unless the first side already ends in whitespace, so two rival versions land on separate
 * lines instead of butting up against each other mid-word. It is a *soft* break in Markdown, so a
 * conflict inside a paragraph doesn't split the paragraph in the rendered view — it only becomes
 * legible in the editor, which is where someone is going to resolve it.
 *
 * Whatever the two sides still agree on is emitted once, not twice. Two devices that each appended
 * a line to the same note both "changed the last sentence", because a segment carries its own
 * trailing newline — so without this trim, keeping both sides would keep a copy of the sentence
 * they share as well, and the note would grow a duplicate paragraph every time.
 */
function keepBoth(ours: readonly string[], theirs: readonly string[]): string[] {
  if (!ours.length) return [...theirs];
  if (!theirs.length) return [...ours];

  let head = 0;
  while (head < ours.length && head < theirs.length && ours[head] === theirs[head]) head++;
  let tail = 0;
  while (
    tail < ours.length - head &&
    tail < theirs.length - head &&
    ours[ours.length - 1 - tail] === theirs[theirs.length - 1 - tail]
  ) {
    tail++;
  }

  const shared = { start: ours.slice(0, head), end: ours.slice(ours.length - tail) };
  const ourMiddle = ours.slice(head, ours.length - tail);
  const theirMiddle = theirs.slice(head, theirs.length - tail);
  if (!ourMiddle.length) return [...shared.start, ...theirMiddle, ...shared.end];
  if (!theirMiddle.length) return [...shared.start, ...ourMiddle, ...shared.end];

  const needsBreak = !/\s$/.test(ourMiddle[ourMiddle.length - 1]);
  return [
    ...shared.start,
    ...ourMiddle,
    ...(needsBreak ? ['\n'] : []),
    ...theirMiddle,
    ...shared.end,
  ];
}

/**
 * The merge itself, one base position at a time.
 *
 * ## Why per-position rather than per-region
 *
 * Textbook diff3 groups every consecutive position the two sides disagree about into one chunk and
 * decides the chunk as a whole. That is right for source code, where a changed line's neighbours
 * are its context, and wrong here: adjacent sentences are *independent*, and grouping them means
 * "you fixed sentence one while I extended sentence two" comes out as a conflict over both. Every
 * position is decided on its own, so an edit only ever collides with an edit in the same place.
 *
 * ## The three rules, and the fourth case
 *
 * Each position yields three little sequences — what the base had there, what we have, what they
 * have — and the diff3 rules settle almost all of them: if one side matches the base, that side
 * didn't change it, so take the other; if the two sides match each other, they made the same change
 * and it is taken once. What is left is both sides having written something different in the same
 * place, and that is where `allowRefine` earns its keep.
 */
function mergeUnits(
  base: readonly string[],
  ours: readonly string[],
  theirs: readonly string[],
  /** False in the grapheme pass, which is what stops it recursing into itself. */
  allowRefine: boolean,
): { units: string[]; conflicts: number } {
  const ourSide = align(base, ours);
  const theirSide = align(base, theirs);

  const out: string[] = [];
  let conflicts = 0;

  /* One position past the end is a real position: it is where text appended to the document goes,
     and it is where two devices that both wrote at the bottom of a note meet. */
  for (let i = 0; i <= base.length; i++) {
    const unit = i < base.length ? base[i] : null;
    const ourKept = unit !== null && ourSide.kept[i];
    const theirKept = unit !== null && theirSide.kept[i];
    const ourInserts = ourSide.inserted[i];
    const theirInserts = theirSide.inserted[i];

    /* What each side has at this position: whatever it put in front of the base unit, plus the base
       unit itself if it still has it. A side that dropped the unit and inserted in its place
       therefore reads as a *replacement*, which is what makes the refinement below able to compare
       the two rewrites against the sentence they both rewrote. */
    const baseCell = unit === null ? [] : [unit];
    const ourCell = ourKept ? [...ourInserts, unit as string] : ourInserts;
    const theirCell = theirKept ? [...theirInserts, unit as string] : theirInserts;

    if (sameUnits(ourCell, baseCell)) {
      out.push(...theirCell); // only they touched this position
    } else if (sameUnits(theirCell, baseCell)) {
      out.push(...ourCell); // only we did
    } else if (sameUnits(ourCell, theirCell)) {
      out.push(...ourCell); // both, and they agree
    } else {
      /* Both wrote here, differently — but "differently" was just decided a whole sentence at a
         time, and two edits inside one sentence are the commonest way for that to overstate the
         case. Retry the position grapheme by grapheme, and keep the answer only if it comes back
         with nothing left to decide: a refinement that still conflicts is discarded whole rather
         than emitted in pieces, because pieces of two sentences interleaved is worse than either
         of them. That is the difference between `café`/`cafe on Tuesday` merging cleanly and
         `at six`/`at seven` becoming `at sisxeven`. */
      const refined = allowRefine
        ? mergeUnits(
            graphemes(baseCell.join('')),
            graphemes(ourCell.join('')),
            graphemes(theirCell.join('')),
            false,
          )
        : null;
      if (refined && refined.conflicts === 0) {
        out.push(refined.units.join(''));
      } else if (ourKept && theirKept) {
        /* Both sides still have the base unit and only disagree about what to put in front of it —
           two people adding to the same spot. Keeping both *cells* would emit the base unit twice;
           the dispute is over the inserts alone. */
        out.push(...keepBoth(ourInserts, theirInserts), unit as string);
        conflicts++;
      } else {
        out.push(...keepBoth(ourCell, theirCell));
        conflicts++;
      }
    }
  }

  return { units: out, conflicts };
}

/**
 * Merge two edits of the same text, given the text they both started from.
 *
 * `base` is the common ancestor — the last version both sides agreed on, not "yesterday's" or "the
 * server's". Getting that wrong is the one way to misuse this function: a base that is actually one
 * of the two sides turns the merge into "take the other one", silently, which is last-write-wins
 * wearing a merge's clothes. See `pluginDocumentBases` in db/pluginDocuments.ts for where this
 * app's ancestor comes from and what keeps it honest.
 *
 * The three shortcuts at the top are not just speed. `ours === theirs` covers a pull that brought
 * back the device's own write, which is by far the commonest call and must never spend a
 * segmentation on it.
 */
export function merge3(base: string, ours: string, theirs: string): MergeResult {
  if (ours === theirs) return { text: ours, conflicts: 0 };
  if (base === ours) return { text: theirs, conflicts: 0 };
  if (base === theirs) return { text: ours, conflicts: 0 };
  const merged = mergeUnits(sentences(base), sentences(ours), sentences(theirs), true);
  return { text: merged.units.join(''), conflicts: merged.conflicts };
}
