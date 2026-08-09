import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from './auth';
import type { AppEnv } from './middleware/session';

/* app.ts itself: the order things are mounted in, and the answers given by paths that never reach
 * a router at all.
 *
 * Every routed handler now has its own file, so the routers here are stand-ins — that is the point.
 * What this file covers is the wiring around them, which is where a mistake is both invisible and
 * total: an API path that falls through to the SPA answers 200 with HTML to a client expecting
 * JSON, an auth gate mounted after a router leaves the whole API open, and a traversal guard placed
 * after `serveStatic` guards nothing.
 */

const live = vi.hoisted(() => ({
  notifyUserChanged: vi.fn(),
  addLiveClient: vi.fn(),
  removeLiveClient: vi.fn(),
  redeemWsTicket: vi.fn(() => null as string | null),
}));
vi.mock('./services/liveSync', () => live);

const assetLinks = vi.hoisted(() => ({
  buildAssetLinks: vi.fn(() => ({ statements: [] as unknown[], malformed: [] as string[] })),
}));
vi.mock('./lib/assetLinks', () => assetLinks);

/* Stand-ins for the eight routers. Each answers just enough to prove it was reached, and between
   them they keep this file from needing every model in the codebase mocked as well. */
vi.mock('./routes/entries', async () => {
  const { Hono: H } = await import('hono');
  return {
    entriesRouter: new H<AppEnv>()
      .post('/', (c) => c.json({ reached: 'entries', userId: c.get('userId') }, 201))
      .get('/', (c) => c.json({ reached: 'entries-read' })),
  };
});
vi.mock('./routes/people', async () => {
  const { Hono: H } = await import('hono');
  return { peopleRouter: new H<AppEnv>().post('/', (c) => c.json({ reached: 'people' })) };
});
vi.mock('./routes/tags', async () => {
  const { Hono: H } = await import('hono');
  return {
    tagsRouter: new H<AppEnv>()
      .post('/', (c) => c.json({ reached: 'tags' }))
      .post('/boom', () => {
        throw new Error('kaboom');
      }),
  };
});
vi.mock('./routes/threads', async () => {
  const { Hono: H } = await import('hono');
  return { threadsRouter: new H<AppEnv>().post('/', (c) => c.json({ reached: 'threads' })) };
});
vi.mock('./routes/settings', async () => {
  const { Hono: H } = await import('hono');
  return { settingsRouter: new H<AppEnv>().put('/', (c) => c.json({ reached: 'settings' })) };
});
vi.mock('./routes/sync', async () => {
  const { Hono: H } = await import('hono');
  return { syncRouter: new H<AppEnv>().get('/', (c) => c.json({ reached: 'sync' })) };
});
vi.mock('./routes/account', async () => {
  const { Hono: H } = await import('hono');
  return { accountRouter: new H<AppEnv>().delete('/', (c) => c.body(null, 204)) };
});
vi.mock('./routes/ai', async () => {
  const { Hono: H } = await import('hono');
  return { aiRouter: new H<AppEnv>().post('/suggestions', (c) => c.json({ reached: 'ai' })) };
});

const { buildApp } = await import('./app');

/* Both halves of what requireAuth reads. `session.createdAt` is when the user last signed in, and
   DELETE /account refuses one that is not recent — so a stub carrying only the user would 500 the
   gate rather than pass it, and every assertion in this file would be about that instead. */
const SESSION = { user: { id: 'user_app_test' }, session: { createdAt: new Date() } };
const session = vi.hoisted(() => ({ value: null as typeof SESSION | null }));

/** Enough of Better Auth for the gate and the passthrough route. */
const auth = {
  api: { getSession: async () => session.value },
  handler: async () => new Response(JSON.stringify({ handled: true }), { status: 200 }),
} as unknown as Auth;

const app = buildApp(new Hono<AppEnv>(), auth);

/* The deployed origin, from config's default. Every mutation below sends it, because
   requireTrustedOrigin sits in front of the whole API — without it these would all be 403 and this
   file would be re-testing origin.test.ts by accident. */
const ORIGIN = 'http://localhost:5173';
const mutate = (path: string, method = 'POST') =>
  app.request(path, { method, headers: { Origin: ORIGIN } });

beforeEach(() => {
  session.value = SESSION;
  live.notifyUserChanged.mockClear();
  assetLinks.buildAssetLinks.mockReturnValue({ statements: [], malformed: [] });
});

