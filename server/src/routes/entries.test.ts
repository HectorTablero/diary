import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notFound } from '../errors';
import { oid } from '../test/mongooseDouble';
import { postJson, routeApp, USER_ID } from '../test/routeApp';

/* The entries router is almost pure delegation: every handler hands the session's user id, a
 * validated body and a checked id to entryService and returns what comes back. So this file tests
 * the four things the router itself decides, and deliberately not the service behind it — the tree
 * arithmetic, the saidTo normalisation and the cascade all have their own tests, against the same
 * functions the client validates a drag with.
 *
 * What is genuinely the router's: the id guard, the status codes, that the *session's* user id is
 * the one passed down, and that the path parameters arrive in the right order — which matters more
 * than it looks, because `said` and `hidden` both take two ids of the same shape and swapping them
 * would mark the wrong person, silently and plausibly.
 */

const service = vi.hoisted(() => ({
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  setSaid: vi.fn(),
  setHidden: vi.fn(),
}));
vi.mock('../services/entryService', () => service);

const { entriesRouter } = await import('./entries');

const app = routeApp('/entries', entriesRouter);

const ENTRY_ID = oid('e1');
const PERSON_ID = oid('p1');
const DAY = '2026-08-01';

const anEntryDto = { id: ENTRY_ID, content: 'Bought milk', dateKey: DAY };

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
  service.createEntry.mockResolvedValue(anEntryDto);
  service.updateEntry.mockResolvedValue(anEntryDto);
  service.deleteEntry.mockResolvedValue(3);
  service.setSaid.mockResolvedValue(undefined);
  service.setHidden.mockResolvedValue(undefined);
});

describe('POST /entries', () => {
  it('creates an entry for the caller and answers 201', async () => {
    const res = await postJson(app, '/entries', { content: 'Bought milk', dateKey: DAY });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(anEntryDto);
    const [userId, input] = service.createEntry.mock.calls[0] as [string, { content: string }];
    // The id comes from the verified session and nowhere else — there is no user id in the body
    // or the path for a caller to tamper with.
    expect(userId).toBe(USER_ID);
    expect(input.content).toBe('Bought milk');
  });

  it('applies the schema defaults rather than passing an under-specified body through', async () => {
    await postJson(app, '/entries', { content: 'Bought milk', dateKey: DAY });

    const [, input] = service.createEntry.mock.calls[0] as [string, Record<string, unknown>];
    // Zod fills these in, so the service is never handed a half-formed entry — which is what lets
    // it treat `saidTo: undefined` as the meaningful "auto-said from the mentions" signal.
    expect(input).toMatchObject({
      importance: 3,
      tags: [],
      people: [],
      threads: [],
      parentId: null,
    });
    expect(input.saidTo).toBeUndefined();
  });

  it('refuses an entry with no content, before the service runs', async () => {
    const res = await postJson(app, '/entries', { content: '   ', dateKey: DAY });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'errors.validation' });
    expect(service.createEntry).not.toHaveBeenCalled();
  });

  it('refuses a dateKey that is not a date', async () => {
    const res = await postJson(app, '/entries', { content: 'Bought milk', dateKey: '01/08/2026' });

    expect(res.status).toBe(400);
    expect(service.createEntry).not.toHaveBeenCalled();
  });
});

describe('PATCH /entries/:id', () => {
  it('updates and answers 200 with the new DTO', async () => {
    const res = await postJson(
      app,
      `/entries/${ENTRY_ID}`,
      { content: 'Bought oat milk' },
      'PATCH',
    );

    expect(res.status).toBe(200);
    expect(service.updateEntry).toHaveBeenCalledWith(USER_ID, ENTRY_ID, expect.anything());
  });

  it('answers 404 for a malformed id without calling the service', async () => {
    const res = await postJson(app, '/entries/nope', { content: 'x' }, 'PATCH');

    /* The `oid()` guard. Without it a stale link puts a CastError through Mongoose, which is a 500
       and a reported incident for something that is only ever a typo. */
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'errors.not_found' });
    expect(service.updateEntry).not.toHaveBeenCalled();
  });

  it('lets a not-found from the service surface as a 404', async () => {
    service.updateEntry.mockRejectedValue(notFound('entry.not_found'));

    const res = await postJson(app, `/entries/${ENTRY_ID}`, { content: 'x' }, 'PATCH');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'entry.not_found' });
  });
});

describe('DELETE /entries/:id', () => {
  it('reports how many documents went, which is the whole subtree', async () => {
    const res = await app.request(`/entries/${ENTRY_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    // The count is the client's confirmation that its own optimistic subtree delete matched the
    // server's — a parent and its descendants go together or not at all.
    expect(await res.json()).toEqual({ deleted: 3 });
    expect(service.deleteEntry).toHaveBeenCalledWith(USER_ID, ENTRY_ID);
  });

  it('answers 404 for a malformed id', async () => {
    const res = await app.request('/entries/nope', { method: 'DELETE' });

    expect(res.status).toBe(404);
    expect(service.deleteEntry).not.toHaveBeenCalled();
  });
});

/* The four two-id routes. They are the outbox's own path shape — `entries/<id>/said/<person>` —
   which sync.ts parses positionally to protect unpushed edits, so both the order and the guard on
   *each* id matter here rather than on the first one only. */
describe('said and hidden marks', () => {
  const cases = [
    { method: 'PUT', segment: 'said', fn: service.setSaid, value: true },
    { method: 'DELETE', segment: 'said', fn: service.setSaid, value: false },
    { method: 'PUT', segment: 'hidden', fn: service.setHidden, value: true },
    { method: 'DELETE', segment: 'hidden', fn: service.setHidden, value: false },
  ] as const;

  for (const { method, segment, fn, value } of cases) {
    it(`${method} /:id/${segment}/:personId sets it to ${value}`, async () => {
      const res = await app.request(`/entries/${ENTRY_ID}/${segment}/${PERSON_ID}`, { method });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      /* Entry first, person second. Both are 24-hex ids, so a transposition type-checks, passes
         every schema, and quietly marks the wrong thing — there is no shape here to catch it. */
      expect(fn).toHaveBeenCalledWith(USER_ID, ENTRY_ID, PERSON_ID, value);
    });
  }

  it('guards the person id as well as the entry id', async () => {
    const res = await app.request(`/entries/${ENTRY_ID}/said/nope`, { method: 'PUT' });

    expect(res.status).toBe(404);
    expect(service.setSaid).not.toHaveBeenCalled();
  });
});
