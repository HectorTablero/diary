import type { PersonDto, TagDto, ThreadDto } from '@diary/shared';
import { isContainedTokens, nameTokens } from '../conflicts';
import { toE164 } from '../phone';
import { normalize } from '../tokens';
import type { EntryBackupRow, PersonBackupRow, TagBackupRow, ThreadBackupRow } from './schema';

/* Conflict detection for restoring a JSON backup. Deliberately kept separate from
   lib/conflicts.ts (built for the device-contacts import) rather than extending it: a backup row
   is keyed by its own id (not a contactId), and entries/tags need conflict kinds contacts never
   did. Two modules cost a little duplication but mean the well-tested contacts-import flow can't
   regress from changes made here. Pure helpers (isContainedTokens/nameTokens) are reused as-is
   since they don't know anything about contacts specifically. */

export type BackupResolution =
  | { action: 'create' }
  | { action: 'merge'; targetId: string }
  /** Entries only: replace the existing row's content in place instead of adding a second copy. */
  | { action: 'overwrite' };

/**
 * The merge buttons a conflicted row should actually offer.
 *
 * One local row can be matched by more than one signal — its id *and* its name, or a contained name
 * *and* a shared phone number — which is several reasons to suspect it is the same thing, not
 * several things to merge into. Everything a backup row can clash with already exists here, so
 * every match has a target and merging is always a way out; nothing can reach the review screen
 * that the user has no button to resolve.
 */
export function backupMergeTargets<T extends { targetId: string; name: string }>(
  matches: T[],
): { targetId: string; name: string }[] {
  const seen = new Set<string>();
  const targets: { targetId: string; name: string }[] = [];
  for (const match of matches) {
    if (seen.has(match.targetId)) continue;
    seen.add(match.targetId);
    targets.push({ targetId: match.targetId, name: match.name });
  }
  return targets;
}

/** A row's own id is already taken locally, or its name is. */
interface NamedConflictMatch {
  kind: 'idExists' | 'nameDuplicate';
  targetId: string;
  name: string;
}

/**
 * Shared body of the tag and thread detectors — the two collide on exactly the same things.
 *
 * Both facts are reported when both hold, rather than the id check short-circuiting the name check
 * as it used to. A row whose id is already here *and* whose name is already here cannot be kept
 * alongside the local copy under that name, and the id match alone did not say so: "keep both"
 * stayed enabled and produced a second row that `POST` answers with a 409, which sync.ts treats as
 * a phantom create and resolves by deleting the local row (sync.ts:102). Restoring a backup could
 * therefore delete the very thing it was restoring.
 *
 * Rows are never checked against each other, only against what is already here. They came out of
 * one diary, where the unique index had already rejected any duplicate among them, and nothing on
 * this screen edits a name — so there is no way for two rows of one file to arrive in conflict.
 */
function detectNamedConflicts(
  rows: { id: string; name: string }[],
  existing: { id: string; name: string }[],
): Map<string, NamedConflictMatch[]> {
  const result = new Map<string, NamedConflictMatch[]>();
  const byId = new Map(existing.map((item) => [item.id, item]));
  const byName = new Map<string, { id: string; name: string }>();
  for (const item of existing) {
    const key = normalize(item.name);
    if (!byName.has(key)) byName.set(key, item);
  }

  for (const row of rows) {
    const matches: NamedConflictMatch[] = [];

    const sameId = byId.get(row.id);
    if (sameId) matches.push({ kind: 'idExists', targetId: sameId.id, name: sameId.name });

    const clash = byName.get(normalize(row.name));
    if (clash) matches.push({ kind: 'nameDuplicate', targetId: clash.id, name: clash.name });

    if (matches.length) result.set(row.id, matches);
  }
  return result;
}

// --- Tags ---

export type TagConflictKind = 'idExists' | 'nameDuplicate';

export interface TagConflictMatch {
  kind: TagConflictKind;
  targetId: string;
  name: string;
}

export function detectTagConflicts(
  rows: TagBackupRow[],
  existing: TagDto[],
): Map<string, TagConflictMatch[]> {
  return detectNamedConflicts(rows, existing);
}

/** `idExists` merges into itself — a no-op mapping, since the tag is already exactly there.
    `nameDuplicate` has no safe default: the user must choose to merge into the clashing tag
    or rename this one. */