describe('the API surface', () => {
  it('answers the health check without a session', async () => {
    session.value = null;

    const res = await app.request('/api/health');

    // Mounted ahead of the auth gate on purpose: it is what the client's reconnect probe polls
    // while it cannot authenticate, which is precisely when it needs an answer.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('refuses every API route without a session', async () => {
    session.value = null;

    const res = await mutate('/api/tags');

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'errors.unauthorized' });
  });

  it('hands the routers the id from the verified session', async () => {
    const res = await mutate('/api/entries');

    expect(res.status).toBe(201);
    // The only place a user id enters the API. Nothing downstream accepts one from the caller.
    expect(await res.json()).toMatchObject({ userId: 'user_app_test' });
  });

  it('answers an unknown API path as JSON, never as the SPA', async () => {
    const res = await app.request('/api/nope');

    /* The single most confusing failure this file prevents. Falling through to `serveStatic` would
       answer 200 with index.html — so a client doing `res.json()` gets a parse error about `<`,
       and a typo'd endpoint looks like a corrupt response rather than a missing route. */
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'errors.not_found' });
  });

  it('routes the auth handler itself, ahead of the API gate', async () => {
    session.value = null;

    const res = await app.request('/api/auth/get-session');

    // Signing in cannot require being signed in.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handled: true });
  });

  it('turns an unexpected error into a 500 with the shared body shape', async () => {
    const res = await mutate('/api/tags/boom');

    expect(res.status).toBe(500);
    // Every failure in this API is `{ error: <i18n key> }`; the client's ApiError parses nothing else.
    expect(await res.json()).toEqual({ error: 'errors.unknown' });
  });
});

describe('the live-sync nudge', () => {
  it('fires after a successful mutation, carrying the originating client', async () => {
    const res = await app.request('/api/tags', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'X-Client-Id': 'client_abc' },
    });

    expect(res.status).toBe(200);
    /* The client that made the change is excluded — it already applied it locally, and telling it
       to pull would be a round trip to learn what it just did. */
    expect(live.notifyUserChanged).toHaveBeenCalledWith('user_app_test', 'client_abc');
  });

  it('does not fire for a read', async () => {
    await app.request('/api/sync', { headers: { Origin: ORIGIN } });

    // A pull changes nothing, so waking every other device would be pure noise — and GET /sync is
    // the single most frequent request in the system.
    expect(live.notifyUserChanged).not.toHaveBeenCalled();
  });

  it('does not fire for a mutation that failed', async () => {
    const res = await mutate('/api/tags/boom');

    expect(res.status).toBe(500);
    // Nothing changed, so there is nothing for the other devices to come and fetch.
    expect(live.notifyUserChanged).not.toHaveBeenCalled();
  });

  it('does not fire for a request the auth gate refused', async () => {
    session.value = null;

    await mutate('/api/tags');

    expect(live.notifyUserChanged).not.toHaveBeenCalled();
  });
});

describe('the static path guard', () => {
  it('refuses a backslash in the path outright', async () => {
    const res = await app.request('/%5C..%5Cetc%5Cpasswd');

    /* GHSA-frvp-7c67-39w9: on Windows an encoded backslash was treated as a separator, so this
       escaped the static root. Fixed upstream, and this stays as defence in depth — no legitimate
       URL in this app contains a backslash in any form. */
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Bad Request');
  });

  it('leaves the API’s own 404 answering in JSON', async () => {
    const res = await app.request('/api/nope%5C..');

    // The guard is mounted *after* the API's catch-all, so an API path still gets an API answer.
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'errors.not_found' });
  });
});

describe('/.well-known/assetlinks.json', () => {
  it('404s when no fingerprints are configured', async () => {
    const res = await app.request('/.well-known/assetlinks.json');

    /* Not an empty `[]`. That is a valid document which positively asserts that *no* app may handle
       these links — worse than saying nothing, because Android would believe it. */
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'errors.not_found' });
  });

  it('serves the statements as JSON when there are some', async () => {
    assetLinks.buildAssetLinks.mockReturnValue({
      statements: [{ relation: ['delegate_permission/common.handle_all_urls'] }],
      malformed: [],
    });

    const res = await app.request('/.well-known/assetlinks.json');

    expect(res.status).toBe(200);
    // Android rejects the statement file unless it is served as application/json.
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toContain('max-age=3600');
  });
});

describe('security headers', () => {
  it('sets a CSP and the sniffing guard on API responses too', async () => {
    const res = await app.request('/api/health');

    expect(res.headers.get('content-security-policy')).toBeTruthy();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('leaves HSTS off when the deployment is not on TLS', async () => {
    const res = await app.request('/api/health');

    // Meaningless over plain http, and the dev server is http on localhost.
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });
});
