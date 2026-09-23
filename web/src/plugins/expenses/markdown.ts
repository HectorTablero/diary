import { getUndatedRecords } from '@/db/pluginRecords';
import i18n from '@/i18n';
import { inExportRange } from '@/plugins/markdown';
import type { PluginDayContribution, PluginExportRange } from '@/plugins/types';
import { currencyName, formatMinor } from './currency';
import { byCreation, PLUGIN_ID, resolveCategories, type Category, type Expense } from './model';
import { readAllExpenses } from './useExpenses';

/**
 * What this plugin contributes to an entries export, in two halves.
 *
 * ## Under each day: what was spent that day
 *
 * The whole ledger used to sit in one table at the end of the document, which put every expense as
 * far as possible from the entry it belongs to. A diary's reader asks "what was this day like",
 * and a day's spending is part of the answer — so it goes under the day, where the question is
 * asked, and the reader never carries a date to another table and back.
 *
 * ## At the end: totals by category and month
 *
 * What is left over is the thing a day cannot show: the shape of a few months' spending. A pivot of
 * categories against months answers that in one screen, where a thousand-row ledger answered it
 * only for a reader willing to add the rows up — and the rows are all upstairs now anyway.
 *
 * Both halves respect the export's range, and neither converts between currencies (see
 * currency.ts): a day's line states each currency separately, and the pivot is one table per
 * currency, because a rate is either fetched or invented and a total made of invented rates looks
 * exact and isn't.
 */

/** A pipe inside a description would end its table cell early. */
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** The month a `dateKey` falls in — `2026-09`, which is also how it sorts and how it prints. Month
    names are deliberately avoided: the rest of the export dates everything in ISO, and a column
    header has no room to say "September" in five languages. */
const monthOf = (dateKey: string) => dateKey.slice(0, 7);

async function readInRange(range: PluginExportRange) {
  const [all, undated] = await Promise.all([readAllExpenses(), getUndatedRecords(PLUGIN_ID)]);
  const expenses = all.filter((expense) => inExportRange(expense.dateKey, range));
  /* Categories are read in full, never clipped. A category is a definition rather than something
     that happened on a day, and a spend inside the range filed under one created before it still
     needs its name. Retired ones are kept for the same reason retired habits are: the money was
     still spent under them. */
  const categories = new Map(resolveCategories(undated).map((c) => [c.id, c]));
  return { expenses, categories };
}

const nameOf = (category: Category | undefined): string =>
  category
    ? (category.name ?? i18n.t(`plugins.expenses.category.${category.builtinKey}`))
    : i18n.t('plugins.expenses.uncategorized');

/**
 * Each currency's total of a set of expenses, by currency code.
 *
 * Sorted by the code rather than left in the order the currencies happen to appear, because "the
 * order they appear" is not an order at all: two expenses written in the same second get ids whose
 * random half decides which Dexie hands back first (see `newObjectId`), so the same export run
 * twice would put the euros first one time and the yuan the next. A document regenerated from
 * unchanged data has to come out byte for byte the same, or every diff of one is noise.
 */
function totalsByCurrency(expenses: readonly Expense[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + expense.minor);
  }
  return new Map([...totals].sort(([a], [b]) => a.localeCompare(b)));
}

/** `byCreation`, with the id breaking a tie. Two expenses added in the same millisecond order
    arbitrarily otherwise — fine on a screen, where they were put in that order and stay in it, and
    not fine in a file that should regenerate identically. */
const forExport = (a: Expense, b: Expense) => byCreation(a, b) || a.id.localeCompare(b.id);

const formatTotals = (totals: ReadonlyMap<string, number>): string =>
  [...totals].map(([currency, minor]) => formatMinor(minor, currency, i18n.language)).join(' · ');

/**
 * One block of lines per day that had an expense, to sit under that day's entries.
 *
 * The day's total leads, so the common question is answered without reading the list; the list
 * follows for the one that isn't. A day mixing currencies states each total separately rather than
 * adding them — see the note at the top of this file.
 */
