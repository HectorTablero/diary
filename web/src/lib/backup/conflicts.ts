import type { PersonDto, TagDto } from '@diary/shared';
import { isContained } from '../conflicts';
import { toE164 } from '../phone';
import { fuzzyEquals } from '../tokens';
import type { EntryBackupRow, PersonBackupRow, TagBackupRow } from './schema';

/* Conflict detection for restoring a JSON backup. Deliberately kept separate from
   lib/conflicts.ts (built for the device-contacts import) rather than extending it: a backup row
   is keyed by its own id (not a contactId), and entries/tags need conflict kinds contacts never
   did. Two modules cost a little duplication but mean the well-tested contacts-import flow can't
   regress from changes made here. Pure helpers (isContained/fuzzyEquals) are reused as-is since
   they don't know anything about contacts specifically. */

export type BackupResolution =
  | { action: 'create' }
  | { action: 'merge'; targetId: string }
  /** Entries only: replace the existing row's content in place instead of adding a second copy. */
  | { action: 'overwrite' };

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
  const result = new Map<string, TagConflictMatch[]>();
  const byId = new Map(existing.map((tag) => [tag.id, tag]));

  for (const row of rows) {
    const matches: TagConflictMatch[] = [];
    const sameId = byId.get(row.id);
    if (sameId) {
      matches.push({ kind: 'idExists', targetId: sameId.id, name: sameId.name });
    } else {
      const clash = existing.find((tag) => fuzzyEquals(tag.name, row.name));
      if (clash) matches.push({ kind: 'nameDuplicate', targetId: clash.id, name: clash.name });
    }
    if (matches.length) result.set(row.id, matches);
  }
  return result;
}

/** `idExists` merges into itself — a no-op mapping, since the tag is already exactly there.
    `nameDuplicate` has no safe default: the user must choose to merge into the clashing tag
    or rename this one. */
export function defaultTagResolution(matches: TagConflictMatch[] | undefined): BackupResolution | null {
  if (!matches?.length) return { action: 'create' };
  const idExists = matches.find((m) => m.kind === 'idExists');
  if (idExists) return { action: 'merge', targetId: idExists.targetId };
  return null;
}

export const isTagHardConflict = (matches: TagConflictMatch[]): boolean =>
  matches.some((m) => m.kind === 'nameDuplicate');

// --- People ---

export type PersonConflictKind = 'idExists' | 'nameDuplicate' | 'containment' | 'phone';

export interface PersonConflictMatch {
  kind: PersonConflictKind;
  targetId: string;
  name: string;
}

const personAnswersTo = (person: PersonDto, name: string): boolean =>
  fuzzyEquals(person.name, name) || person.aliases.some((alias) => fuzzyEquals(alias, name));

export function detectPersonBackupConflicts(
  rows: PersonBackupRow[],
  existing: PersonDto[],
): Map<string, PersonConflictMatch[]> {
  const result = new Map<string, PersonConflictMatch[]>();
  const byId = new Map(existing.map((person) => [person.id, person]));

  for (const row of rows) {
    const matches: PersonConflictMatch[] = [];
    const sameId = byId.get(row.id);
    if (sameId) {
      matches.push({ kind: 'idExists', targetId: sameId.id, name: sameId.name });
    } else {
      const rowE164 = toE164(row.phone);
      for (const person of existing) {
        if (personAnswersTo(person, row.name)) {
          matches.push({ kind: 'nameDuplicate', targetId: person.id, name: person.name });
          continue;
        }
        if (isContained(row.name, person.name)) {
          matches.push({ kind: 'containment', targetId: person.id, name: person.name });
          continue;
        }
        if (rowE164 && rowE164 === toE164(person.phone)) {
          matches.push({ kind: 'phone', targetId: person.id, name: person.name });
        }
      }
    }
    if (matches.length) result.set(row.id, matches);
  }
  return result;
}

/** `idExists` defaults to merging into itself: mergeBackupPersonPatch only ever fills blanks, so
    it's always safe. Every other kind requires an explicit choice. */
export function defaultPersonResolution(matches: PersonConflictMatch[] | undefined): BackupResolution | null {
  if (!matches?.length) return { action: 'create' };
  const idExists = matches.find((m) => m.kind === 'idExists');
  if (idExists) return { action: 'merge', targetId: idExists.targetId };
  return null;
}

export const isPersonHardConflict = (matches: PersonConflictMatch[]): boolean =>
  matches.some((m) => m.kind === 'nameDuplicate');

// --- Entries ---

export type EntryConflictKind = 'idExists';

export interface EntryConflictMatch {
  kind: EntryConflictKind;
  targetId: string;
}

/** Only an id collision counts — entries have no name to clash on. */
export function detectEntryConflicts(
  rows: EntryBackupRow[],
  existingIds: Set<string>,
): Map<string, EntryConflictMatch[]> {
  const result = new Map<string, EntryConflictMatch[]>();
  for (const row of rows) {
    if (existingIds.has(row.id)) result.set(row.id, [{ kind: 'idExists', targetId: row.id }]);
  }
  return result;
}

/** Entries never block the import: an id collision always has a safe default — keep both under a
    fresh id, the same "only ever add, never clobber" rule mutations.ts applies to person merges.
    Overwriting the existing row in place is offered, but only as an explicit opt-in per row. */
export function defaultEntryResolution(): BackupResolution {
  return { action: 'create' };
}
