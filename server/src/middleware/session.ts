import type { MiddlewareHandler } from 'hono';
import type { Auth } from '../auth';

export interface AppEnv {
  Variables: {
    userId: string;
    /**
     * When this session row was inserted — which is to say, when the user last signed in.
     *
     * The only thing in a request that says anything about *how recently* the caller proved who
     * they are, and the whole basis of the re-authentication gate on DELETE /account. Better Auth
     * writes it once in `createSession` and never touches it again: sliding the expiry on an active
     * session moves `expiresAt` and `updatedAt`, so neither of those says anything about
     * credentials, while this stays pinned to the sign-in that produced the session. Every sign-in
     * inserts a new row rather than refreshing an old one — the browser's OAuth callback and the
     * Android app's idToken post both land in the same `createSession` — so re-authenticating
     * really does reset this clock, on both platforms and without either having to say so.
     */
    sessionCreatedAt: Date;
  };
}

/** Who a request is from, as requireAuth establishes it. */
export interface Identity {
  userId: string;
  sessionCreatedAt: Date;
}

/**
 * Requests whose caller has already been checked, and who that caller is.
 *
 * Only POST /api/batch writes here: each op it replays is a request it built itself, on behalf of an
 * envelope that has just passed the origin guard and the session lookup. Every op in a batch comes
 * from that same caller, so asking the database again per op would be the same question with the
 * same answer, hundreds of times over.
 *
 * Keyed by the Request *object*, which is what makes it unforgeable. Nothing arriving over the wire
 * can be one of these objects — the HTTP server makes a fresh Request for every connection — so no
 * header, path or body can talk its way into this map. A WeakMap so an entry lives exactly as long
 * as the request it vouches for.
 */
const vouched = new WeakMap<Request, Identity>();

export const vouchFor = (request: Request, identity: Identity): Request => {
  vouched.set(request, identity);
  return request;
};

/** True for a request built by the batch endpoint after its envelope passed every caller check. */
export const isVouchedFor = (request: Request): boolean => vouched.has(request);

export const requireAuth =
  (auth: Auth): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const known = vouched.get(c.req.raw);
    if (known) {
      c.set('userId', known.userId);
      c.set('sessionCreatedAt', known.sessionCreatedAt);
      return next();
    }
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'errors.unauthorized' }, 401);
    c.set('userId', session.user.id);
    /* Coerced rather than trusted. The adapter hands back a Date, but that is a property of which
       adapter happens to be configured, and a string slipping through would make the comparison
       downstream NaN — which compares false, and would wave every stale session straight through
       the one gate that exists to stop them. */
    c.set('sessionCreatedAt', new Date(session.session.createdAt));
    await next();
  };
