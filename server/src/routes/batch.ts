import type { BatchOpResult, BatchResponse } from '@diary/shared';
import { batchRequestSchema } from '@diary/shared';
import { Hono } from 'hono';
import { vouchFor, type AppEnv } from '../middleware/session';
import { jsonValidator } from '../middleware/validate';

/**
 * Hands one request to the whole app, from the top — the same `fetch` the HTTP server calls.
 *
 * A function rather than the app itself so this file does not import app.ts (which mounts it).
 */
export type Dispatch = (request: Request, env: unknown) => Response | Promise<Response>;

/* Headers that describe the batch's own body, and would lie about each op's. Everything else —
   X-Client-Id above all, which the live-sync nudge and the telemetry read — is carried over
   untouched, because it is exactly what the client would have sent with the op on its own. */
const ENVELOPE_HEADERS = ['content-length', 'transfer-encoding', 'expect'];

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * POST /api/batch — several outbox ops in one round trip.
 *
 * Transport only. The one thing a batch must never be is a second way in, so it has no logic of its
 * own about any write: every op is rebuilt into an ordinary request and dispatched through the
 * *entire* app — body validation, the route, its error mapping, the telemetry and the live-sync
 * nudge — exactly as if the client had sent it by itself. A rule added to any of those later applies
 * to batched writes without anyone having to remember this file exists.
 *
 * The one thing checked once rather than per op is the caller: the origin guard and the session
 * lookup both ran on this envelope before it got here, and every op in it comes from the same
 * caller. Each op is vouched for with that identity (see `vouchFor`), so the routes still read the
 * user id from the context exactly where they always do — from a session, never from the request.
 *
 * Strictly sequential, in the order sent: the outbox is a log, and a later op routinely depends on
 * an earlier one (an entry posted after the tag it references). Every op is attempted and answered,
 * whatever came before it; what to do about a failure is the client's call, as it is for a lone
 * request.
 */
export const batchRouter = (dispatch: Dispatch) =>
  new Hono<AppEnv>().post('/', jsonValidator(batchRequestSchema), async (c) => {
    const { ops } = c.req.valid('json');
    const outer = c.req.raw;
    const headers = new Headers(outer.headers);
    for (const name of ENVELOPE_HEADERS) headers.delete(name);
    headers.set('Content-Type', 'application/json');

    const identity = { userId: c.get('userId'), sessionCreatedAt: c.get('sessionCreatedAt') };

    const results: BatchOpResult[] = [];
    for (const op of ops) {
      // The client gave up on the answer. It will replay whatever it did not see acknowledged, so
      // applying more now only adds to what has to be tolerated on the way back in.
      if (outer.signal.aborted) break;
      const request = new Request(new URL(`/api${op.path}`, outer.url), {
        method: op.method,
        headers,
        body: op.body === undefined ? undefined : JSON.stringify(op.body),
      });
      const res = await dispatch(vouchFor(request, identity), c.env);
      results.push({ status: res.status, body: await readBody(res) });
    }
    return c.json<BatchResponse>({ results });
  });
