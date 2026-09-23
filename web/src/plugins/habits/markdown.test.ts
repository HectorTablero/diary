import 'fake-indexeddb/auto';
import { UNDATED_KEY } from '@diary/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { createPluginRecord } from '@/db/pluginRecords';
import i18n from '@/i18n';
import type { PluginExportRange } from '@/plugins/types';
import en from './locales/en.json';
import { exportHabitsMarkdown } from './markdown';
import { habitData, type Habit } from './model';

/* What this export has to get right is the part a table cannot say on its own: an empty cell.
 *
 * A habit created in March has no February, a retired one has no September, and a Wednesdays-only
 * habit has no Thursdays — and none of those is the same thing as a day it was asked about and
 * nothing was recorded. The reader is an agent with no app to check against, so if all four look
 * alike it will read a seasonal habit's off-season as months of failure. Every assertion below is
 * about one of those four being distinguishable from the others.
 *
 * A plain `.test.ts` — nothing here touches React, so it runs in the fast node-environment `logic`
 * project (see vitest.config.ts), the same way notebook/markdown.test.ts does. */

const TODAY = '2026-09-10'; // A Thursday, which several of the schedules below depend on.

const habit = (patch: Partial<Omit<Habit, 'id'>> & { name: string }) =>
  createPluginRecord(
    'habits',
    'record',
    UNDATED_KEY,
    habitData({
      type: 'binary',
      order: 0,
      archivedAt: null,
      since: '2026-09-01',
      revisions: [],
      ...patch,
    }),
  );

const day = (dateKey: string, values: Record<string, number>) =>
  createPluginRecord('habits', 'record', dateKey, { values });

/** No date picker touched — what the export dialog sends when the user asks for everything. */
const ALL: PluginExportRange = { from: null, to: null };

const markdown = async (range: PluginExportRange = ALL): Promise<string> => {
  const sections = await exportHabitsMarkdown(range);
  expect(sections).toHaveLength(1);
  expect(sections[0].filename).toBe('habits.md');
  return sections[0].markdown;
};

/** The row for one date, whitespace and all — the cells are the assertion, so they are compared as
    written rather than parsed back out. */
