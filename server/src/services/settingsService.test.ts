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

const { getSettings } = await import('./settingsService');

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