export function defaultTagResolution(
  matches: TagConflictMatch[] | undefined,
): BackupResolution | null {
  if (!matches?.length) return { action: 'create' };
  const idExists = matches.find((m) => m.kind === 'idExists');
  if (idExists) return { action: 'merge', targetId: idExists.targetId };
  return null;
}

export const isTagHardConflict = (matches: TagConflictMatch[]): boolean =>
  matches.some((m) => m.kind === 'nameDuplicate');

// --- Threads ---

/* Threads collide on exactly the same two things tags do (their own id, or a name the unique
   index would reject), so the shapes and the default rule are deliberately identical. Kept as
   separate exported functions rather than one generic entry point: the two lists are reviewed
   independently in the import UI, and a future thread-only conflict kind shouldn't have to widen
   tags. */

export type ThreadConflictKind = 'idExists' | 'nameDuplicate';

export interface ThreadConflictMatch {
  kind: ThreadConflictKind;
  targetId: string;
  name: string;
}

export function detectThreadConflicts(
  rows: ThreadBackupRow[],
  existing: ThreadDto[],
): Map<string, ThreadConflictMatch[]> {
  return detectNamedConflicts(rows, existing);
}

/** Same rule as tags: an id that's already there merges into itself, a name clash needs a choice. */
export function defaultThreadResolution(
  matches: ThreadConflictMatch[] | undefined,
): BackupResolution | null {
  if (!matches?.length) return { action: 'create' };
  const idExists = matches.find((m) => m.kind === 'idExists');
  if (idExists) return { action: 'merge', targetId: idExists.targetId };
  return null;
}

export const isThreadHardConflict = (matches: ThreadConflictMatch[]): boolean =>
  matches.some((m) => m.kind === 'nameDuplicate');

// --- People ---

export type PersonConflictKind = 'idExists' | 'nameDuplicate' | 'containment' | 'phone';

export interface PersonConflictMatch {
  kind: PersonConflictKind;
  targetId: string;
  name: string;
}

/**
 * People collide on everything tags do plus two softer signals, so the lookups are built once for
 * the whole file rather than per row: a restore compares every row against every local person, and
 * re-normalizing the same names once per pair is what made a large backup take seconds to review.
 * Only containment still needs the pairwise walk, and it walks precomputed token sets.
 *
 * At most one match per local person, in the order name > containment > phone — a person who
 * already clashes by name is not additionally "similar" or "reachable on the same number", those
 * are the same fact stated three times.
 */
export function detectPersonBackupConflicts(
  rows: PersonBackupRow[],
  existing: PersonDto[],
): Map<string, PersonConflictMatch[]> {
  const result = new Map<string, PersonConflictMatch[]>();
  const byId = new Map(existing.map((person) => [person.id, person]));
  const byPhone = new Map<string, PersonDto>();
  /* Aliases go in the same index as names: "Mum" being an alias of Carmen is exactly as much of a
     clash as it being her name, since an @mention binds to either. */
  const byName = new Map<string, PersonDto>();
  const tokensById = new Map<string, Set<string>>();

  for (const person of existing) {
    for (const name of [person.name, ...person.aliases]) {
      const key = normalize(name);
      if (!byName.has(key)) byName.set(key, person);
    }
    const e164 = toE164(person.phone);
    if (e164 && !byPhone.has(e164)) byPhone.set(e164, person);
    tokensById.set(person.id, nameTokens(person.name));
  }

  for (const row of rows) {
    const matches: PersonConflictMatch[] = [];
    const reported = new Set<string>();

    const sameId = byId.get(row.id);
    if (sameId) matches.push({ kind: 'idExists', targetId: sameId.id, name: sameId.name });

    const named = byName.get(normalize(row.name));
    if (named) {
      matches.push({ kind: 'nameDuplicate', targetId: named.id, name: named.name });
      reported.add(named.id);
    }

    const rowTokens = nameTokens(row.name);
    for (const person of existing) {
      if (reported.has(person.id)) continue;
      if (!isContainedTokens(rowTokens, tokensById.get(person.id)!)) continue;
      matches.push({ kind: 'containment', targetId: person.id, name: person.name });
      reported.add(person.id);
    }

    const rowE164 = toE164(row.phone);
    const samePhone = rowE164 ? byPhone.get(rowE164) : undefined;
    if (samePhone && !reported.has(samePhone.id)) {
      matches.push({ kind: 'phone', targetId: samePhone.id, name: samePhone.name });
    }

    if (matches.length) result.set(row.id, matches);
  }
  return result;
}

