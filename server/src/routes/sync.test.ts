import { TOMBSTONE_RETENTION_MS, DEFAULT_SETTINGS } from '@diary/shared';
import type { SyncResponse } from '@diary/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modelDouble, objectId, query, resetModels } from '../test/mongooseDouble';
import { routeApp, USER_ID } from '../test/routeApp';

/* The pull endpoint: the one route every client depends on and the only one that can lose data by
 * answering *successfully*.
 *
 * A delta names what changed since a cursor, and anything it omits is unchanged. A reset carries
 * the whole collection, and the ids it omits are the deletions — because a reset has no tombstones
 * left to send. Choosing the wrong one is silent in both directions: a delta where a reset was
 * needed leaves deleted documents on the device forever, and it looks perfectly healthy from
 * either end.
 *
 * So the decision itself is what this file pins. `isCursorStale` is imported from the real module
 * rather than mocked — it is the arithmetic under test, and a stubbed one would leave this
 * asserting that a boolean it supplied came back.
 */

const Entry = modelDouble();
const Person = modelDouble();
const Tag = modelDouble();
const Thread = modelDouble();
const Deletion = modelDouble();

const settings = vi.hoisted(() => ({ getSettings: vi.fn(), getProviderKeys: vi.fn() }));
const live = vi.hoisted(() => ({ issueWsTicket: vi.fn(() => 'ticket-123') }));
const telemetry = vi.hoisted(() => ({
  events: [] as { name: string; fields: Record<string, unknown> }[],
}));

vi.mock('../models/entry', () => ({ Entry }));
vi.mock('../models/person', () => ({ Person }));
vi.mock('../models/tag', () => ({ Tag }));
vi.mock('../models/thread', () => ({ Thread }));
/* Only the model is replaced; `isCursorStale` stays real. It is the thing being tested, and it is
   pure arithmetic over two dates — there is nothing about it that needs a database. */
vi.mock('../models/deletion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../models/deletion')>()),
  Deletion,
}));
vi.mock('../services/settingsService', () => settings);
vi.mock('../services/liveSync', () => live);
vi.mock('../lib/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/telemetry')>()),
  trackEvent: (name: string, fields: Record<string, unknown> = {}) =>
    telemetry.events.push({ name, fields }),
}));

const { syncRouter } = await import('./sync');

const app = routeApp('/sync', syncRouter);

const NOW = new Date('2026-08-09T12:00:00.000Z');

const pull = async (search = '') => {
  const res = await app.request(`/sync${search}`);
  return { res, body: (await res.json()) as SyncResponse };
};

const event = (name: string) => telemetry.events.find((e) => e.name === name);

beforeEach(() => {
  resetModels(Entry, Person, Tag, Thread, Deletion);
  telemetry.events = [];
  settings.getSettings.mockReset();
  settings.getSettings.mockResolvedValue(DEFAULT_SETTINGS);
  live.issueWsTicket.mockClear();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

describe('GET /sync — choosing a delta or a reset', () => {
  it('answers a first pull, with no cursor at all, as a reset', async () => {
    const { body } = await pull();

    /* A client with no cursor has nothing local to reconcile against, so a reset costs nothing and
       leaves it with one reconciliation path instead of two. */
    expect(body.reset).toBe(true);
    // Every collection is asked for in full — no `updatedAt` filter anywhere.
    expect(Entry.find).toHaveBeenCalledWith({ userId: USER_ID });
  });

  it('answers a fresh cursor as a delta, filtered on updatedAt', async () => {
    const since = new Date(NOW.getTime() - 60_000).toISOString();

    const { body } = await pull(`?since=${encodeURIComponent(since)}`);

    expect(body.reset).toBe(false);
    for (const model of [Entry, Person, Tag, Thread]) {
      expect(model.find).toHaveBeenCalledWith({
        userId: USER_ID,
        updatedAt: { $gt: new Date(since) },
      });
    }
  });

  it('answers a cursor older than tombstone retention as a reset', async () => {
    // One minute past the window: the tombstones this client needed have been pruned, so a delta
    // could not describe the deletions it missed.
    const stale = new Date(NOW.getTime() - TOMBSTONE_RETENTION_MS - 60_000).toISOString();

    const { body } = await pull(`?since=${encodeURIComponent(stale)}`);

    /* The failure this prevents is the quietest in the system: answering incrementally would look
       entirely healthy and leave deleted documents on that device forever. */
    expect(body.reset).toBe(true);
    expect(Entry.find).toHaveBeenCalledWith({ userId: USER_ID });
  });

  it('the server decides staleness, not the client', async () => {
    /* A device with a fast clock would conclude its own cursor is fine at exactly the moment it
       isn't. The cursor is a value the client sends; whether it is answerable is measured against
       the server's own clock, here and nowhere else. */
    const justInside = new Date(NOW.getTime() - TOMBSTONE_RETENTION_MS + 60_000).toISOString();

    const { body } = await pull(`?since=${encodeURIComponent(justInside)}`);

    expect(body.reset).toBe(false);
  });

  it('refuses a cursor that is not a timestamp', async () => {
    const { res } = await pull('?since=yesterday');

    expect(res.status).toBe(400);
    expect(Entry.find).not.toHaveBeenCalled();
  });
});

describe('GET /sync — what comes back', () => {
  it('sends no tombstones with a reset, because the omissions are the deletions', async () => {
    const { body } = await pull();

    expect(body.deletions).toEqual([]);
    /* Not merely empty in the response — the query is never made. A reset that also carried
       tombstones would be describing the same deletions twice, in two contradictory ways. */
    expect(Deletion.find).not.toHaveBeenCalled();
  });

  it('sends the tombstones since the cursor with a delta', async () => {
    const since = new Date(NOW.getTime() - 60_000);
    const deletedAt = new Date(NOW.getTime() - 30_000);
    Deletion.find.mockReturnValue(query([{ coll: 'entry', docId: objectId('e1'), deletedAt }]));

    const { body } = await pull(`?since=${encodeURIComponent(since.toISOString())}`);

    expect(Deletion.find).toHaveBeenCalledWith({ userId: USER_ID, deletedAt: { $gt: since } });
    expect(body.deletions).toEqual([
      { coll: 'entry', docId: objectId('e1').toString(), deletedAt: deletedAt.toISOString() },
    ]);
  });

  it('captures serverTime before the queries run, so a mid-request write is re-sent next pull', async () => {
    const { body } = await pull();

    /* Taken up front on purpose. A timestamp read *after* the queries would sit later than a write
       that landed while they were running, and the next cursor would skip straight past it — a
       single lost entry, with nothing anywhere to show for it. */
    expect(body.serverTime).toBe(NOW.toISOString());
  });

  it('scopes every collection to the caller', async () => {
    await pull();

    // The only authorisation model in this endpoint: no id is accepted from the caller at all, and
    // the session's user is in all six filters.
    for (const model of [Entry, Person, Tag, Thread]) {
      expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }));
    }
    expect(settings.getSettings).toHaveBeenCalledWith(USER_ID);
  });

  it('carries the settings, which have no changed-since filter of their own', async () => {
    settings.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, quietNotifications: false });

    const { body } = await pull(
      `?since=${encodeURIComponent(new Date(NOW.getTime() - 60_000).toISOString())}`,
    );

    // A singleton the server cannot filter by cursor, so it rides along on every pull — which is
    // how a preference changed on a laptop reaches the phone promptly.
    expect(body.settings).toMatchObject({ quietNotifications: false });
  });
});

