import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BIRTHDAY_ID_BASE, CHECKUP_ID_BASE, pluginIdRange } from './notificationIds';

/* The reconcile's contract with plugins, tested at the seam where it actually matters.
 *
 * `plugins/notifications.test.tsx` proves the collector never throws and reports the right ranges.
 * This proves the reconcile *acts* on them — that a plugin failing does not stop the diary's own
 * alarms being armed, and does not get its own swept. Neither would show up as an error anywhere:
 * the first looks like reminders quietly going stale, the second like one vanishing weeks later. */

const native = vi.hoisted(() => ({ value: true }));
const plugin = vi.hoisted(() => ({
  result: { notifications: [] as unknown[], protectedRanges: [] as unknown[] },
}));
const capacitor = vi.hoisted(() => ({
  scheduled: [] as { id: number; title?: string; body?: string }[],
  cancelled: [] as { id: number }[],
  pending: [] as { id: number }[],
}));
/* Stands in for "the locale file has not arrived yet", which on a real cold start is a window the
   reconcile can run inside — see ensureStringsLoaded in ./notifications. */
const i18nState = vi.hoisted(() => ({ loaded: false }));

vi.mock('@/lib/native', () => ({ isNative: native.value }));
/* The real module fetches its strings, which jsdom has no server to answer. This mock keeps the
   one behaviour the reconcile has to cope with: until `ensureLanguage` resolves, `t` answers with
   the key itself — exactly what i18next does with no bundle registered. */
vi.mock('@/i18n', () => ({
  default: {
    language: 'en',
    t: (key: string, options?: { returnObjects?: boolean }) => {
      if (!i18nState.loaded) return key;
      return options?.returnObjects ? [`${key} template for {{name}}`] : `${key} translated`;
    },
  },
  DEFAULT_LANGUAGE: 'en',
  ensureLanguage: async () => {
    i18nState.loaded = true;
  },
  resolveLanguage: () => 'en',
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    schedule: vi.fn(
      async ({ notifications }: { notifications: { id: number; title?: string }[] }) => {
        capacitor.scheduled.push(...notifications);
      },
    ),
    getPending: vi.fn(async () => ({ notifications: capacitor.pending })),
    cancel: vi.fn(async ({ notifications }: { notifications: { id: number }[] }) => {
      capacitor.cancelled.push(...notifications);
    }),
    checkPermissions: vi.fn(async () => ({ display: 'granted' })),
    requestPermissions: vi.fn(async () => ({ display: 'granted' })),
  },
}));
vi.mock('@/plugins/notifications', () => ({
  collectPluginNotifications: vi.fn(async () => plugin.result),
  isProtectedId: (id: number, ranges: { start: number; end: number }[]) =>
    ranges.some((range) => id >= range.start && id < range.end),
}));

const person = {
  id: 'p1',
  name: 'Ana',
  aliases: [],
  phone: null,
  email: null,
  wechatId: null,
  birthday: null,
  company: null,
  jobTitle: null,
  contactId: null,
  events: [],
  tagIds: [],
  notes: '',
  // Long overdue, so a checkup is always produced.
  checkupIntervalDays: 1,
  lastCheckupAt: '2020-01-01T00:00:00.000Z',
  createdAt: '2020-01-01T00:00:00.000Z',
};

vi.mock('@/db/db', () => ({
  db: {
    people: { toArray: async () => [person] },
    entries: { count: async () => 0, where: () => ({ equals: () => ({ count: async () => 0 }) }) },
    meta: { delete: async () => {} },
  },
  getMeta: async () => ({}),
  setMeta: async () => {},
}));

const { refreshNotificationsNow } = await import('./notifications');

const PLUGIN_SLOT = 0;
const pluginRange = pluginIdRange(PLUGIN_SLOT);

beforeEach(() => {
  capacitor.scheduled = [];
  capacitor.cancelled = [];
  capacitor.pending = [];
  plugin.result = { notifications: [], protectedRanges: [] };
  // Every test starts from a cold boot, strings not yet fetched.
  i18nState.loaded = false;
});

const scheduledIn = (base: number, span = 0x2aaaaaaa) =>
  capacitor.scheduled.filter((n) => n.id >= base && n.id < base + span);

describe('when a plugin fails to contribute', () => {
  beforeEach(() => {
    // What collectPluginNotifications returns for a chunk that would not load.
    plugin.result = { notifications: [], protectedRanges: [pluginRange] };
    // An alarm that plugin armed on an earlier pass, still pending.
    capacitor.pending = [{ id: pluginRange.start + 7 }];
  });

  it('still arms the diary’s own reminders', async () => {
    await refreshNotificationsNow();

    /* The failure mode this prevents: letting a plugin throw kills the whole pass, so one missing
       chunk would stop checkups, birthdays and the daily nudge from updating too. */
    expect(scheduledIn(CHECKUP_ID_BASE)).not.toHaveLength(0);
  });

  it('leaves that plugin’s pending alarms alone', async () => {
    await refreshNotificationsNow();

    /* The subtler failure: contributing `[]` looks harmless, but an id absent from `desiredIds` is
       swept as stale — so an evicted chunk would silently cancel a reminder set up weeks ago. */
    expect(capacitor.cancelled).toEqual([]);
  });
});

describe('when no plugin protects anything', () => {
  it('sweeps a stale id in the plugin range as usual', async () => {
    // Nothing protected and nothing contributed: the range is ordinary, and an unasked-for id in
    // it is as stale as any other — a plugin that was switched off, say.
    capacitor.pending = [{ id: pluginRange.start + 7 }];

    await refreshNotificationsNow();

    expect(capacitor.cancelled).toEqual([{ id: pluginRange.start + 7 }]);
  });

  it('schedules what a working plugin asked for', async () => {
    plugin.result = {
      notifications: [
        { id: pluginRange.start + 1, title: 'Habits', body: 'x', schedule: { at: new Date() } },
      ],
      protectedRanges: [],
    };

    await refreshNotificationsNow();

    expect(capacitor.scheduled.some((n) => n.id === pluginRange.start + 1)).toBe(true);
    // And the diary's own kinds are untouched by a plugin joining the pass.
    expect(scheduledIn(CHECKUP_ID_BASE)).not.toHaveLength(0);
    expect(scheduledIn(BIRTHDAY_ID_BASE)).toHaveLength(0); // this person has no birthday
  });
});

/* A notification's words are fixed the moment it is scheduled — nothing re-renders an alarm — so a
   reconcile racing the locale fetch does not merely look wrong on screen for a frame, it writes
   the raw key into the alarm. What made that reach a phone rather than being corrected by the next
   pass is the catch-up path: it fires seconds after boot. */
describe('the words a notification is scheduled with', () => {
  it('waits for the strings rather than baking in raw keys', async () => {
    await refreshNotificationsNow();

    const [checkup] = scheduledIn(CHECKUP_ID_BASE);
    expect(checkup.title).toBe('people.checkupDueTitle translated');
    /* Not just "isn't the key": a missing bundle makes i18next return the key as a *string*, and
       pickTemplate's random index into a string is a single character — the reported body was "d",
       one letter of "notifications.birthdayBodies". */
    expect(checkup.body).toBe('people.checkupBodies template for Ana');
  });
});
