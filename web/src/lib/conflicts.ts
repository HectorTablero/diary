import type { PersonDto } from '@diary/shared';
import { toE164 } from './phone';
import { fuzzyEquals, normalize } from './tokens';

/* Conflict detection for the contact import.
   Runs entirely before anything is written, on purpose: `POST /people` answers a duplicate name
   with a 409, and sync.ts treats a 409-on-POST as a phantom create and *deletes the local person*.
   Letting a duplicate reach the server would make an imported contact appear, then vanish. */

/** A device contact, mapped into the fields a Person can hold. `name` is editable in review. */
export interface ContactCandidate {
  contactId: string;
  name: string;
  aliases: string[];
  phone: string | null;
  email: string | null;
  birthday: string | null;
  company: string | null;
  jobTitle: string | null;
}

export type ConflictKind =
  /** This very contact already produced a person (matched on contactId). Takes precedence over
      every other signal — without it, re-importing a contact whose person was later *renamed*
      would sail past the name checks and create a second copy. Always resolves to a merge. */
  | 'imported'
  /** Same name as an existing person (or another selected contact). The unique index would
      reject this outright, so it can never be imported as-is. */
  | 'duplicate'
  /** One name's words are wholly contained in the other's ("Irene" vs "Irene G."). Legal, but
      ambiguous: `@Irene G.` in an entry would always bind to the longer name. */
  | 'containment'
  /** Same phone number as an existing person. Names may differ wildly ("Mum" vs "Carmen") — a
      strong hint they're the same human. */
  | 'phone';

export interface ConflictMatch {
  kind: ConflictKind;
  /** The existing person clashed with — `null` when the clash is with another selected contact,
      which can't be merged into (it doesn't exist yet). */
  personId: string | null;
  /** Name to show in the conflict row. */
  name: string;
}

/** How the user chose to deal with a candidate. `create` doubles as "keep both". */
export type Resolution =
  | { action: 'create' }
  | { action: 'merge'; personId: string }
  | { action: 'skip' };

/** Words of a name, accent- and case-insensitive: "Irene G." -> {"irene", "g"}. */
export function nameTokens(name: string): Set<string> {
  return new Set(
    normalize(name)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

function isStrictSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0 || a.size >= b.size) return false;
  for (const token of a) if (!b.has(token)) return false;
  return true;
}

/**
 * True when one name's words are wholly contained in the other's.
 *
 * Compares *token sets*, not raw substrings, and that distinction carries the whole feature:
 * `"susana".includes("ana")` is true, so a substring rule would flag Ana against Susana on every
 * single import. Token-subset flags exactly the ambiguous cases — Irene / Irene G., Ana / Ana
 * María — and leaves unrelated names that merely share letters alone.
 */
export function isContained(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  return isStrictSubset(ta, tb) || isStrictSubset(tb, ta);
}

/** A duplicate name is fatal (the DB rejects it); the softer kinds are only warnings. */
export const isHardConflict = (matches: ConflictMatch[]): boolean =>
  matches.some((m) => m.kind === 'duplicate');

/**
 * The resolution a candidate starts on. Only a re-import gets a default — everything else the
 * user must decide, so nothing is ever imported (or merged) behind their back.
 */
export function defaultResolution(matches: ConflictMatch[] | undefined): Resolution | null {
  if (!matches?.length) return { action: 'create' };
  const imported = matches.find((match) => match.kind === 'imported');
  if (imported?.personId) return { action: 'merge', personId: imported.personId };
  return null; // unresolved: blocks the import until the user picks
}

/** Merge targets offered for a candidate, in the order they were detected. */
export const mergeTargets = (matches: ConflictMatch[]): ConflictMatch[] =>
  matches.filter((match) => match.personId !== null);

/** "Keep both" is only legal when nothing hard-blocks the name. */
export const canKeepBoth = (matches: ConflictMatch[]): boolean => !isHardConflict(matches);

/** Does this name already belong to `person`, as their name or one of their aliases? */
const personAnswersTo = (person: PersonDto, name: string): boolean =>
  fuzzyEquals(person.name, name) || person.aliases.some((alias) => fuzzyEquals(alias, name));

/**
 * Conflicts for every candidate, keyed by contactId. Checked both against existing people and
 * against the other selected candidates (two contacts both called "Irene" clash with each other
 * even when neither exists yet).
 *
 * `people` should exclude nobody: a candidate whose contactId already maps to a person is matched
 * against that person too, which is what makes a re-import merge instead of duplicate.
 */
export function detectConflicts(
  candidates: ContactCandidate[],
  people: PersonDto[],
): Map<string, ConflictMatch[]> {
  const result = new Map<string, ConflictMatch[]>();

  for (const candidate of candidates) {
    const matches: ConflictMatch[] = [];
    const candidateE164 = toE164(candidate.phone);

    for (const person of people) {
      if (person.contactId && person.contactId === candidate.contactId) {
        matches.push({ kind: 'imported', personId: person.id, name: person.name });
        continue; // same contact, same human — nothing softer needs saying
      }
      if (personAnswersTo(person, candidate.name)) {
        matches.push({ kind: 'duplicate', personId: person.id, name: person.name });
        continue; // a duplicate subsumes any softer signal against the same person
      }
      if (isContained(candidate.name, person.name)) {
        matches.push({ kind: 'containment', personId: person.id, name: person.name });
        continue;
      }
      if (candidateE164 && candidateE164 === toE164(person.phone)) {
        matches.push({ kind: 'phone', personId: person.id, name: person.name });
      }
    }

    for (const other of candidates) {
      if (other.contactId === candidate.contactId) continue;
      if (fuzzyEquals(other.name, candidate.name)) {
        matches.push({ kind: 'duplicate', personId: null, name: other.name });
      } else if (isContained(candidate.name, other.name)) {
        matches.push({ kind: 'containment', personId: null, name: other.name });
      }
    }

    if (matches.length) result.set(candidate.contactId, matches);
  }

  return result;
}
