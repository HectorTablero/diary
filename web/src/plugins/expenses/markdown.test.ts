import 'fake-indexeddb/auto';
import { UNDATED_KEY } from '@diary/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { createPluginRecord } from '@/db/pluginRecords';
import i18n from '@/i18n';
import type { PluginExportRange } from '@/plugins/types';
import en from './locales/en.json';
import { exportExpensesDayLines, exportExpensesMarkdown } from './markdown';
import { builtinCategoryId, categoryData, expenseData, PLUGIN_ID } from './model';

/* This export is two documents' worth of one plugin's data, split by what each half is *for*.
 *
 * Under a day go the expenses of that day, because a reader asking what a day was like is already
 * looking there — the flat ledger this replaced put every expense as far from its entry as the
 * document allowed. At the end goes the thing no single day can show: a pivot of categories against
 * months. What the tests below pin down is the seam between them, the range reaching both halves,
 * and the one rule the plugin may never break — that two currencies are never added together (see
 * currency.ts, which has no conversion in it at all and is not getting one).
 *
 * A plain `.test.ts`: nothing here touches React, so it runs in the fast node-environment `logic`
 * project, the same way habits/markdown.test.ts does. */

const ALL: PluginExportRange = { from: null, to: null };

/**
 * One expense, recorded a second after the one before it.
 *
 * The clock has to move, because `byCreation` is a comparison of timestamps and everything written
 * inside one millisecond ties. A tie is broken by row id, and an id's second half is random (see
 * `newObjectId`) — so a test that wrote three expenses instantly and asserted their order would be
 * asserting a coin toss. Moving the clock is also what actually happens: expenses are added one at
 * a time, by hand.
 */
let clock = 0;
const spend = (
  dateKey: string,
  minor: number,
  extra: { description?: string; category?: string | null; currency?: string } = {},
) => {
  vi.setSystemTime(new Date(Date.UTC(2026, 8, 22, 10, 0, clock++)));
  return createPluginRecord(
    PLUGIN_ID,
    'record',
    dateKey,
    expenseData({
      minor,
      currency: extra.currency ?? 'EUR',
      description: extra.description ?? '',
      category: extra.category ?? null,
    }),
  );
};

/** A renamed starter, which is the only way a builtin category gets a row of its own. */
const rename = (builtin: 'groceries' | 'transport', name: string) =>
  createPluginRecord(
    PLUGIN_ID,
    'record',
    UNDATED_KEY,
    categoryData({ builtin, name, retired: false }),
  );

const dayBlock = async (dateKey: string, range: PluginExportRange = ALL) => {
  const { days } = await exportExpensesDayLines(range);
  return (days.get(dateKey) ?? []).join('\n');
};

const section = async (range: PluginExportRange = ALL) => {
  const sections = await exportExpensesMarkdown(range);
  expect(sections).toHaveLength(1);
  expect(sections[0].filename).toBe('expenses.md');
  return sections[0].markdown;
};

beforeEach(async () => {
  // Date only: fake-indexeddb runs on real timers, the same split habits/markdown.test.ts uses.
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = 0;
  i18n.addResourceBundle('en', 'translation', { plugins: { expenses: en } }, true, true);
  await i18n.changeLanguage('en');
  await db.pluginRecords.clear();
  await db.outbox.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the block under a day', () => {
  it("leads with the day's total, then one line per expense", async () => {
    await spend('2026-09-21', 3100, {
      description: 'Lunch',
      category: builtinCategoryId('eatingOut'),
    });
    await spend('2026-09-21', 990, {
      description: 'Milk',
      category: builtinCategoryId('groceries'),
    });

    expect(await dayBlock('2026-09-21')).toBe(
      ['Expenses (€40.90):', '- €31.00: Lunch (Eating out)', '- €9.90: Milk (Groceries)'].join(
        '\n',
      ),
    );
  });

  it('leaves no punctuation behind for a missing description or category', async () => {
    await spend('2026-09-21', 400, { category: builtinCategoryId('transport') });
    await spend('2026-09-21', 500, { description: 'Something' });
    await spend('2026-09-21', 600);

    expect(await dayBlock('2026-09-21')).toBe(
      ['Expenses (€15.00):', '- €4.00 (Transport)', '- €5.00: Something', '- €6.00'].join('\n'),
    );
  });

  it('states each currency separately on a day that mixed them', async () => {
    await spend('2026-09-21', 3100, { currency: 'CNY', description: 'Lunch' });
    await spend('2026-09-21', 500, { currency: 'EUR', description: 'Coffee' });

    // Never "€36.00". There is no rate in this plugin, and a total made of an invented one looks
    // exact and isn't.
    expect(await dayBlock('2026-09-21')).toContain('Expenses (CN¥31.00 · €5.00):');
  });

  it('uses a renamed category by its new name', async () => {
    await rename('groceries', 'Food shop');
    await spend('2026-09-21', 990, {
      description: 'Milk',
      category: builtinCategoryId('groceries'),
    });

    expect(await dayBlock('2026-09-21')).toContain('- €9.90: Milk (Food shop)');
  });

  it('explains its own notation, but only while there is something to explain', async () => {
    await spend('2026-09-21', 990, { description: 'Milk' });

    const { note, days } = await exportExpensesDayLines(ALL);
    expect(days.size).toBe(1);
    expect(note?.join('\n')).toContain('## Expense lines');
    expect(note?.join('\n')).toContain('`- <amount>: <description> (<category>)`');

    // Out of range there are no lines, so the collector has nothing to attach a note to — it drops
    // the note itself (see collectPluginMarkdown); here the days map going empty is what says so.
    expect((await exportExpensesDayLines({ from: '2026-10-01', to: null })).days.size).toBe(0);
  });

  it('gives a day outside the range no block at all', async () => {
    await spend('2026-09-01', 100);
    await spend('2026-09-21', 200);

    const { days } = await exportExpensesDayLines({ from: '2026-09-10', to: '2026-09-30' });
    expect([...days.keys()]).toEqual(['2026-09-21']);
  });
});

