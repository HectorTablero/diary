import { DEFAULT_SETTINGS } from '@diary/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modelDouble, objectId, oid, query, resetModels } from '../test/mongooseDouble';
import { postJson, routeApp, USER_ID } from '../test/routeApp';

/* One route, and two decisions inside it that are each worth more than the route.
 *
 * The first is ownership: `broadcastTagIds` is a list of ids that arrives straight from the client,
 * and it is the only place in the API where a caller hands over ids they did not have to prove they
 * own. `ownedTagIds` re-reads them scoped to the user, and dropping that filter would let anyone
 * pin someone else's tag id into their settings.
 *
 * The second is absence. Three provider keys are optional in the schema *specifically* so that a
 * PUT replayed from a client that predates them — or from any save that never touched the AI
 * section — cannot blank the stored keys. That is a difference between `undefined` and `''` in a
 * `$set`, which is invisible in a response body and irreversible for the user.
 */

const Tag = modelDouble();
const UserSettings = modelDouble();
const settings = vi.hoisted(() => ({ getSettings: vi.fn() }));

vi.mock('../models/tag', () => ({ Tag }));
vi.mock('../models/userSettings', () => ({ UserSettings }));
vi.mock('../services/settingsService', () => settings);

const { settingsRouter } = await import('./settings');

const app = routeApp('/settings', settingsRouter);

const TAG_MINE = oid('mine');
const TAG_THEIRS = oid('theirs');

/** The smallest body the schema accepts — every optional field deliberately absent. */
const validBody = (patch: Record<string, unknown> = {}) => ({
  halfLifeDays: DEFAULT_SETTINGS.halfLifeDays,
  epsilon: DEFAULT_SETTINGS.epsilon,
  talkingPointsLimit: DEFAULT_SETTINGS.talkingPointsLimit,
  memoryImportanceThreshold: DEFAULT_SETTINGS.memoryImportanceThreshold,
  memoryMinAgeDays: DEFAULT_SETTINGS.memoryMinAgeDays,
  broadcastLifeChangingEvents: false,
  broadcastTagIds: [],
  defaultCheckupIntervalDays: null,
  ...patch,
});

/** The `$set` document the route built. */
const updateSet = () =>
  (UserSettings.findOneAndUpdate.mock.calls[0]?.[1] as { $set: Record<string, unknown> }).$set;

beforeEach(() => {
  resetModels(Tag, UserSettings);
  settings.getSettings.mockReset();
  settings.getSettings.mockResolvedValue(DEFAULT_SETTINGS);
});

describe('PUT /settings', () => {
  it('upserts the caller’s own settings and answers with the stored view', async () => {
    const res = await postJson(app, '/settings', validBody(), 'PUT');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULT_SETTINGS);
    const [filter, , options] = UserSettings.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
      Record<string, unknown>,
    ];
    expect(filter).toEqual({ userId: USER_ID });
    // Upsert, because a user who has never saved settings has no document to update — and
    // `$setOnInsert` is what stops the filter's userId being the only thing that binds it.
    expect(options).toEqual({ upsert: true });
    expect(UserSettings.findOneAndUpdate.mock.calls[0][1]).toMatchObject({
      $setOnInsert: { userId: USER_ID },
    });
  });

  it('answers from getSettings rather than echoing the request', async () => {
    /* The response is the *stored* view, which is not the same shape as the input: the provider
       keys go up and never come back, replaced by `hasGroqKey`-style booleans. Echoing the body
       would send an API key straight back to the browser. */
    settings.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, hasGroqKey: true });

    const res = await postJson(app, '/settings', validBody({ groqApiKey: 'gsk_secret' }), 'PUT');

    const body = await res.text();
    expect(body).not.toContain('gsk_secret');
    expect(JSON.parse(body)).toMatchObject({ hasGroqKey: true });
    expect(settings.getSettings).toHaveBeenCalledWith(USER_ID);
  });

  it('keeps only the broadcast tags the caller actually owns', async () => {
    // The lookup is scoped to the user, so the id belonging to somebody else simply isn't returned.
    Tag.find.mockReturnValue(query([{ _id: objectId('mine') }]));

    await postJson(app, '/settings', validBody({ broadcastTagIds: [TAG_MINE, TAG_THEIRS] }), 'PUT');

    expect(Tag.find).toHaveBeenCalledWith(
      { userId: USER_ID, _id: { $in: [TAG_MINE, TAG_THEIRS] } },
      '_id',
    );
    /* Stored as what the lookup returned, never as what was sent. A route that trusted the input
       would let anyone attach another user's tag id to their own scoring rules. */
    expect(updateSet().broadcastTagIds).toEqual([objectId('mine')]);
  });

  it('does not query for tags when the list is empty', async () => {
    await postJson(app, '/settings', validBody({ broadcastTagIds: [] }), 'PUT');

    expect(Tag.find).not.toHaveBeenCalled();
    expect(updateSet().broadcastTagIds).toEqual([]);
  });

  it('leaves a stored provider key alone when the payload omits it', async () => {
    await postJson(app, '/settings', validBody(), 'PUT');

    /* The keys must be *absent* from `$set`, not present and empty. Mongo would happily write `''`
       and the user's key would be gone — from a request that never mentioned it, replayed off an
       outbox, with nothing on screen to explain it. */
    const set = updateSet();
    expect('groqApiKey' in set).toBe(false);
    expect('openRouterApiKey' in set).toBe(false);
    expect('cerebrasApiKey' in set).toBe(false);
  });

  it('stores a provider key that is present', async () => {
    await postJson(app, '/settings', validBody({ groqApiKey: 'gsk_live' }), 'PUT');

    expect(updateSet().groqApiKey).toBe('gsk_live');
  });

  it('accepts an explicit empty string, which is how a key is cleared', async () => {
    await postJson(app, '/settings', validBody({ groqApiKey: '' }), 'PUT');

    // The one case where writing `''` is exactly what was meant — the difference from the test
    // above is that the client said so.
    expect(updateSet().groqApiKey).toBe('');
  });

  it('refuses values outside the ranges the scoring depends on', async () => {
    for (const patch of [
      { epsilon: 5 },
      { talkingPointsLimit: 0 },
      { memoryImportanceThreshold: 9 },
      { halfLifeDays: { ...DEFAULT_SETTINGS.halfLifeDays, 1: 0 } },
    ]) {
      const res = await postJson(app, '/settings', validBody(patch), 'PUT');
      expect(res.status).toBe(400);
    }
    expect(UserSettings.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses a broadcast tag id that is not an ObjectId', async () => {
    const res = await postJson(app, '/settings', validBody({ broadcastTagIds: ['nope'] }), 'PUT');

    expect(res.status).toBe(400);
    expect(UserSettings.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
