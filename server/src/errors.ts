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
