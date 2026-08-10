import { describe, expect, it } from 'vitest';
import {
  BIRTHDAY_ID_BASE,
  birthdayNotificationId,
  CHECKUP_DIGEST_ID,
  CHECKUP_ID_BASE,
  checkupNotificationId,
  DAILY_REMINDER_ID,
  ID_SPACE,
  MAX_NOTIFYING_PLUGINS,
  PLUGIN_ID_BASE,
  pluginIdRange,
  pluginNotificationId,
} from './notificationIds';

/* The reconcile cancels every pending id it did not just schedule, so any overlap between two
   ranges makes the two kinds silently evict each other — no error, no log, just a reminder that
   stopped arriving. None of that is visible from reading the constants, hence this file. */

/** Inclusive top of a hashed range: `base + (fnv1a % ID_SPACE)` can reach `base + ID_SPACE - 1`. */
const topOf = (base: number) => base + ID_SPACE - 1;

const INT_MAX = 0x7fffffff;

describe('notification id space', () => {
  it('keeps the three hashed ranges disjoint and above the fixed ids', () => {
    expect(CHECKUP_DIGEST_ID).toBe(0);
    expect(DAILY_REMINDER_ID).toBe(1);
    expect(CHECKUP_ID_BASE).toBeGreaterThan(DAILY_REMINDER_ID);

    expect(BIRTHDAY_ID_BASE).toBeGreaterThan(topOf(CHECKUP_ID_BASE));
    expect(PLUGIN_ID_BASE).toBeGreaterThan(topOf(BIRTHDAY_ID_BASE));
  });

  it('ends exactly at Integer.MAX_VALUE', () => {
    // Android notification ids are Java ints. Overflowing wraps to negative rather than throwing,
    // which would collide back into the checkup range from below.
    expect(topOf(PLUGIN_ID_BASE)).toBe(INT_MAX);
  });

  it('wastes no more than the two fixed ids', () => {
    // Three equal thirds starting at 2. If a future change shrinks ID_SPACE without moving a base,
    // this catches the gap before the ranges silently stop being adjacent.
    expect(BIRTHDAY_ID_BASE).toBe(topOf(CHECKUP_ID_BASE) + 1);
    expect(PLUGIN_ID_BASE).toBe(topOf(BIRTHDAY_ID_BASE) + 1);
  });

  it('places hashed ids inside their own range', () => {
    for (const personId of ['507f1f77bcf86cd799439011', 'a', '', '👋 unicode']) {
      const checkup = checkupNotificationId(personId);
      expect(checkup).toBeGreaterThanOrEqual(CHECKUP_ID_BASE);
      expect(checkup).toBeLessThanOrEqual(topOf(CHECKUP_ID_BASE));

      const birthday = birthdayNotificationId(personId);
      expect(birthday).toBeGreaterThanOrEqual(BIRTHDAY_ID_BASE);
      expect(birthday).toBeLessThanOrEqual(topOf(BIRTHDAY_ID_BASE));
    }
  });

  it('gives every person a different checkup and birthday id', () => {
    // The whole point of separate bases: one person must not evict their own two reminders.
    const personId = '507f1f77bcf86cd799439011';
    expect(checkupNotificationId(personId)).not.toBe(birthdayNotificationId(personId));
  });
});

describe('plugin id slices', () => {
  it('packs every slot inside the plugin range without overlapping', () => {
    let previousEnd = PLUGIN_ID_BASE;
    for (let slot = 0; slot < MAX_NOTIFYING_PLUGINS; slot++) {
      const { start, end } = pluginIdRange(slot);
      expect(start).toBe(previousEnd); // contiguous: no gaps, no overlap
      expect(end).toBeLessThanOrEqual(INT_MAX + 1);
      previousEnd = end;
    }
  });

  it('keeps ids within their own slot, so a failed plugin is recognisable by range alone', () => {
    // This is what lets the reconcile leave a failed plugin's pending ids armed instead of
    // sweeping them: it can attribute an id without loading the chunk that created it.
    const { start, end } = pluginIdRange(3);
    for (const key of ['daily', 'streak:abc', '']) {
      const id = pluginNotificationId(3, key);
      expect(id).toBeGreaterThanOrEqual(start);
      expect(id).toBeLessThan(end);
    }
    expect(pluginNotificationId(4, 'daily')).toBeGreaterThanOrEqual(pluginIdRange(4).start);
  });
});
