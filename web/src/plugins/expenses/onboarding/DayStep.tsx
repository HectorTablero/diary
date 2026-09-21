import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { todayKey } from '@/lib/dates';
import { ExpenseDayCard } from '../ExpensesDayWidget';
import type { Expense } from '../model';
import { demoCategories, demoToday } from './demo';

/**
 * The day page's card, for real — the same `ExpenseDayCard` the diary renders, over in-memory state.
 * Adding, editing and deleting all work and none of it is saved: trying the form is most of what
 * "note it as you pay" means.
 */
export function DayStep() {
  const { t } = useTranslation();
  const categories = useMemo(demoCategories, []);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const [expenses, setExpenses] = useState<Expense[]>(() =>
    demoToday({
      coffee: t('plugins.expenses.onboarding.day.demoCoffee'),
      groceries: t('plugins.expenses.onboarding.day.demoGroceries'),
    }),
  );
  const today = todayKey();

  return (
    <div className="flex flex-col gap-1.5">
      <ExpenseDayCard
        dateKey={today}
        expenses={expenses}
        categories={categories}
        byId={byId}
        defaultCurrency="EUR"
        locked={false}
        onAdd={async (input) => {
          setExpenses((current) => [
            ...current,
            {
              ...input,
              id: `demo-new-${current.length}-${Date.now()}`,
              dateKey: today,
              createdAt: new Date().toISOString(),
            },
          ]);
        }}
        onUpdate={async (expense, input) => {
          setExpenses((current) =>
            current.map((item) => (item.id === expense.id ? { ...item, ...input } : item)),
          );
        }}
        onDelete={async (expense) => {
          setExpenses((current) => current.filter((item) => item.id !== expense.id));
        }}
        onRestore={async (expense) => {
          setExpenses((current) => [...current, expense]);
        }}
      />
      <p className="text-xs text-muted-foreground">
        {t('plugins.expenses.onboarding.previewNote')}
      </p>
    </div>
  );
}
