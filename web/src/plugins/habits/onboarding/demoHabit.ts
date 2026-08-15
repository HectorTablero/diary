import type { Habit, HabitKind } from '../model';

/**
 * A demo habit for the tour — enough of the real `Habit` shape for `HabitControl`, `HabitProgress`
 * and the streak math (`metTarget`, `configAt`) to treat it exactly like one read from Dexie, with
 * none of the history a real habit accumulates. The tour never edits a habit's configuration, so
 * there is nothing to have revised, and nothing here is ever written anywhere — see the note on
 * `TypesStep`'s local `useState` values, which is where a real habit's day value would live too.
 */
export function demoHabit(fields: {
  id: string;
  name: string;
  type: HabitKind;
  unit?: string;
  target?: number;
  min?: number;
  max?: number;
}): Habit {
  return { since: '', revisions: [], order: 0, archivedAt: null, ...fields };
}
