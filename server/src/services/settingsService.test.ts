import { DEFAULT_SETTINGS } from '@diary/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { modelDouble, query, resetModels } from '../test/mongooseDouble';

/* Threads are opt-in, except for accounts that already use them: an unset `threadsEnabled` reads as
   on when the user has at least one thread, off otherwise. A stored choice always wins. */

const Thread = modelDouble();
const UserSettings = modelDouble();

vi.mock('../models/thread', () => ({ Thread }));
vi.mock('../models/userSettings', () => ({ UserSettings }));

const { getSettings, getWriteSettings } = await import('./settingsService');

const storedSettings = (patch: Record<string, unknown> = {}) =>
  UserSettings.findOneAndUpdate.mockReturnValue(
    query({ ...DEFAULT_SETTINGS, threadsEnabled: undefined, broadcastTagIds: [], ...patch }),
  );

beforeEach(() => resetModels(Thread, UserSettings));

describe('getSettings · threadsEnabled', () => {
  it('is off for an account with no threads that never chose', async () => {
    storedSettings();
    expect((await getSettings('u1')).threadsEnabled).toBe(false);
  });

  it('is on for an account with a thread that never chose', async () => {
    storedSettings();
    Thread.exists.mockResolvedValue({ _id: 'th1' });
    expect((await getSettings('u1')).threadsEnabled).toBe(true);
    expect(Thread.exists).toHaveBeenCalledWith({ userId: 'u1' });
  });

  it('keeps a stored choice even when threads exist', async () => {
    storedSettings({ threadsEnabled: false });
    Thread.exists.mockResolvedValue({ _id: 'th1' });
    expect((await getSettings('u1')).threadsEnabled).toBe(false);
  });
});

/* Settings are read on the write path — every sub-entry create checks the depth limit, every person
   create without an interval reads the default — so reading them must not itself be a write. The
   upsert that creates the defaults row is for the one account that has none yet. */
describe('reading settings', () => {
  const row = { ...DEFAULT_SETTINGS, threadsEnabled: true, broadcastTagIds: [] };

  it('only reads when the row is already there', async () => {
    UserSettings.findOne.mockReturnValue(query(row));

    await getSettings('u1');
    await getWriteSettings('u1');

    expect(UserSettings.findOne).toHaveBeenCalledWith({ userId: 'u1' });
    expect(UserSettings.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('creates the defaults row on first access, as it always did', async () => {
    storedSettings({ maxSubEntryDepth: 4, defaultCheckupIntervalDays: 21 });

    expect(await getWriteSettings('u1')).toEqual({
      maxSubEntryDepth: 4,
      defaultCheckupIntervalDays: 21,
    });
    expect(UserSettings.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'u1' },
      { $setOnInsert: { userId: 'u1' } },
      expect.objectContaining({ upsert: true }),
    );
  });

  it('answers the write settings without the lookup getSettings makes for threads', async () => {
    UserSettings.findOne.mockReturnValue(query({ ...row, threadsEnabled: undefined }));

    await getWriteSettings('u1');

    expect(Thread.exists).not.toHaveBeenCalled();
  });
});
