import { describe, expect, it } from 'vitest';
import {
  MAX_PLUGIN_DATA_BYTES,
  MAX_PLUGIN_DATA_DEPTH,
  PLUGIN_ID_REGEX,
  UNDATED_KEY,
} from './constants';
import { pluginRecordCreateSchema, pluginRecordUpdateSchema } from './schemas';

/* The server never reads `data`, so these bounds are the only thing standing between an open
   collection and an unbounded one. They are also the only validation a plugin's rows ever get on
   the way in — which is why the cases below are about what must be *refused*. */

const create = (over: Record<string, unknown> = {}) =>
  pluginRecordCreateSchema.safeParse({ pluginId: 'habits', data: {}, ...over });

describe('pluginId', () => {
  it.each(['habits', 'h', 'habit-tracker', 'a1'])('accepts %s', (id) => {
    expect(create({ pluginId: id }).success).toBe(true);
  });

  it.each([
    ['Habits', 'uppercase'],
    ['1habits', 'leading digit'],
    ['habit.tracker', 'a dot — collides with the i18n key separator'],
    ['habit:tracker', 'a colon — collides with an i18next namespace'],
    ['habit_tracker', 'an underscore'],
    ['', 'empty'],
    ['a'.repeat(33), 'longer than the regex allows'],
  ])('rejects %s (%s)', (id) => {
    expect(create({ pluginId: id }).success).toBe(false);
    expect(PLUGIN_ID_REGEX.test(id)).toBe(false);
  });
});

describe('dateKey', () => {
  it('accepts a real date or the undated sentinel', () => {
    expect(create({ dateKey: '2026-08-10' }).success).toBe(true);
    expect(create({ dateKey: UNDATED_KEY }).success).toBe(true);
  });

  it('defaults to undated', () => {
    const parsed = create();
    expect(parsed.success && parsed.data.dateKey).toBe(UNDATED_KEY);
  });

  it('rejects null, which IndexedDB cannot index', () => {
    // The whole reason UNDATED_KEY is '' — a null here drops the row out of the
    // [pluginId+dateKey] compound index silently. Refusing it at the edge keeps it impossible.
    expect(create({ dateKey: null }).success).toBe(false);
  });

  it.each(['2026-8-10', '10-08-2026', 'today'])('rejects malformed %s', (dateKey) => {
    expect(create({ dateKey }).success).toBe(false);
  });
});

describe('scope', () => {
  it('defaults to record', () => {
    const parsed = create();
    expect(parsed.success && parsed.data.scope).toBe('record');
  });

  it('rejects an unknown scope', () => {
    expect(create({ scope: 'settings' }).success).toBe(false);
  });

  it('cannot be changed by an update', () => {
    // scope and pluginId are identity: a row that could re-scope itself would let one plugin's
    // write land in another plugin's query.
    const parsed = pluginRecordUpdateSchema.safeParse({ scope: 'config', pluginId: 'other' });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({});
  });
});

describe('data bounds', () => {
  it('accepts flat JSON values', () => {
    expect(create({ data: { done: true, count: 3, note: 'ok', cleared: null } }).success).toBe(
      true,
    );
  });

  it('accepts nesting up to the limit', () => {
    expect(create({ data: { a: { b: 1 } } }).success).toBe(true);
    expect(create({ data: { a: [1, 2, 3] } }).success).toBe(true);
  });

  it('rejects nesting past the limit', () => {
    // depth 0 is the record itself; each level of object/array costs one.
    let deep: unknown = 'leaf';
    for (let i = 0; i <= MAX_PLUGIN_DATA_DEPTH + 1; i++) deep = { nested: deep };
    expect(create({ data: deep as Record<string, unknown> }).success).toBe(false);
  });

  it('rejects a payload over the serialized size cap', () => {
    const big = { note: 'x'.repeat(MAX_PLUGIN_DATA_BYTES) };
    expect(JSON.stringify(big).length).toBeGreaterThan(MAX_PLUGIN_DATA_BYTES);
    expect(create({ data: big }).success).toBe(false);
  });

  it('accepts a payload just under the cap', () => {
    const snug = { note: 'x'.repeat(MAX_PLUGIN_DATA_BYTES - 20) };
    expect(JSON.stringify(snug).length).toBeLessThanOrEqual(MAX_PLUGIN_DATA_BYTES);
    expect(create({ data: snug }).success).toBe(true);
  });

  it('rejects top-level keys that would poison a $set path', () => {
    expect(create({ data: { $inc: 1 } }).success).toBe(false);
    expect(create({ data: { 'a.b': 1 } }).success).toBe(false);
  });

  it('allows those characters below the top level, where no path is built from them', () => {
    expect(create({ data: { safe: { 'a.b': 1 } } }).success).toBe(true);
  });

  it('rejects non-finite numbers', () => {
    // They survive Mongo but not JSON, so the plugin would read back a null it never wrote.
    expect(create({ data: { n: Number.NaN } }).success).toBe(false);
    expect(create({ data: { n: Number.POSITIVE_INFINITY } }).success).toBe(false);
  });
});
