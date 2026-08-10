import 'fake-indexeddb/auto';
import { UNDATED_KEY } from '@diary/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pluginIdRange } from '@/lib/notificationIds';

/* The rules that keep one plugin from breaking every alarm in the app.
 *
 * All three failures below are silent in production: nothing throws, nothing logs to a screen, and
 * the only symptom is a reminder that stops arriving weeks later. `.tsx` so this runs in the jsdom
 * project — loading a plugin module pulls in the React UI tree. */

const loads = vi.hoisted(() => ({ good: vi.fn(), bad: vi.fn() }));

vi.mock('./i18n', () => ({ ensurePluginLocales: vi.fn(async () => {}) }));
vi.mock('./registry', async () => {
  const { CircleCheckBig, Cake, Tag } = await import('lucide-react');
  const PLUGINS = [
    { id: 'good', icon: CircleCheckBig, surfaces: ['notifications'], load: loads.good },
    { id: 'bad', icon: Cake, surfaces: ['notifications'], load: loads.bad },
    // Declares no reminders, so it must never be loaded by this collector at all.
    {
      id: 'quiet',
      icon: Tag,
      surfaces: ['day'],
      load: vi.fn(() => {
        throw new Error('loaded!');
      }),
    },
  ];
  return { PLUGINS, pluginSlot: (id: string) => PLUGINS.findIndex((p) => p.id === id) };
});

const { db } = await import('@/db/db');
const { collectPluginNotifications, isProtectedId } = await import('./notifications');

const GOOD_SLOT = 0;
const BAD_SLOT = 1;

const enable = (pluginId: string) =>
  db.pluginRecords.put({
    id: `cfg-${pluginId}`,
    pluginId,
    scope: 'config',
    dateKey: UNDATED_KEY,
    data: { enabled: true, settings: {} },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  });

const notificationAt = (slot: number, offset = 0) => ({
  id: pluginIdRange(slot).start + offset,
  title: 'x',
  body: 'x',
});

beforeEach(async () => {
  await db.pluginRecords.clear();
  loads.good.mockReset().mockResolvedValue({
    default: { collectNotifications: async () => [notificationAt(GOOD_SLOT)] },
  });
  loads.bad.mockReset().mockRejectedValue(new Error('chunk 404'));
});

describe('when no plugin wants reminders', () => {
  it('collects nothing without touching a chunk', async () => {
    // Nothing enabled: the common case, and it must not import anything.
    const result = await collectPluginNotifications();

    expect(result).toEqual({ notifications: [], protectedRanges: [] });
    expect(loads.good).not.toHaveBeenCalled();
  });

  it('ignores an enabled plugin that declares no reminders', async () => {
    await enable('quiet');

    const result = await collectPluginNotifications();

    // `quiet`'s loader throws if called; reaching here is the assertion.
    expect(result.notifications).toEqual([]);
  });
});

describe('a plugin that works', () => {
  it('contributes its notifications and protects nothing', async () => {
    await enable('good');

    const result = await collectPluginNotifications();

    expect(result.notifications).toHaveLength(1);
    expect(result.protectedRanges).toEqual([]);
  });

  it('drops an id outside its own slice', async () => {
    /* A plugin returning the wrong number would evict another plugin's alarms — or a checkup's,
       since the sweep cancels by id. It is not trusted to stay in its lane. */
    await enable('good');
    loads.good.mockResolvedValue({
      default: {
        collectNotifications: async () => [
          notificationAt(GOOD_SLOT),
          { id: 2, title: 'a checkup id', body: 'x' },
          notificationAt(BAD_SLOT),
        ],
      },
    });

    const result = await collectPluginNotifications();

    expect(result.notifications.map((n) => n.id)).toEqual([pluginIdRange(GOOD_SLOT).start]);
  });
});

describe('a plugin that fails', () => {
  it('does not take the pass down with it', async () => {
    await enable('good');
    await enable('bad');

    /* The whole point. `collectPluginNotifications` never rejects, so the reconcile still gets to
       schedule checkups, birthdays and the daily nudge — a plugin chunk missing from the cache
       must not stop the diary's own reminders from updating. */
    const result = await collectPluginNotifications();

    expect(result.notifications).toHaveLength(1);
  });

  it('protects its own range instead of contributing an empty list', async () => {
    await enable('bad');

    const result = await collectPluginNotifications();

    /* Contributing `[]` would look harmless and be the bug: the plugin's pending ids would not be
       in `desiredIds`, so the sweep would cancel them — a user offline with an evicted chunk
       silently losing a reminder they set up weeks ago. */
    expect(result.protectedRanges).toEqual([pluginIdRange(BAD_SLOT)]);
  });

  it('protects the range even when another plugin succeeded', async () => {
    await enable('good');
    await enable('bad');

    const result = await collectPluginNotifications();

    expect(result.protectedRanges).toEqual([pluginIdRange(BAD_SLOT)]);
    expect(isProtectedId(pluginIdRange(BAD_SLOT).start, result.protectedRanges)).toBe(true);
    expect(isProtectedId(pluginIdRange(GOOD_SLOT).start, result.protectedRanges)).toBe(false);
  });

  it('treats a plugin that hangs as one that failed', async () => {
    /* The background-fetch window is closed by the OS as soon as the task reports done, so an
       unbounded import cannot be waited on. Driven with a tiny real budget rather than fake timers:
       fake-indexeddb needs the real event loop, and faking the clock deadlocks the Dexie read this
       function makes before it ever reaches a plugin. */
    await enable('bad');
    loads.bad.mockReturnValue(new Promise(() => {}));

    const result = await collectPluginNotifications(20);

    expect(result.notifications).toEqual([]);
    expect(result.protectedRanges).toEqual([pluginIdRange(BAD_SLOT)]);
  });
});

describe('isProtectedId', () => {
  it('is half-open, so adjacent ranges cannot overlap', () => {
    const range = pluginIdRange(3);
    expect(isProtectedId(range.start, [range])).toBe(true);
    expect(isProtectedId(range.end - 1, [range])).toBe(true);
    expect(isProtectedId(range.end, [range])).toBe(false);
    expect(isProtectedId(range.start - 1, [range])).toBe(false);
  });
});
