import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Habit } from './model';
import {
  buildSnapshot,
  metCount,
  toRow,
  WIDGET_SNAPSHOT_VERSION,
  type WidgetStrings,
} from './widgetSnapshot';

/* The contract with HabitsWidgetProvider.java, tested from the only side that can be.
 *
 * Nothing here checks how the widget *looks* — that needs a device. What it checks is the part a
 * device would not catch either: that a row crossing into Java is already a finished statement
 * about one day, with no interpretation left to do. A `step` of 0 is what makes a mood read-only; a
 * `target` of 1 is what makes a ticked box count as met under the provider's single met rule. Those
 * are load-bearing, invisible in the JSON, and exactly the kind of thing that would rot silently
 * when a sixth habit kind is added. */

const habit = (patch: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: 'Push-ups',
  type: 'binary',
  since: '2026-03-01',
  revisions: [],
  order: 0,
  archivedAt: null,
  ...patch,
});

const strings: WidgetStrings = {
  title: 'Habits',
  done: 'Done',
  notDone: 'Not done',
  markDone: 'Mark done',
  empty: 'No habits yet.',
  nothingToday: 'Nothing to track today.',
};

const row = (h: Habit, value: number, dateKey = '2026-08-11') =>
  toRow(h, value, dateKey, 0, strings);

describe('toRow — the met rule the provider re-implements', () => {
  /* The provider decides met as `target > 0 ? raw >= target : raw > 0`, once, for every format. Each
     of these pins one kind onto that rule, so the two implementations cannot drift apart. */

  it('gives a binary habit target 1, so a tick reaches its goal', () => {
    expect(row(habit({ type: 'binary' }), 0)).toMatchObject({ target: 1, met: false });
    expect(row(habit({ type: 'binary' }), 1)).toMatchObject({ target: 1, met: true });
  });

  it('gives a rating no target, so any recorded value counts as met', () => {
    const mood = row(habit({ type: 'mood' }), 3);
    expect(mood).toMatchObject({ target: 0, met: true });
    expect(row(habit({ type: 'mood' }), 0).met).toBe(false);
  });

  it('carries a count short of its goal as unmet', () => {
    const short = row(habit({ type: 'numeric', target: 100 }), 40);
    expect(short).toMatchObject({ target: 100, met: false });
    expect(row(habit({ type: 'numeric', target: 100 }), 100).met).toBe(true);
  });

  it('treats a goalless count as met on any progress at all', () => {
    expect(row(habit({ type: 'numeric' }), 1)).toMatchObject({ target: 0, met: true });
  });
});

describe('toRow — what the widget is allowed to edit', () => {
  it('gives a rating its bounds, so a press can be refused at the ends', () => {
    /* The provider clamps with these and the drain clamps again on arrival. Both are needed: the
       provider stops a press being *offered* past the top, and the drain stops one that was already
       queued when the bounds moved from landing as a 6 on a five-face mood. */
    expect(row(habit({ type: 'mood' }), 3)).toMatchObject({ format: 'mood', min: 1, max: 5 });
    expect(row(habit({ type: 'scale', min: 1, max: 10 }), 4)).toMatchObject({
      format: 'scale',
      min: 1,
      max: 10,
    });
  });

  it('leaves bounds at zero for everything that has no ceiling', () => {
    // Nothing caps a count or a duration — exceeding a goal is the good outcome — and `max > min`
    // is exactly the test the provider uses to decide whether a row is bounded at all.
    expect(row(habit({ type: 'numeric', target: 100 }), 40)).toMatchObject({ min: 0, max: 0 });
    expect(row(habit({ type: 'time', target: 600 }), 60)).toMatchObject({ min: 0, max: 0 });
  });

  it('marks every kind as pressable, since each now has a control', () => {
    // step 0 used to mean "read-only", and nothing is read-only any more: a mood is picked from
    // five faces and a scale is stepped between its bounds.
    for (const type of ['binary', 'numeric', 'time', 'scale', 'mood'] as const) {
      expect(row(habit({ type }), 1).step).toBeGreaterThan(0);
    }
  });

  it('steps a big goal in fives and a small one in ones', () => {
    // Mirrors HabitControl: a hundred push-ups in ones is a hundred taps.
    expect(row(habit({ type: 'numeric', target: 100 }), 0).step).toBe(5);
    expect(row(habit({ type: 'numeric', target: 10 }), 0).step).toBe(1);
    expect(row(habit({ type: 'numeric' }), 0).step).toBe(1);
  });

  it('steps a short duration by a minute and a long one by five', () => {
    expect(row(habit({ type: 'time', target: 10 * 60 }), 0).step).toBe(60);
    expect(row(habit({ type: 'time', target: 60 * 60 }), 0).step).toBe(5 * 60);
  });
});