/* The endpoint's cost is not proportional to what the caller asked for — a reset is the user's
   whole diary, populated, chosen by the server rather than requested. So it reports itself. */
describe('GET /sync — what it reports', () => {
  it('reports a reset with the cursor age that caused it', async () => {
    const stale = new Date(NOW.getTime() - TOMBSTONE_RETENTION_MS - 86_400_000);

    await pull(`?since=${encodeURIComponent(stale.toISOString())}`);

    const reported = event('sync_reset_served');
    expect(reported).toBeDefined();
    expect(reported!.fields).toMatchObject({ first_sync: false });
    // The number that decides whether tombstone retention is actually being outrun.
    expect(reported!.fields.cursor_age_ms).toBe(NOW.getTime() - stale.getTime());
  });

  it('marks a first sync as such, and gives it no cursor age', async () => {
    await pull();

    const reported = event('sync_reset_served');
    expect(reported!.fields).toMatchObject({ first_sync: true });
    /* Absent rather than zero: a first sync is the cheap, expected case, and it is the one to
       exclude when asking how often retention is being outrun. A `0` would sit in the same column
       as a real age and drag every average down. */
    expect(reported!.fields.cursor_age_ms).toBeUndefined();
  });

  it('says nothing about an ordinary delta', async () => {
    await pull(`?since=${encodeURIComponent(new Date(NOW.getTime() - 60_000).toISOString())}`);

    // A kick fires on every mutation, foreground and reconnect plus a sixty-second timer, so an
    // event per healthy pull would be thousands of identical rows a day per device.
    expect(event('sync_reset_served')).toBeUndefined();
    expect(event('sync_delta_slow')).toBeUndefined();
  });

  it('never puts the user id in an event', async () => {
    await pull();

    /* `userHash` exists so incidents can be grouped by device without the account being
       identifiable from the telemetry stream. A raw id here would undo that for the single
       highest-volume event the server emits. */
    expect(JSON.stringify(telemetry.events)).not.toContain(USER_ID);
  });
});

describe('GET /sync/ws-ticket', () => {
  it('issues a single-use ticket for the caller', async () => {
    const res = await app.request('/sync/ws-ticket');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ticket: 'ticket-123' });
    expect(live.issueWsTicket).toHaveBeenCalledWith(USER_ID);
  });

  it('is a GET, so the mutation broadcast never fires for it', async () => {
    /* Deliberate, and load-bearing: app.ts nudges every other device after any successful non-GET.
       A POST here would make merely *opening* a socket wake up every other device the user owns,
       every time — which is the opposite of what the live channel is for. */
    const res = await app.request('/sync/ws-ticket', { method: 'POST' });

    expect(res.status).toBe(404);
  });
});