const rowFor = (text: string, dateKey: string): string =>
  text.split('\n').find((line) => line.startsWith(`| ${dateKey} |`)) ?? `no row for ${dateKey}`;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${TODAY}T12:00:00.000Z`) });
  i18n.addResourceBundle('en', 'translation', { plugins: { habits: en } }, true, true);
  await i18n.changeLanguage('en');
  await db.pluginRecords.clear();
  await db.outbox.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('exportHabitsMarkdown', () => {
  it('contributes nothing when there are no habits, and nothing when none has been recorded', async () => {
    expect(await exportHabitsMarkdown(ALL)).toEqual([]);
    await habit({ name: 'Gym' });
    expect(await exportHabitsMarkdown(ALL)).toEqual([]);
  });

  it('tells an off-day apart from a day the habit was genuinely missed', async () => {
    const gym = await habit({ name: 'Gym', schedule: { kind: 'weekdays', days: [3] }, order: 0 });
    const water = await habit({ name: 'Water', type: 'numeric', order: 1 });

    await day('2026-09-02', { [gym.id]: 1, [water.id]: 3 }); // Wednesday, done
    await day('2026-09-03', { [water.id]: 2 }); // Thursday — never asked
    await day('2026-09-09', { [water.id]: 1 }); // Wednesday — asked, and missed

    const text = await markdown();
    expect(text).toContain('| Date | Gym | Water |');
    expect(rowFor(text, '2026-09-02')).toBe('| 2026-09-02 | × | 3 |');
    expect(rowFor(text, '2026-09-03')).toBe('| 2026-09-03 | – | 2 |');
    expect(rowFor(text, '2026-09-09')).toBe('| 2026-09-09 | · | 1 |');
  });

  it('leaves a cell empty on the days a habit was not being tracked at all, and says when it was', async () => {
    const water = await habit({ name: 'Water', type: 'numeric', order: 0 });
    const yoga = await habit({
      name: 'Yoga',
      since: '2026-09-05',
      archivedAt: '2026-09-08T10:00:00.000Z',
      order: 1,
    });

    await day('2026-09-02', { [water.id]: 1 }); // before Yoga existed
    await day('2026-09-06', { [water.id]: 1, [yoga.id]: 1 });
    await day('2026-09-09', { [water.id]: 1 }); // after Yoga was retired

    const text = await markdown();
    expect(rowFor(text, '2026-09-02')).toBe('| 2026-09-02 | 1 |  |');
    expect(rowFor(text, '2026-09-06')).toBe('| 2026-09-06 | 1 | × |');
    expect(rowFor(text, '2026-09-09')).toBe('| 2026-09-09 | 1 |  |');

    expect(text).toContain('Tracked from 2026-09-01 onwards.');
    expect(text).toContain('Tracked from 2026-09-05 to 2026-09-08, then retired.');
    // Four days asked about (the 5th to the 8th, the retirement day included), one recorded — the
    // count stops at retirement rather than running to today.
    expect(text).toContain('asked about on 4 days · 1 day recorded');
  });

  it('counts an overdue task as asked about on the days it was still owed', async () => {
    const passport = await habit({ name: 'Passport', type: 'task', order: 0 });
    const water = await habit({ name: 'Water', type: 'numeric', order: 1 });

    await day('2026-09-01', { [water.id]: 1 }); // the day it was due
    await day('2026-09-03', { [water.id]: 1 }); // still owed
    await day('2026-09-05', { [water.id]: 1, [passport.id]: 1 }); // done, late

    const text = await markdown();
    expect(rowFor(text, '2026-09-01')).toBe('| 2026-09-01 | · | 1 |');
    expect(rowFor(text, '2026-09-03')).toBe('| 2026-09-03 | · | 1 |');
    expect(rowFor(text, '2026-09-05')).toBe('| 2026-09-05 | × | 1 |');
    // Its schedule falls on one day however long it went unanswered: a backlog of missed
    // occurrences is exactly what `pendingTask` refuses to invent.
    expect(text).toContain('Once');
    expect(text).toContain('asked about on 1 day · 1 day recorded');
  });

  it('describes each habit by its kind and schedule, and dates the edits inside its period', async () => {
    const pushups = await habit({
      name: 'Push-ups',
      type: 'numeric',
      unit: 'reps',
      target: 100,
      since: '2026-09-05',
      revisions: [
        {
          since: '2026-09-01',
          changedAt: '2026-09-05T09:00:00.000Z',
          name: 'Push-ups',
          unit: 'reps',
          target: 50,
        },
      ],
    });

    await day('2026-09-02', { [pushups.id]: 50 });

    const text = await markdown();
    expect(text).toContain('### Push-ups');
    expect(text).toContain('- Counted in reps · goal 100');
    expect(text).toContain('- Every day');
    // The origin is the earliest banked revision, not the current configuration's own `since` —
    // the habit existed for the four days it spent at a goal of 50.
    expect(text).toContain('Tracked from 2026-09-01 onwards.');
    expect(text).toContain('  - 2026-09-05 — Goal 50 reps → 100 reps');
    // And the day itself is judged against the goal that was in force on it.
    expect(rowFor(text, '2026-09-02')).toBe('| 2026-09-02 | 50 reps |');
  });

  it('explains its own notation before using it', async () => {
    const gym = await habit({ name: 'Gym' });
    await day('2026-09-02', { [gym.id]: 1 });

    const text = await markdown();
    expect(text.indexOf('### How to read this')).toBeLessThan(text.indexOf('### Gym'));
    expect(text.indexOf('### Gym')).toBeLessThan(text.indexOf('### The log'));
    expect(text).toContain('- `×` — a box that was ticked.');
    expect(text).toContain('- `·` — the habit was asked about on that day');
    expect(text).toContain('- `–` — the habit was still being kept');
    expect(text).toContain('An empty cell means');
    expect(text).toContain('Only days something was recorded on have a row.');
  });
});

/* The export used to read its whole table out of the database whatever range the dialog was set to,
 * so an export of one week carried every habit ever kept. Clipping the rows is the easy half; the
 * half worth testing is that nothing above the rows goes on describing days the table no longer
 * shows, because a lifetime count over a week of rows reads as a week of failure. */
describe('a date range', () => {
  it("keeps only the days inside it, and counts over that window rather than the habit's life", async () => {
    const gym = await habit({ name: 'Gym' });

    await day('2026-09-01', { [gym.id]: 1 });
    await day('2026-09-05', { [gym.id]: 1 });
    await day('2026-09-09', { [gym.id]: 1 });

    const text = await markdown({ from: '2026-09-04', to: '2026-09-06' });
    expect(rowFor(text, '2026-09-05')).toBe('| 2026-09-05 | × |');
    expect(rowFor(text, '2026-09-01')).toBe('no row for 2026-09-01');
    expect(rowFor(text, '2026-09-09')).toBe('no row for 2026-09-09');
    // Three days asked about in the window, one of them recorded — not the nine and three the
    // habit has to its name.
    expect(text).toContain('asked about on 3 days · 1 day recorded');
  });

  it('says outright that the counts have been clipped, and how', async () => {
    const gym = await habit({ name: 'Gym' });
    await day('2026-09-05', { [gym.id]: 1 });

    // The tracked period stays absolute — it is when the habit came to be, which the clipped table
    // cannot say — so the note is what stops the count beneath it reading as a lifetime.
    expect(await markdown({ from: '2026-09-04', to: '2026-09-06' })).toContain(
      'Tracked from 2026-09-01 onwards. (counts clipped to 2026-09-04 – 2026-09-06)',
    );
    expect(await markdown({ from: '2026-09-04', to: null })).toContain(
      '(counts clipped to 2026-09-04 onwards)',
    );
    expect(await markdown({ from: null, to: '2026-09-06' })).toContain(
      '(counts clipped to 2026-09-06 and earlier)',
    );
    // And no note at all when nothing was clipped, rather than one saying "clipped to everything".
    expect(await markdown()).not.toContain('counts clipped');
  });

  it('drops a habit whose whole life falls outside the range, column and all', async () => {
    const gym = await habit({ name: 'Gym', order: 0 });
    const yoga = await habit({
      name: 'Yoga',
      since: '2026-09-01',
      archivedAt: '2026-09-03T10:00:00.000Z',
      order: 1,
    });

    await day('2026-09-02', { [gym.id]: 1, [yoga.id]: 1 });
    await day('2026-09-08', { [gym.id]: 1 });

    // Yoga was retired before this window opened, so every cell of its column would be the empty
    // "not tracked then" marker — a name with nothing under it for the reader to go and explain.
    const text = await markdown({ from: '2026-09-07', to: '2026-09-09' });
    expect(text).toContain('| Date | Gym |');
    expect(text).not.toContain('Yoga');
  });

  it('contributes nothing at all when no day falls inside the range', async () => {
    const gym = await habit({ name: 'Gym' });
    await day('2026-09-02', { [gym.id]: 1 });

    expect(await exportHabitsMarkdown({ from: '2026-09-20', to: '2026-09-30' })).toEqual([]);
  });

  it('still resolves a late task against the whole log, not just the range', async () => {
    const passport = await habit({ name: 'Passport', type: 'task', order: 0 });
    const water = await habit({ name: 'Water', type: 'numeric', order: 1 });

    await day('2026-09-01', { [water.id]: 1 }); // the day it was due
    await day('2026-09-03', { [water.id]: 1 }); // still owed
    await day('2026-09-08', { [water.id]: 1, [passport.id]: 1 }); // done, late — outside the range

    // The task was finished on the 8th, which this range excludes. Judging "still pending on the
    // 3rd" off the clipped log alone would never see that, and would mark it owed forever.
    const text = await markdown({ from: '2026-09-01', to: '2026-09-05' });
    expect(rowFor(text, '2026-09-01')).toBe('| 2026-09-01 | · | 1 |');
    expect(rowFor(text, '2026-09-03')).toBe('| 2026-09-03 | · | 1 |');
    // Recorded nowhere inside the window, though it was asked about there.
    expect(text).toContain('asked about on 1 day · 0 days recorded');
  });
});
