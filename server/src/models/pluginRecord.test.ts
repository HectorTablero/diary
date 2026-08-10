import { UNDATED_KEY } from '@diary/shared';
import { describe, expect, it } from 'vitest';
import { PluginRecord } from './pluginRecord';

/*
 * The schema's own validators, run in process — `validateSync` needs no connection.
 *
 * Worth having because the route tests replace this model with a double, so nothing else in the
 * suite ever runs a Mongoose validator. That gap hid a real 500: `required: true` on a String means
 * "present and non-empty", so it rejected `''` as missing — and `''` is precisely the sentinel an
 * undated row carries. Dated rows saved, habit definitions and plugin config rows did not, and the
 * only signal was a stack trace in the server log.
 */

const record = (patch: Record<string, unknown> = {}) =>
  new PluginRecord({
    userId: 'u1',
    pluginId: 'habits',
    scope: 'record',
    dateKey: '2026-08-10',
    data: { water: true },
    ...patch,
  });

describe('dateKey', () => {
  it('accepts a real date', () => {
    expect(record().validateSync()).toBeUndefined();
  });

  it('accepts the undated sentinel, which is the empty string', () => {
    // The regression. A habit definition and a plugin's config row both look like this.
    expect(record({ dateKey: UNDATED_KEY }).validateSync()).toBeUndefined();
  });

  it('defaults to the sentinel when omitted', () => {
    const doc = record({ dateKey: undefined });

    expect(doc.dateKey).toBe(UNDATED_KEY);
    expect(doc.validateSync()).toBeUndefined();
  });
});

describe('the rest of the shape', () => {
  it('requires an owner and a plugin', () => {
    expect(record({ userId: undefined }).validateSync()?.errors.userId).toBeDefined();
    expect(record({ pluginId: undefined }).validateSync()?.errors.pluginId).toBeDefined();
  });

  it('accepts both scopes and refuses anything else', () => {
    expect(record({ scope: 'config' }).validateSync()).toBeUndefined();
    expect(record({ scope: 'settings' }).validateSync()?.errors.scope).toBeDefined();
  });

  it('defaults scope to a data row', () => {
    expect(record({ scope: undefined }).scope).toBe('record');
  });

  it('accepts an empty payload', () => {
    // A plugin storing `{}` is storing something — "this day exists, nothing ticked" — and Mixed
    // must not treat it as absent the way the String path treated ''.
    expect(record({ data: {} }).validateSync()).toBeUndefined();
  });
});
