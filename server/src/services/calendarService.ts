import type { CalendarDay } from '@diary/shared';
import { Entry } from '../models/entry';
import { ENTRY_POPULATE, entryToDto, type LeanEntry } from '../dto';

/** Per-day entry counts and strongest importance for one month (top-level entries only). */
export async function getMonth(userId: string, year: number, month: number): Promise<CalendarDay[]> {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const rows = await Entry.aggregate<{ _id: string; count: number; maxImportance: number }>([
    {
      $match: {
        userId,
        parentId: null,
        dateKey: { $gte: `${prefix}-01`, $lte: `${prefix}-31` },
      },
    },
    {
      $group: {
        _id: '$dateKey',
        count: { $sum: 1 },
        // 1 = highest importance, so the "strongest" day value is the minimum.
        maxImportance: { $min: '$importance' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r) => ({ date: r._id, count: r.count, maxImportance: r.maxImportance }));
}

/** Important entries from the same month-day in previous years. */
export async function getOnThisDay(userId: string, dateKey: string, importanceThreshold: number) {
  const monthDay = dateKey.slice(4); // "-MM-DD"
  const entries = await Entry.find({
    userId,
    dateKey: { $lt: dateKey.slice(0, 4) + monthDay, $regex: `${monthDay}$` },
    importance: { $lte: importanceThreshold },
  })
    .sort({ dateKey: -1 })
    .limit(20)
    .populate(ENTRY_POPULATE)
    .lean();
  return (entries as unknown as LeanEntry[]).map(entryToDto);
}
