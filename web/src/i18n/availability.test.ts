import { describe, expect, it } from 'vitest';
import { canFetchLocales } from './availability';

/**
 * The language picker greys out anything this device cannot switch to, and used to decide that from
 * `navigator.onLine` alone. These cover the gap that left: a network that reaches the router but
 * not the diary looks perfectly online, so a language whose strings could not possibly arrive was
 * still offered — and choosing it did nothing but raise a toast.
 */
describe('canFetchLocales', () => {
  it('allows downloads when the network and the server are both fine', () => {
    expect(canFetchLocales(true, null)).toBe(true);
  });

  it('refuses when the server is unreachable, even though the browser reports a network', () => {
    expect(canFetchLocales(true, 'unreachable')).toBe(false);
  });

  it('refuses when the device has no network', () => {
    expect(canFetchLocales(false, 'offline')).toBe(false);
  });

  /* The Wi-Fi-only preference holds writes back on purpose; nothing is broken and a static asset
     downloads normally. Greying languages out here would invent a failure. */
  it('allows downloads while sync is paused on a metered connection', () => {
    expect(canFetchLocales(true, 'paused')).toBe(true);
  });

  /* A signed-out or never-synced device sits on `null` forever. Its picker has to keep working. */
  it('follows the network alone when the sync engine has no opinion', () => {
    expect(canFetchLocales(true, null)).toBe(true);
    expect(canFetchLocales(false, null)).toBe(false);
  });
});
