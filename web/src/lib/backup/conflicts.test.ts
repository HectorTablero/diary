import type { PersonDto, TagDto } from '@diary/shared';
import { describe, expect, it } from 'vitest';
import {
  backupMergeTargets,
  defaultEntryResolution,
  defaultTagResolution,
  detectEntryConflicts,
  detectPersonBackupConflicts,
  detectTagConflicts,
  entryFingerprint,
  isTagHardConflict,
  type ExistingEntryIndex,
} from './conflicts';
import type { EntryBackupRow, PersonBackupRow, TagBackupRow } from './schema';

const tagRow = (overrides: Partial<TagBackupRow>): TagBackupRow => ({
  id: 't1',
  name: 'Work',
  color: '#ff0000',
  ...overrides,
});

const tag = (overrides: Partial<TagDto>): TagDto => ({
  id: 'local1',
  name: 'Work',
  color: '#ff0000',
  ...overrides,
});

const personRow = (overrides: Partial<PersonBackupRow>): PersonBackupRow => ({
  id: 'r1',
  name: 'Irene',
  aliases: [],
  phone: null,
  email: null,
  wechatId: null,
  birthday: null,
  company: null,
  jobTitle: null,
  contactId: null,
  events: [],
  tagIds: [],
  notes: '',
  checkupIntervalDays: null,
  lastCheckupAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const person = (overrides: Partial<PersonDto>): PersonDto => ({
  id: 'p1',
  name: 'Irene',
  aliases: [],
  phone: null,
  email: null,
  wechatId: null,
  birthday: null,
  company: null,
  jobTitle: null,
  contactId: null,
  events: [],
  tags: [],
  notes: '',
  checkupIntervalDays: null,
  lastCheckupAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const entryRow = (overrides: Partial<EntryBackupRow>): EntryBackupRow => ({
  id: 'e1',
  content: 'called Mum',
  dateKey: '2026-03-04',
  importance: 1,
  tagIds: [],
  peopleIds: [],
  threadIds: [],
  saidTo: [],
  hiddenFor: [],
  parentId: null,
  createdAt: '2026-03-04T10:00:00.000Z',
  updatedAt: '2026-03-04T10:00:00.000Z',
  ...overrides,
});

const emptyEntryIndex = (): ExistingEntryIndex => ({
  ids: new Set(),
  byFingerprint: new Map(),
  byId: new Map(),
});

describe('detectTagConflicts', () => {
  it('reports an id that is already taken', () => {
    const conflicts = detectTagConflicts([tagRow({ id: 'same' })], [tag({ id: 'same' })]);
    expect(conflicts.get('same')).toContainEqual({
      kind: 'idExists',
      targetId: 'same',
      name: 'Work',
    });
  });

  it('reports the name clash alongside the id clash, so "keep both" stays blocked', () => {
    // Both facts hold, and only the second one says the row cannot be created a second time —
    // reporting just the id used to leave "keep both" enabled and produce a 409 on sync.
    const conflicts = detectTagConflicts([tagRow({ id: 'same' })], [tag({ id: 'same' })])!;
    expect(isTagHardConflict(conflicts.get('same')!)).toBe(true);
  });

  it('still defaults to merging into itself when the id is already there', () => {
    const conflicts = detectTagConflicts([tagRow({ id: 'same' })], [tag({ id: 'same' })]);
    expect(defaultTagResolution(conflicts.get('same'))).toEqual({
      action: 'merge',
      targetId: 'same',
    });
  });

  it('matches an existing name past case and accents', () => {
    const conflicts = detectTagConflicts([tagRow({ name: 'wörk' })], [tag({ name: 'Work' })]);
    expect(conflicts.get('t1')).toEqual([
      { kind: 'nameDuplicate', targetId: 'local1', name: 'Work' },
    ]);
  });

  it('leaves the rows of one file to each other', () => {
    // They coexisted in the diary this file came out of and nothing on the review screen edits a
    // name, so there is no clash to find — and no rename button to resolve one with if there were.
    const rows = [tagRow({ id: 'a', name: 'Work' }), tagRow({ id: 'b', name: 'wörk' })];
    expect(detectTagConflicts(rows, []).size).toBe(0);
  });

  it('always leaves a way out of a name clash', () => {
    // "Keep both" is blocked by a duplicate name, so merging has to be offered or the row would
    // block the import with nothing the user could press.
    const conflicts = detectTagConflicts([tagRow({ name: 'Work' })], [tag({ name: 'Work' })]);
    expect(isTagHardConflict(conflicts.get('t1')!)).toBe(true);
    expect(backupMergeTargets(conflicts.get('t1')!)).toEqual([
      { targetId: 'local1', name: 'Work' },
    ]);
  });

  it('reports nothing for a genuinely new tag', () => {
    expect(detectTagConflicts([tagRow({ name: 'Hobbies' })], [tag({})]).size).toBe(0);
  });
});

describe('detectPersonBackupConflicts', () => {
  it('matches an alias of an existing person', () => {
    const conflicts = detectPersonBackupConflicts(
      [personRow({ name: 'Mum' })],
      [person({ id: 'p1', name: 'Carmen', aliases: ['Mum'] })],
    );
    expect(conflicts.get('r1')).toEqual([
      { kind: 'nameDuplicate', targetId: 'p1', name: 'Carmen' },
    ]);
  });

  it('reports one person once, by the strongest signal', () => {
    const conflicts = detectPersonBackupConflicts(
      [personRow({ name: 'Irene', phone: '+34600111222' })],
      [person({ id: 'p1', name: 'Irene G.', phone: '+34600111222' })],
    );
    expect(conflicts.get('r1')).toEqual([
      { kind: 'containment', targetId: 'p1', name: 'Irene G.' },
    ]);
  });

  it('offers one merge button per person, not one per reason', () => {
    const conflicts = detectPersonBackupConflicts(
      [personRow({ id: 'p1', name: 'Irene' })],
      [person({ id: 'p1', name: 'Irene' })],
    );
    expect(backupMergeTargets(conflicts.get('p1')!)).toEqual([{ targetId: 'p1', name: 'Irene' }]);
  });

  it('reports nothing for a person this device has never seen', () => {
    const conflicts = detectPersonBackupConflicts(
      [personRow({ name: 'Hugo' })],
      [person({ id: 'p1', name: 'Irene' })],
    );
    expect(conflicts.size).toBe(0);
  });
});

describe('detectEntryConflicts', () => {
  it('registers an id collision as a conflict', () => {
    // It used to be detected and then dropped on the floor, which left the row defaulting to
    // "create" and importing the same file twice doubled the diary.
    const index = emptyEntryIndex();
    index.ids.add('e1');
    index.byId.set('e1', { content: 'called Mum' });

    const conflicts = detectEntryConflicts([entryRow({})], index);
    expect(conflicts.get('e1')).toEqual([{ kind: 'idExists', targetId: 'e1', name: 'called Mum' }]);
    expect(defaultEntryResolution(conflicts.get('e1'))).toEqual({ action: 'overwrite' });
  });

  it('recognises the same entry re-imported under a fresh id', () => {
    const row = entryRow({ id: 'newId' });
    const index = emptyEntryIndex();
    index.ids.add('localId');
    index.byFingerprint.set(entryFingerprint(row), 'localId');
    index.byId.set('localId', { content: 'called Mum' });

    expect(defaultEntryResolution(detectEntryConflicts([row], index).get('newId'))).toEqual({
      action: 'merge',
      targetId: 'localId',
    });
  });

  it('leaves an entry with the same text on another day alone', () => {
    const row = entryRow({ id: 'newId', dateKey: '2026-03-05' });
    const index = emptyEntryIndex();
    index.byFingerprint.set(entryFingerprint(entryRow({})), 'localId');

    expect(detectEntryConflicts([row], index).size).toBe(0);
  });
});
