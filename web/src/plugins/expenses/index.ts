import i18n from '@/i18n';
import type { PluginModule } from '../types';
import { formatMinor } from './currency';
import { ExpensesCalendarView } from './ExpensesCalendarView';
import { ExpensesDayWidget } from './ExpensesDayWidget';
import ExpensesPage from './ExpensesPage';
import { ExpensesSettingsSection } from './ExpensesSettingsSection';
import { exportExpensesDayLines, exportExpensesMarkdown } from './markdown';
import { parseCategoryRow, parseExpense } from './model';
import { expensesOnboardingSteps } from './onboarding/steps';

/* The expense tracker. Six surfaces, matching the `surfaces` list in ../registry: the day card is
   "what did today cost", the page is "what did the month come to, and where did it go", the calendar
   is the same question at a glance, the settings card holds the one synced preference (the default
   currency), the export is a plain table, and the tour shows all of it before it's switched on.
   Deliberately no notifications — a nudge to log spending is a nudge to feel watched — and no
   Android widget. */

const expenses: PluginModule = {
  DayWidget: ExpensesDayWidget,
  Page: ExpensesPage,
  SettingsSection: ExpensesSettingsSection,
  /* Both halves of the `export` surface: what was spent on a day goes under that day, and the
     totals that no single day can show go in a section at the end. See markdown.ts. */
  exportDayLines: exportExpensesDayLines,
  exportMarkdown: exportExpensesMarkdown,
  CalendarView: ExpensesCalendarView,
  describeRecord: (record) => {
    const expense = parseExpense(record);
    if (expense) {
      const amount = formatMinor(expense.minor, expense.currency, i18n.language);
      return expense.description ? `${amount} · ${expense.description}` : amount;
    }
    const category = parseCategoryRow(record);
    if (category) {
      const name =
        category.name ??
        (category.builtin ? i18n.t(`plugins.expenses.category.${category.builtin}`) : '');
      return i18n.t('plugins.expenses.categoryRecord', { name });
    }
    return record.dateKey;
  },
  onboardingSteps: expensesOnboardingSteps,
};

export default expenses;
