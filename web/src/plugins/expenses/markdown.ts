import { getUndatedRecords } from '@/db/pluginRecords';
import i18n from '@/i18n';
import { formatMinor } from './currency';
import { PLUGIN_ID, resolveCategories, type Category } from './model';
import { readAllExpenses } from './useExpenses';

/** A pipe inside a description would end its table cell early. */
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/**
 * Every expense as a Markdown table, oldest first — one row per expense, in its own currency.
 *
 * Deliberately no totals row: with more than one currency in play there is no single honest total
 * to put there, and a reader who wants one has the whole table to sum.
 */
export async function exportExpensesMarkdown(): Promise<{ filename: string; markdown: string }[]> {
  const [expenses, undated] = await Promise.all([readAllExpenses(), getUndatedRecords(PLUGIN_ID)]);
  if (!expenses.length) return [];

  const categories = new Map(resolveCategories(undated).map((c) => [c.id, c]));
  const t = i18n.t.bind(i18n);
  const categoryName = (category: Category | undefined) =>
    category ? (category.name ?? t(`plugins.expenses.category.${category.builtinKey}`)) : '';

  const header = `| ${t('plugins.expenses.dateColumn')} | ${t('plugins.expenses.descriptionColumn')} | ${t('plugins.expenses.categoryColumn')} | ${t('plugins.expenses.amountColumn')} |`;
  const divider = '| --- | --- | --- | ---: |';
  const body = expenses.map((expense) => {
    const category = expense.category ? categories.get(expense.category) : undefined;
    return `| ${expense.dateKey} | ${cell(expense.description)} | ${cell(categoryName(category))} | ${formatMinor(expense.minor, expense.currency, i18n.language)} |`;
  });

  return [
    {
      filename: 'expenses.md',
      markdown: [`## ${t('plugins.expenses.title')}`, '', header, divider, ...body].join('\n'),
    },
  ];
}
