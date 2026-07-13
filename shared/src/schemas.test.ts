import { describe, expect, it } from 'vitest';
import { personUpdateSchema } from './schemas';

describe('personUpdateSchema birthday', () => {
  it('accepts both canonical forms', () => {
    expect(personUpdateSchema.parse({ birthday: '1990-07-13' }).birthday).toBe('1990-07-13');
    expect(personUpdateSchema.parse({ birthday: '--07-13' }).birthday).toBe('--07-13');
  });

  /* LEGACY (droppable at the next Dexie upversion — see web/src/db/db.ts). An early build wrote
     year-less birthdays with an extra dash. Accepting them matters for more than tidiness: a
     PATCH queued offline by one of those clients would otherwise fail validation forever, and
     sync.ts drops a rejected 4xx op on the floor — the edit would vanish silently. */
  it('accepts the legacy triple-dash form and rewrites it to canonical', () => {
    expect(personUpdateSchema.parse({ birthday: '---10-10' }).birthday).toBe('--10-10');
  });

  it('still rejects genuinely malformed values', () => {
    expect(() => personUpdateSchema.parse({ birthday: '----10-10' })).toThrow();
    expect(() => personUpdateSchema.parse({ birthday: '1990-13-01' })).toThrow();
    expect(() => personUpdateSchema.parse({ birthday: '13/10/1990' })).toThrow();
  });

  it('leaves an explicit null alone', () => {
    expect(personUpdateSchema.parse({ birthday: null }).birthday).toBeNull();
  });

  it('omits the key entirely when not sent, so a replayed old PATCH cannot blank it', () => {
    expect('birthday' in personUpdateSchema.parse({ name: 'Irene' })).toBe(false);
  });
});