describe('toRow — formatting the provider has to reproduce', () => {
  it('shows a duration in seconds only when the goal is small enough to make them mean something', () => {
    // The provider re-renders after a ± press, so it is handed the decision rather than the rule.
    expect(row(habit({ type: 'time', target: 5 * 60 }), 125)).toMatchObject({
      showSeconds: true,
      value: '2m 5s',
    });
    expect(row(habit({ type: 'time', target: 2 * 60 * 60 }), 4805)).toMatchObject({
      showSeconds: false,
      value: '1h 20m',
    });
  });

  it('carries a count unit separately so the provider can rebuild the string', () => {
    expect(row(habit({ type: 'numeric', unit: 'reps' }), 20)).toMatchObject({
      format: 'count',
      raw: 20,
      unit: 'reps',
      value: '20 reps',
    });
  });

  it('renders a binary from the shipped strings rather than a hardcoded word', () => {
    expect(row(habit({ type: 'binary' }), 1).value).toBe('Done');
    expect(row(habit({ type: 'binary' }), 0).value).toBe('Not done');
  });

  it('renders an unrecorded rating as a dash, not as its lowest value', () => {
    // A slider parked at its left end and one never answered are different facts about a day.
    expect(row(habit({ type: 'mood' }), 0).value).toBe('—');
    expect(row(habit({ type: 'mood' }), 4).value).toBe('4/5');
  });
});

describe('toRow — history', () => {
  it('labels and judges a row by the configuration in force on that day, not today', () => {
    /* The bug this prevents is invisible on the day card and glaring on a home screen: raise a goal
       from 50 to 100 and yesterday's widget, if it were rebuilt, would call a met day unmet. */
    const raised = habit({
      type: 'numeric',
      name: 'Push-ups',
      target: 100,
      since: '2026-08-10',
      revisions: [
        {
          since: '2026-01-01',
          changedAt: '2026-08-10T09:00:00.000Z',
          name: 'Press-ups',
          target: 50,
        },
      ],
    });

    expect(row(raised, 50, '2026-06-01')).toMatchObject({
      label: 'Press-ups',
      target: 50,
      met: true,
    });
    expect(row(raised, 50, '2026-08-11')).toMatchObject({
      label: 'Push-ups',
      target: 100,
      met: false,
    });
  });
});

describe('buildSnapshot', () => {
  it('stamps the day it describes, so the provider can refuse to present it as another one', () => {
    const snapshot = buildSnapshot('2026-08-11', [habit()], { h1: 1 }, new Map(), strings);
    expect(snapshot.dateKey).toBe('2026-08-11');
    expect(snapshot.v).toBe(4);
  });

  it('reads a missing value as zero rather than dropping the row', () => {
    // A habit with nothing recorded is the normal morning state, not an absent habit.
    const snapshot = buildSnapshot('2026-08-11', [habit()], {}, new Map(), strings);
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({ raw: 0, met: false });
  });

  it('carries each habit its own streak', () => {
    const snapshot = buildSnapshot(
      '2026-08-11',
      [habit({ id: 'a' }), habit({ id: 'b' })],
      {},
      new Map([['a', 4]]),
      strings,
    );
    expect(snapshot.rows.map((r) => r.streak)).toEqual([4, 0]);
  });

  it('ships streakBefore separately, so a widget press can add today without a new snapshot', () => {
    // 'a' is met today (value 1 on a binary habit); the streak crosses from 4 to 5. 'b' is unmet, so
    // its streakBefore and streak agree — the split only shows up once today's own answer is yes.
    const snapshot = buildSnapshot(
      '2026-08-11',
      [habit({ id: 'a' }), habit({ id: 'b' })],
      { a: 1 },
      new Map([['a', 4]]),
      strings,
    );
    expect(snapshot.rows.map((r) => ({ streakBefore: r.streakBefore, streak: r.streak }))).toEqual([
      { streakBefore: 4, streak: 5 },
      { streakBefore: 0, streak: 0 },
    ]);
  });

  it('produces an empty row list rather than omitting the snapshot when nothing applies', () => {
    // What a disabled plugin and a fully retired list both look like — the widget needs to be told
    // to draw its empty state, not left showing whatever it drew last.
    expect(buildSnapshot('2026-08-11', [], {}, new Map(), strings).rows).toEqual([]);
  });
});

describe('metCount', () => {
  it('counts goals reached, not habits touched', () => {
    // 12 of 100 push-ups is progress, not a day of the habit — the same bar the day card holds.
    const rows = [
      row(habit({ id: 'a', type: 'numeric', target: 100 }), 12),
      row(habit({ id: 'b', type: 'numeric', target: 100 }), 100),
      row(habit({ id: 'c', type: 'binary' }), 1),
    ];
    expect(metCount(rows)).toBe(2);
  });
});

describe('the version constant the native provider must match', () => {
  it('is the same number HabitsWidgetStore.java accepts', () => {
    /* The one part of this contract no type can check: the writer is here and the reader is a Java
       constant, with SharedPreferences and a process boundary in between.
     *
     * Bumping one without the other is silent in the worst way. An unrecognised version is treated
     * as *absent* rather than parsed optimistically — deliberately, because the web layer updates
     * over the air while the provider only changes when a new APK is installed — so the widget
     * simply falls back to "Open Diary to set this up" forever, with nothing logged anywhere. This
     * test is what turns that into a failing build instead of a bug report. */
    const store = readFileSync(
      fileURLToPath(
        new URL(
          '../../../android/app/src/main/java/es/tablerus/diary/HabitsWidgetStore.java',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    const declared = store.match(/SUPPORTED_VERSION\s*=\s*(\d+)/);
    expect(declared, 'SUPPORTED_VERSION not found in HabitsWidgetStore.java').not.toBeNull();
    expect(Number(declared![1])).toBe(WIDGET_SNAPSHOT_VERSION);
  });
});
