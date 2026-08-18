import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modelDouble, resetModels } from '../test/mongooseDouble';
import { routeApp, USER_ID } from '../test/routeApp';

/* Erasing an account, which is the one endpoint here that destroys data nobody can get back.
 *
 * Two properties matter more than the status code, and neither is visible in a response:
 *
 *   - **Order.** Diary content goes first, credentials second. A failure halfway then leaves an
 *     account that still exists and a request that can simply be retried. Reversed, a failure could
 *     strand documents behind an account that no longer exists to reach or delete them — and
 *     nothing is atomic here, because MongoDB transactions need a replica set that a self-hosted
 *     single node isn't.
 *   - **Scope.** `userId` comes from the verified session and appears in every filter. There is no
 *     id in the path or the body, so the test worth writing is that no filter is ever unscoped —
 *     an unfiltered `deleteMany({})` would erase the whole deployment and answer 204.
 *
 * A third is visible only in a status code, and is the one guard here that a refactor could delete
 * without breaking anything else: the caller has to have signed in recently. Everything else
 * standing between a tap and an erased diary — the typed word, the device lock — lives in the
 * client and is invisible from here, so this is the whole of what the server itself insists on.
 */

const Entry = modelDouble();
const Person = modelDouble();
const Tag = modelDouble();
const Thread = modelDouble();
const PluginRecord = modelDouble();
const PluginDocument = modelDouble();
const UserSettings = modelDouble();
const Deletion = modelDouble();

/** Every collection touched, in the order it was touched — including the Better Auth ones, which
    are reached through the raw driver rather than through a model. */
const calls = vi.hoisted(() => ({ order: [] as string[] }));

const authCollection = (name: string) => ({
  deleteMany: vi.fn(async (filter: unknown) => {
    calls.order.push(`auth:${name}`);
    authFilters.set(name, filter);
    return { deletedCount: 0 };
  }),
});
const authFilters = new Map<string, unknown>();
const authCollections = new Map<string, ReturnType<typeof authCollection>>();

vi.mock('mongoose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongoose')>();
  return {
    ...actual,
    // `Types` stays real — the route builds an ObjectId out of the user id to match both shapes.
    default: {
      ...actual.default,
      connection: {
        getClient: () => ({
          db: () => ({
            collection: (name: string) => {
              const existing = authCollections.get(name);
              if (existing) return existing;
              const created = authCollection(name);
              authCollections.set(name, created);
              return created;
            },
          }),
        }),
      },
    },
  };
});

vi.mock('../models/entry', () => ({ Entry }));
vi.mock('../models/person', () => ({ Person }));
vi.mock('../models/tag', () => ({ Tag }));
vi.mock('../models/thread', () => ({ Thread }));
vi.mock('../models/pluginRecord', () => ({ PluginRecord }));
vi.mock('../models/pluginDocument', () => ({ PluginDocument }));
vi.mock('../models/userSettings', () => ({ UserSettings }));
vi.mock('../models/deletion', () => ({ Deletion }));

const { accountRouter } = await import('./account');

const app = routeApp('/account', accountRouter);

const CONTENT_MODELS = { Entry, Person, Tag, Thread, PluginRecord, UserSettings, Deletion };

beforeEach(() => {
  resetModels(...Object.values(CONTENT_MODELS));
  calls.order = [];
  authFilters.clear();
  authCollections.clear();
  for (const [name, model] of Object.entries(CONTENT_MODELS)) {
    model.deleteMany.mockImplementation(async () => {
      calls.order.push(`content:${name}`);
      return { deletedCount: 0 };
    });
  }
});

/* An id that is a valid ObjectId, which is what Better Auth's adapter actually stores. The route
   deliberately matches both that and the plain string. */
const OID_USER = '507f1f77bcf86cd799439011';

