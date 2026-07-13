import type { PersonDto } from '@diary/shared';
import { describe, expect, it } from 'vitest';
import {
  canKeepBoth,
  defaultResolution,
  detectConflicts,
  isContained,
  isHardConflict,
  type ContactCandidate,
} from './conflicts';

const person = (overrides: Partial<PersonDto>): PersonDto => ({
  id: 'p1',
  name: '',
  aliases: [],
  phone: null,
  email: null,
  wechatId: null,
  birthday: null,
  company: null,
  jobTitle: null,
  contactId: null,
  tags: [],
  notes: '',
  checkupIntervalDays: null,
  lastCheckupAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const candidate = (overrides: Partial<ContactCandidate>): ContactCandidate => ({
  contactId: 'c1',
  name: '',
  aliases: [],
  phone: null,
  email: null,
  birthday: null,
  company: null,
  jobTitle: null,
  ...overrides,
});

describe('isContained', () => {
  it('flags a name whose words are a subset of another', () => {
    expect(isContained('Irene', 'Irene G.')).toBe(true);
    expect(isContained('Irene G.', 'Irene')).toBe(true);
    expect(isContained('Ana', 'Ana María')).toBe(true);
  });

  it('does NOT flag names that merely share letters', () => {
    // The whole reason this compares token sets rather than substrings:
    // "susana".includes("ana") is true, and would nag on every single import.
    expect(isContained('Ana', 'Susana')).toBe(false);
    expect(isContained('Marta', 'Martina')).toBe(false);
  });

  it('ignores case and accents', () => {
    expect(isContained('ana', 'Ana María')).toBe(true);
    expect(isContained('José', 'jose luis')).toBe(true);
  });

  it('does not treat an identical name as containment', () => {
    expect(isContained('Irene', 'Irene')).toBe(false);
  });
});

describe('detectConflicts', () => {
  it('reports an exact name clash with an existing person as a hard duplicate', () => {
    const conflicts = detectConflicts(
      [candidate({ contactId: 'c1', name: 'Marta' })],
      [person({ id: 'p1', name: 'Marta' })],
    );
    const matches = conflicts.get('c1')!;
    expect(matches).toEqual([{ kind: 'duplicate', personId: 'p1', name: 'Marta' }]);
    expect(isHardConflict(matches)).toBe(true);
  });

  it('treats a name matching an existing alias as a duplicate too', () => {
    const conflicts = detectConflicts(
      [candidate({ contactId: 'c1', name: 'Mum' })],
      [person({ id: 'p1', name: 'Carmen', aliases: ['Mum'] })],
    );
    expect(conflicts.get('c1')).toEqual([{ kind: 'duplicate', personId: 'p1', name: 'Carmen' }]);
  });

  it('reports containment as a soft conflict that can still be kept', () => {
    const conflicts = detectConflicts(
      [candidate({ contactId: 'c1', name: 'Irene G.' })],
      [person({ id: 'p1', name: 'Irene' })],
    );
    const matches = conflicts.get('c1')!;
    expect(matches).toEqual([{ kind: 'containment', personId: 'p1', name: 'Irene' }]);
    expect(isHardConflict(matches)).toBe(false);
  });

  it('spots the same human under a different name via their phone number', () => {
    const conflicts = detectConflicts(
      [candidate({ contactId: 'c1', name: 'Mum', phone: '+34 600 123 456' })],
      [person({ id: 'p1', name: 'Carmen', phone: '+34600123456' })],
    );
    expect(conflicts.get('c1')).toEqual([{ kind: 'phone', personId: 'p1', name: 'Carmen' }]);
  });

  it('does not match on phone when the number is not international', () => {
    // Two different people can both have a local "600123456" saved; without a country code
    // we cannot claim they are the same number.
    const conflicts = detectConflicts(
      [candidate({ contactId: 'c1', name: 'Mum', phone: '600123456' })],
      [person({ id: 'p1', name: 'Carmen', phone: '600123456' })],
    );
    expect(conflicts.has('c1')).toBe(false);
  });

  it('catches two selected contacts that clash with each other, with no merge target', () => {
    const conflicts = detectConflicts(
      [
        candidate({ contactId: 'c1', name: 'Irene' }),
        candidate({ contactId: 'c2', name: 'Irene' }),
      ],
      [],
    );
    expect(conflicts.get('c1')).toEqual([{ kind: 'duplicate', personId: null, name: 'Irene' }]);
    expect(conflicts.get('c2')).toEqual([{ kind: 'duplicate', personId: null, name: 'Irene' }]);
  });

  it('matches a re-imported contact by contactId even after the person was renamed', () => {
    // Without the contactId check this sails past every name test and creates a second copy.
    const conflicts = detectConflicts(
      [candidate({ contactId: 'android-7', name: 'Irene' })],
      [person({ id: 'p1', name: 'Irene González', contactId: 'android-7' })],
    );
    expect(conflicts.get('android-7')).toEqual([
      { kind: 'imported', personId: 'p1', name: 'Irene González' },
    ]);
  });

  it('defaults a re-import to merging, and leaves every other conflict unresolved', () => {
    expect(defaultResolution([{ kind: 'imported', personId: 'p1', name: 'Irene' }])).toEqual({
      action: 'merge',
      personId: 'p1',
    });
    expect(defaultResolution([{ kind: 'duplicate', personId: 'p1', name: 'Marta' }])).toBeNull();
    expect(defaultResolution([{ kind: 'containment', personId: 'p1', name: 'Irene' }])).toBeNull();
    expect(defaultResolution(undefined)).toEqual({ action: 'create' });
  });

  it('allows keeping both only when no hard duplicate blocks the name', () => {
    expect(canKeepBoth([{ kind: 'containment', personId: 'p1', name: 'Irene' }])).toBe(true);
    expect(canKeepBoth([{ kind: 'duplicate', personId: 'p1', name: 'Marta' }])).toBe(false);
  });

  it('leaves clean candidates out of the map entirely', () => {
    const conflicts = detectConflicts(
      [candidate({ contactId: 'c1', name: 'Susana' })],
      [person({ id: 'p1', name: 'Ana' })],
    );
    expect(conflicts.size).toBe(0);
  });
});
