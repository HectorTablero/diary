import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { captureError } from './lib/telemetry';

export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    /** i18n key sent to the client, e.g. "entry.not_found" */
    public code: string,
  ) {
    super(code);
    this.name = 'HttpError';
  }
}

export const notFound = (code: string) => new HttpError(404, code);
export const badRequest = (code: string) => new HttpError(400, code);
export const conflict = (code: string) => new HttpError(409, code);

/**
 * Mongo's duplicate-key error (11000), optionally narrowed to the index that raised it.
 *
 * The narrowing is what separates the two very different things a create can collide on: a
 * duplicate *name* is a real conflict the user has to resolve, while a duplicate *_id* means this
 * exact document already exists — a replayed create, which the caller should treat as success (see
 * the create routes). `keyPattern` names the offending index; if a driver ever omits it, the
 * narrowed form answers false and the caller falls back to the conservative conflict path.
 */
export const isDuplicateKey = (err: unknown, field?: string): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const { code, keyPattern } = err as { code?: number; keyPattern?: Record<string, unknown> };
  if (code !== 11000) return false;
  return field === undefined || (keyPattern !== undefined && field in keyPattern);
};

export function handleError(err: Error, c: Context) {
  // Expected, client-caused failures. They are part of the API contract, not incidents.
  if (err instanceof HttpError) {
    return c.json({ error: err.code }, err.status);
  }
  // Mongo duplicate key (unique indexes on tag/person names)
  if ('code' in err && (err as { code?: number }).code === 11000) {
    return c.json({ error: 'errors.duplicate' }, 409);
  }
  // Anything reaching here is a genuine server-side bug: report it.
  captureError(err, { method: c.req.method, route: c.req.routePath });
  return c.json({ error: 'errors.unknown' }, 500);
}