describe('DELETE /account', () => {
  it('answers 204 with no body', async () => {
    const res = await app.request('/account', { method: 'DELETE' });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('erases every collection the diary lives in, scoped to the caller', async () => {
    await app.request('/account', { method: 'DELETE' });

    for (const model of Object.values(CONTENT_MODELS)) {
      /* The whole authorisation model, asserted once per collection. An unscoped `deleteMany({})`
         here would erase every user's diary on the deployment and still answer 204. */
      expect(model.deleteMany).toHaveBeenCalledWith({ userId: USER_ID });
    }
  });

  it('takes the tombstones too', async () => {
    await app.request('/account', { method: 'DELETE' });

    /* They describe documents that no longer exist, for an account that is about to stop existing,
       and nothing will ever pull them — the sync endpoint is the only channel they travel on and
       it needs a session this account will not have. */
    expect(Deletion.deleteMany).toHaveBeenCalledWith({ userId: USER_ID });
  });

  it('deletes the diary before the credentials', async () => {
    await app.request('/account', { method: 'DELETE' });

    const firstAuth = calls.order.findIndex((entry) => entry.startsWith('auth:'));
    // Not `findLastIndex`, which needs a newer lib than this workspace targets.
    const lastContent = calls.order.reduce(
      (last, entry, index) => (entry.startsWith('content:') ? index : last),
      -1,
    );
    /* If the content half fails, the account is still there and the request can be retried.
       Reversed, a failure would strand documents nothing can ever reach again. */
    expect(firstAuth).toBeGreaterThanOrEqual(0);
    expect(lastContent).toBeLessThan(firstAuth);
  });

  it('deletes sessions before the user record', async () => {
    await app.request('/account', { method: 'DELETE' });

    const session = calls.order.indexOf('auth:session');
    const user = calls.order.indexOf('auth:user');
    // So a request racing this one cannot be authorised by a session whose user has already gone.
    expect(session).toBeGreaterThanOrEqual(0);
    expect(session).toBeLessThan(user);
  });

  it('matches the auth records by both the ObjectId and the string form of the id', async () => {
    const objectIdApp = routeApp('/account', accountRouter, OID_USER);

    await objectIdApp.request('/account', { method: 'DELETE' });

    /* Which shape the adapter stores is an implementation detail of a dependency, and the cost of
       guessing wrong is asymmetric: a `session` row that outlives its user is a live credential
       nobody meant to leave behind. Matching both costs one extra index probe and cannot miss. */
    const sessionFilter = authFilters.get('session') as { userId: { $in: unknown[] } };
    expect(sessionFilter.userId.$in).toHaveLength(2);
    expect(sessionFilter.userId.$in.map(String)).toEqual([OID_USER, OID_USER]);
  });

  it('falls back to a plain string match for an id that is not ObjectId-shaped', async () => {
    await app.request('/account', { method: 'DELETE' });

    // USER_ID is not 24 hex characters, so there is no ObjectId form to also match.
    expect(authFilters.get('session')).toEqual({ userId: USER_ID });
  });

  it('erases the account collection as well as the user', async () => {
    await app.request('/account', { method: 'DELETE' });

    /* `account` holds the OAuth link. Leaving it behind would let the next Google sign-in with the
       same address adopt the deleted user's id. */
    expect(authCollections.has('account')).toBe(true);
    expect(authCollections.has('user')).toBe(true);
  });

  /* The re-authentication gate. Everything else standing between a tap and an erased diary lives
     in the client, where this endpoint cannot see it and a caller with a session token is not
     obliged to visit it. This is the whole of what the server itself insists on. */
  describe('when the session is not a fresh one', () => {
    /** Comfortably past the five-minute window, and not so far past that the test is about a date. */
    const staleApp = routeApp(
      '/account',
      accountRouter,
      USER_ID,
      new Date(Date.now() - 60 * 60 * 1000),
    );

    it('refuses with a code the client can act on', async () => {
      const res = await staleApp.request('/account', { method: 'DELETE' });

      expect(res.status).toBe(403);
      /* Not 401: the session is perfectly valid and the client must not tear it down. The distinct
         code is what tells the two clients to send the user through Google and try again, rather
         than to the login screen. */
      expect(await res.json()).toEqual({ error: 'errors.reauth_required' });
    });

    it('deletes nothing at all', async () => {
      await staleApp.request('/account', { method: 'DELETE' });

      /* The refusal has to be free. A gate that erased the diary and *then* objected, or that got
         halfway, would be worse than no gate — and the client's retry-after-signing-in only works
         because a refused attempt costs nothing. */
      for (const model of Object.values(CONTENT_MODELS)) {
        expect(model.deleteMany).not.toHaveBeenCalled();
      }
      expect(authCollections.size).toBe(0);
    });

    it('goes through once the user has signed in again', async () => {
      // A new sign-in inserts a new session, so re-authenticating is visible here as nothing more
      // exotic than a recent createdAt — which is what makes one rule cover web and Android alike.
      const freshApp = routeApp('/account', accountRouter, USER_ID, new Date());

      const res = await freshApp.request('/account', { method: 'DELETE' });

      expect(res.status).toBe(204);
      expect(Entry.deleteMany).toHaveBeenCalledWith({ userId: USER_ID });
    });
  });

  it('takes no input at all, so there is nothing to tamper with', async () => {
    // A body naming another user changes nothing: the route never reads one.
    const res = await app.request('/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'somebody_else' }),
    });

    expect(res.status).toBe(204);
    expect(Entry.deleteMany).toHaveBeenCalledWith({ userId: USER_ID });
  });
});