/** `idExists` defaults to merging into itself: mergeBackupPersonPatch only ever fills blanks, so
    it's always safe. Every other kind requires an explicit choice. */
export function defaultPersonResolution(
  matches: PersonConflictMatch[] | undefined,
): BackupResolution | null {
  if (!matches?.length) return { action: 'create' };
  const idExists = matches.find((m) => m.kind === 'idExists');
  if (idExists) return { action: 'merge', targetId: idExists.targetId };
  return null;
}

export const isPersonHardConflict = (matches: PersonConflictMatch[]): boolean =>
  matches.some((m) => m.kind === 'nameDuplicate');

// --- Entries ---

export type EntryConflictKind = 'idExists' | 'duplicate';

export interface EntryConflictMatch {
  kind: EntryConflictKind;
  targetId: string;
  name: string;
}

/**
 * What identifies an entry when its id can't be trusted.
 *
 * The day it belongs to, the moment it was created, and its text. Two of those alone would not be
 * enough — "called Mum" twice on one day is an ordinary thing to write — but `createdAt` is a
 * millisecond timestamp minted once, on one device, when the entry was first saved, and it survives
 * both export and import untouched. Two rows agreeing on all three are the same entry that has been
 * round-tripped, not two entries that resemble each other.
 *
 * NUL as the separator so no field's content can imitate a boundary and make two different entries
 * fingerprint alike.
 */
export const entryFingerprint = (entry: {
  dateKey: string;
  createdAt: string;
  content: string;
}): string => [entry.dateKey, entry.createdAt, entry.content].join('\u0000');

export interface ExistingEntryIndex {
  ids: Set<string>;
  /** Fingerprint → the local id carrying it. */
  byFingerprint: Map<string, string>;
  /** Id → preview of the existing entry for merge-target labels. */
  byId: Map<string, { content: string }>;
}

/**
 * Which backup rows already exist here, by id *or* by content.
 *
 * The id check alone used to be the whole function, and it was not enough for the case that matters
 * most: an entry that has already been imported once under a different id. Nothing about it looks
 * like a conflict — the id in the file is free — so it came in again as a second copy, and again on
 * every subsequent import, because each pass gave it another new id to be free under.
 *
 * The two kinds are checked in that order and only one is reported. If the id is taken, the row and
 * the local entry are the same entry by the strongest evidence there is, and there is nothing a
 * fingerprint could add. Only when the id is free does it become worth asking whether some *other*
 * local row is nonetheless this same entry.
 */
export function detectEntryConflicts(
  rows: EntryBackupRow[],
  existing: ExistingEntryIndex,
): Map<string, EntryConflictMatch[]> {
  const result = new Map<string, EntryConflictMatch[]>();

  for (const row of rows) {
    const matches: EntryConflictMatch[] = [];

    if (existing.ids.has(row.id)) {
      const target = existing.byId.get(row.id);
      matches.push({ kind: 'idExists', targetId: row.id, name: target?.content ?? row.id });
    } else {
      const twin = existing.byFingerprint.get(entryFingerprint(row));
      if (twin) {
        const target = existing.byId.get(twin);
        matches.push({ kind: 'duplicate', targetId: twin, name: target?.content ?? twin });
      }
    }

    if (matches.length) result.set(row.id, matches);
  }

  return result;
}

/**
 * Entries never block the import — every case here has a defensible default — but neither of these
 * defaults is "add a second copy", which is what this used to return unconditionally.
 *
 * - **Same id.** The file and the device are describing one entry, so the import writes the file's
 *   version onto it. That is what restoring a backup means, and it makes importing the same file
 *   twice a no-op instead of doubling the diary. "Add as new" is still offered per row for anyone
 *   who genuinely wants both.
 * - **Same content under another id.** The entry is already here; the row is a re-import of it. Take
 *   the local one and write nothing — `merge` for entries redirects references without touching the
 *   target, so a sub-entry of this row attaches to the copy that already exists rather than to a
 *   fresh duplicate of its parent.
 * - **Neither.** Genuinely new, so create it — under its own id, which is what lets the *next*
 *   import recognise it.
 */
export function defaultEntryResolution(matches?: EntryConflictMatch[]): BackupResolution {
  const match = matches?.[0];
  if (!match) return { action: 'create' };
  return match.kind === 'idExists'
    ? { action: 'overwrite' }
    : { action: 'merge', targetId: match.targetId };
}