export async function exportExpensesDayLines(
  range: PluginExportRange,
): Promise<PluginDayContribution> {
  const { expenses, categories } = await readInRange(range);
  const byDay = new Map<string, Expense[]>();
  for (const expense of expenses) {
    const day = byDay.get(expense.dateKey);
    if (day) day.push(expense);
    else byDay.set(expense.dateKey, [expense]);
  }

  const days = new Map<string, readonly string[]>();
  for (const [dateKey, day] of byDay) {
    const lines = day.sort(forExport).map((expense) => {
      const amount = formatMinor(expense.minor, expense.currency, i18n.language);
      const description = expense.description.replace(/\s+/g, ' ').trim();
      const category = expense.category ? categories.get(expense.category) : undefined;
      /* Four shapes, because both halves are optional and an empty one must not leave punctuation
         behind — "- CN¥4.00: ()" is a line that looks like a bug in the exporter rather than an
         expense someone did not bother to describe. */
      const named = description ? `${amount}: ${description}` : amount;
      return category ? `- ${named} (${nameOf(category)})` : `- ${named}`;
    });
    days.set(dateKey, [
      i18n.t('plugins.expenses.exportDayTotal', { total: formatTotals(totalsByCurrency(day)) }),
      ...lines,
    ]);
  }

  /* Notation only: what the fields are and when one is dropped. Not what the plugin is for, not how
     to use it — the reader is parsing a document, not evaluating a feature, and every extra line
     here is one it has to read past on every export. */
  return {
    note: [
      `## ${i18n.t('plugins.expenses.exportNoteHeading')}`,
      '',
      i18n.t('plugins.expenses.exportNote'),
    ],
    days,
  };
}

/**
 * Totals by category and month: categories down the side, months across, a total on both edges.
 *
 * Only rows that hold something appear — a category nothing was ever filed under is a row of zeroes
 * saying only that the category exists, which the app's own settings page says better. Months are
 * the ones the range actually contains spending in, for the same reason: an empty column is a
 * column the reader has to check before dismissing.
 *
 * Expenses with no category, and expenses whose category row has since been deleted, share the one
 * "Uncategorized" row. The distinction between "never filed" and "filed under something now gone"
 * is real but not one the reader can act on, and the money is the same either way.
 */
export async function exportExpensesMarkdown(
  range: PluginExportRange,
): Promise<{ filename: string; markdown: string }[]> {
  const { expenses, categories } = await readInRange(range);
  if (!expenses.length) return [];

  const t = i18n.t.bind(i18n);
  const currencies = [...totalsByCurrency(expenses).keys()];

  const tableFor = (currency: string): string[] => {
    const rows = expenses.filter((expense) => expense.currency === currency);
    const months = [...new Set(rows.map((expense) => monthOf(expense.dateKey)))].sort();

    /* Keyed by category id, with the null key standing for everything uncategorised, and built in
       the order `resolveCategories` lists them — the starters as the app shows them, then custom
       ones oldest first — so the table reads in the same order as the categories page. */
    const sums = new Map<string | null, Map<string, number>>();
    for (const expense of rows) {
      const key = expense.category && categories.has(expense.category) ? expense.category : null;
      const byMonth = sums.get(key) ?? new Map<string, number>();
      const month = monthOf(expense.dateKey);
      byMonth.set(month, (byMonth.get(month) ?? 0) + expense.minor);
      sums.set(key, byMonth);
    }

    const order = [...categories.keys()].filter((id) => sums.has(id));
    // Uncategorised last: it is where things fall when no category fits, not a category itself.
    const keys: (string | null)[] = sums.has(null) ? [...order, null] : order;

    const amount = (minor: number) => formatMinor(minor, currency, i18n.language);
    const line = (label: string, byMonth: ReadonlyMap<string, number>) => {
      const cells = months.map((month) => (byMonth.has(month) ? amount(byMonth.get(month)!) : '—'));
      const total = [...byMonth.values()].reduce((sum, minor) => sum + minor, 0);
      return `| ${cell(label)} | ${cells.join(' | ')} | ${amount(total)} |`;
    };

    const totalRow = new Map<string, number>();
    for (const expense of rows) {
      const month = monthOf(expense.dateKey);
      totalRow.set(month, (totalRow.get(month) ?? 0) + expense.minor);
    }

    return [
      `| ${t('plugins.expenses.categoryColumn')} | ${months.join(' | ')} | ${t('plugins.expenses.exportTotal')} |`,
      `| --- |${months.map(() => ' ---: |').join('')} ---: |`,
      ...keys.map((key) =>
        line(key === null ? nameOf(undefined) : nameOf(categories.get(key)), sums.get(key)!),
      ),
      line(t('plugins.expenses.exportTotal'), totalRow),
    ];
  };

  /* One table per currency, and the reason why stated above them — but only when there is more than
     one. A lone currency needs no heading telling the reader which it is; every amount in the table
     already carries its symbol. */
  const body =
    currencies.length === 1
      ? tableFor(currencies[0])
      : [
          t('plugins.expenses.exportCurrenciesSeparate'),
          '',
          ...currencies.flatMap((currency) => [
            `#### ${currencyName(currency, i18n.language)} (${currency})`,
            '',
            ...tableFor(currency),
            '',
          ]),
        ];

  return [
    {
      filename: 'expenses.md',
      markdown: [
        `## ${t('plugins.expenses.title')}`,
        '',
        `### ${t('plugins.expenses.exportByMonth')}`,
        '',
        ...body,
      ]
        .join('\n')
        .trimEnd(),
    },
  ];
}