describe('the totals table', () => {
  it('pivots categories against months, with a total on both edges', async () => {
    await spend('2026-08-03', 1000, { category: builtinCategoryId('groceries') });
    await spend('2026-09-04', 2000, { category: builtinCategoryId('groceries') });
    await spend('2026-09-05', 500, { category: builtinCategoryId('transport') });

    const text = await section();
    expect(text).toContain('| Category | 2026-08 | 2026-09 | Total |');
    expect(text).toContain('| Groceries | €10.00 | €20.00 | €30.00 |');
    // An em dash, not €0.00: nothing was filed there that month, which is not the same as a zero
    // someone recorded.
    expect(text).toContain('| Transport | — | €5.00 | €5.00 |');
    expect(text).toContain('| Total | €10.00 | €25.00 | €35.00 |');
  });

  it('leaves out every category nothing was filed under', async () => {
    await spend('2026-09-04', 2000, { category: builtinCategoryId('groceries') });

    const text = await section();
    expect(text).toContain('| Groceries |');
    // The starter set has ten of these. A row of dashes per unused one would be most of the table.
    expect(text).not.toContain('| Leisure |');
    expect(text).not.toContain('| Gifts |');
    expect(text).not.toContain('No category');
  });

  it('collects what has no category, and what has a category that no longer exists', async () => {
    await spend('2026-09-04', 100);
    await spend('2026-09-04', 200, { category: 'a-row-that-was-deleted' });
    await spend('2026-09-05', 700, { category: builtinCategoryId('groceries') });

    const text = await section();
    // Both land in the same row: the difference between "never filed" and "filed under something
    // since deleted" is real, and not one the reader can act on.
    expect(text).toContain('| No category | €3.00 | €3.00 |');
    // And it sorts after the real categories rather than among them.
    expect(text.indexOf('| Groceries |')).toBeLessThan(text.indexOf('| No category |'));
  });

  it('gives each currency its own table rather than one impossible total', async () => {
    await spend('2026-09-04', 3100, { currency: 'CNY', category: builtinCategoryId('groceries') });
    await spend('2026-09-05', 500, { currency: 'EUR', category: builtinCategoryId('groceries') });

    const text = await section();
    expect(text).toContain('#### Chinese Yuan (CNY)');
    expect(text).toContain('#### Euro (EUR)');
    expect(text).toContain('| Groceries | CN¥31.00 | CN¥31.00 |');
    expect(text).toContain('| Groceries | €5.00 | €5.00 |');
    expect(text).toContain('never converted between currencies');
  });

  it('says nothing about currency when there is only the one', async () => {
    await spend('2026-09-04', 500, { category: builtinCategoryId('groceries') });

    const text = await section();
    // Every amount in the table already carries its symbol; a heading naming the currency over a
    // single table is a line that tells the reader what it can already see.
    expect(text).not.toContain('####');
    expect(text).not.toContain('never converted between currencies');
  });

  it('counts only the months inside the range', async () => {
    await spend('2026-08-03', 1000, { category: builtinCategoryId('groceries') });
    await spend('2026-09-04', 2000, { category: builtinCategoryId('groceries') });

    const text = await section({ from: '2026-09-01', to: '2026-09-30' });
    expect(text).toContain('| Category | 2026-09 | Total |');
    expect(text).not.toContain('2026-08');
    expect(text).toContain('| Groceries | €20.00 | €20.00 |');
  });

  it('contributes no section at all when the range holds no spending', async () => {
    await spend('2026-09-04', 2000);
    expect(await exportExpensesMarkdown({ from: '2026-10-01', to: '2026-10-31' })).toEqual([]);
  });
});
