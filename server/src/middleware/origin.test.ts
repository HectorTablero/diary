import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requireTrustedOrigin } from './origin';
import type { AppEnv } from './session';

/*
 * The server-side half of the CSRF defence.
 *
 * Worth its own tests because the thing it guards against leaves no trace when it works and is
 * catastrophic when it doesn't: one of the endpoints behind this erases a diary irreversibly. The
 * cases below are the four a hostile page could produce, plus the two legitimate callers that must
 * keep working — the deployed web origin and the Android webview, which is genuinely cross-site.
 */

const TRUSTED = ['https://diary.example.com', 'https://localhost', 'capacitor://localhost'];

const app = new Hono<AppEnv>()
  .use(requireTrustedOrigin(TRUSTED))
  .get('/', (c) => c.text('read'))
  .delete('/', (c) => c.text('deleted'));

const request = (method: string, origin?: string) =>
  app.request('/', { method, headers: origin ? { Origin: origin } : {} });

describe('requireTrustedOrigin', () => {
  it('refuses a mutation from an origin that is not on the list', async () => {
    const res = await request('DELETE', 'https://evil.example');

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'errors.forbidden' });
  });

  it('is not fooled by an origin that merely starts with a trusted one', async () => {
    // https://diary.example.com.evil.example — a prefix match would wave this through.
    const res = await request('DELETE', 'https://diary.example.com.evil.example');

    expect(res.status).toBe(403);
  });

  it('is not fooled by a trusted host on the wrong scheme', async () => {
    const res = await request('DELETE', 'http://diary.example.com');

    expect(res.status).toBe(403);
  });

  it('allows the deployed web origin', async () => {
    const res = await request('DELETE', 'https://diary.example.com');

    expect(res.status).toBe(200);
  });

  it('allows the native webview, which is legitimately cross-site', async () => {
    for (const origin of ['https://localhost', 'capacitor://localhost']) {
      expect((await request('DELETE', origin)).status).toBe(200);
    }
  });

  it('allows a mutation with no Origin at all', async () => {
    /* Not an oversight. Browsers send Origin on every non-GET, so its absence means the caller is
       not a browser — and a non-browser caller has no ambient cookie jar for an attacker's page to
       borrow, which is the only thing CSRF can exploit. Rejecting here would break curl and native
       HTTP clients to prevent nothing. */
    const res = await request('DELETE');

    expect(res.status).toBe(200);
  });

  it('leaves reads alone whatever their origin', async () => {
    // A GET changes nothing, and the CORS layer already stops the response being read cross-origin.
    const res = await request('GET', 'https://evil.example');

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('read');
  });
});
