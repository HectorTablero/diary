import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Hash,
  Plus,
  Tags,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmptyState } from '@/components/common/EmptyState';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateKey, todayKey } from '@/lib/dates';
import { notifyError, notifySuccess } from '@/lib/notify';
import { captureError } from '@/lib/telemetry';
import { CategoriesDialog } from './CategoriesDialog';
import { CategoryBars, monthLabel, MonthlyColumns, MonthProgress } from './charts';
import { formatMinor } from './currency';
import { ExpenseRow } from './ExpensesDayWidget';
import { ExpenseForm } from './ExpenseForm';
import type { Category, Expense } from './model';
import {
  categoryBreakdown,
  currenciesUsed,
  monthlyTotals,
  monthOf,
  monthSummary,
  shiftMonth,
  sumByCurrency,
} from './stats';
import {
  addExpense,
  removeExpense,
  restoreExpense,
  updateExpense,
  useAllExpenses,
  useActivePeriods,
  useCategories,
  useDefaultCurrency,
} from './useExpenses';

/**
 * The expense tracker's own screen: one month at a time — what it came to, how it compares to the
 * months around it, where it went, and every expense in it.
 *
 * A month rather than a running balance or a rolling 30 days, because a month is how most people
 * are paid and billed, so it is the unit "what did that come to" is naturally asked in.
 *
 * With more than one currency in use, a switcher picks which one the page is about; everything
 * below it — the figures, both charts and the list — is that currency only. Mixing them would mean
 * either converting (see currency.ts for why not) or adding euros to yen.
 */
export default function ExpensesPage() {
  const { t, i18n } = useTranslation();
  const today = todayKey();
  const currentMonth = monthOf(today);
  const { expenses, loading } = useAllExpenses();
  const categoriesState = useCategories();
  const [defaultCurrency] = useDefaultCurrency();
  const periods = useActivePeriods();
  const [month, setMonth] = useState(currentMonth);
  const [pickedCurrency, setPickedCurrency] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const expense of expenses) {
      if (expense.category) counts.set(expense.category, (counts.get(expense.category) ?? 0) + 1);
    }
    return counts;
  }, [expenses]);

  const currencies = useMemo(
    () => currenciesUsed(expenses, defaultCurrency),
    [expenses, defaultCurrency],
  );
  const currency =
    pickedCurrency && currencies.includes(pickedCurrency) ? pickedCurrency : currencies[0];

  const summary = useMemo(
    () => monthSummary(expenses, currency, month, today, periods),
    [expenses, currency, month, today, periods],
  );
  /* The chart's twelve months stay put while the picked month is anywhere inside the last year, so
     clicking a column doesn't slide the chart out from under the pointer. Browsing further back
     re-centres it on the picked month instead. */
  const chartEnd = month >= shiftMonth(currentMonth, -11) ? currentMonth : shiftMonth(month, 6);
  const totals = useMemo(
    () => monthlyTotals(expenses, currency, chartEnd),
    [expenses, currency, chartEnd],
  );
  const breakdown = useMemo(
    () => categoryBreakdown(expenses, currency, month),
    [expenses, currency, month],
  );
  const days = useMemo(() => {
    const byDay = new Map<string, Expense[]>();
    for (const expense of expenses) {
      if (expense.currency !== currency || monthOf(expense.dateKey) !== month) continue;
      const list = byDay.get(expense.dateKey) ?? [];
      list.push(expense);
      byDay.set(expense.dateKey, list);
    }
    // Most recent day first, the order a history is read in; within a day, the order they happened.
    return [...byDay].sort(([a], [b]) => b.localeCompare(a));
  }, [expenses, currency, month]);

  const tell = (error: unknown) => {
    captureError(error, { scope: 'plugin.expenses.write' });
    notifyError(t('plugins.expenses.saveFailed'));
  };
  /* For form submits: reported *and* rethrown, so a form whose save failed keeps what was typed. */
  const report = (error: unknown): never => {
    tell(error);
    throw error;
  };

  const remove = async (expense: Expense) => {
    setEditing(null);
    try {
      await removeExpense(expense);
    } catch (error) {
      tell(error);
      return;
    }
    notifySuccess(t('plugins.expenses.deleted'), {
      action: { label: t('common.undo'), onClick: () => void restoreExpense(expense).catch(tell) },
    });
  };

  const header = (
    <PageHeader
      title={t('plugins.expenses.title')}
      actions={
        <>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setManaging(true)}>
            <Tags className="size-3.5" />
            <span className="max-sm:sr-only">{t('plugins.expenses.categoriesButton')}</span>
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            {t('plugins.expenses.addExpense')}
          </Button>
        </>
      }
    />
  );

  return (
    <PageContainer>
      {header}

      <AddExpenseDialog
        open={adding}
        onOpenChange={setAdding}
        defaultCurrency={defaultCurrency}
        categories={categoriesState.categories}
        onSubmit={async (dateKey, input) => {
          await addExpense(dateKey, input).catch(report);
          setAdding(false);
          setMonth(monthOf(dateKey));
          setPickedCurrency(input.currency);
        }}
      />

      <CategoriesDialog
        open={managing}
        onOpenChange={setManaging}
        state={categoriesState}
        usage={usage}
      />

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('plugins.expenses.editTitle')}</DialogTitle>
            {editing && (
              <DialogDescription>
                {formatDateKey(editing.dateKey, i18n.language, 'PPPP')}
              </DialogDescription>
            )}
          </DialogHeader>
          {editing && (
            <ExpenseForm
              key={editing.id}
              idPrefix="expense-edit"
              initial={editing}
              defaultCurrency={defaultCurrency}
              categories={categoriesState.categories}
              onCancel={() => setEditing(null)}
              onDelete={() => void remove(editing)}
              onSubmit={(input) =>
                updateExpense(editing, input).then(() => setEditing(null), report)
              }
            />
          )}
        </DialogContent>
      </Dialog>

      {loading || categoriesState.loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : expenses.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={t('plugins.expenses.empty')}
          description={t('plugins.expenses.emptyPageDescription')}
        >
          <Button size="sm" className="mt-2 gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            {t('plugins.expenses.addExpense')}
          </Button>
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t('plugins.expenses.previousMonth')}
                onClick={() => setMonth((current) => shiftMonth(current, -1))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <h2
                className="min-w-36 text-center text-sm font-medium capitalize"
                aria-live="polite"
              >
                {monthLabel(month, i18n.language)}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t('plugins.expenses.nextMonth')}
                disabled={month >= currentMonth}
                onClick={() => setMonth((current) => shiftMonth(current, 1))}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            {currencies.length > 1 && (
              <Tabs value={currency} onValueChange={setPickedCurrency} className="ml-auto">
                <TabsList aria-label={t('plugins.expenses.currencySwitcher')}>
                  {currencies.map((code) => (
                    <TabsTrigger key={code} value={code}>
                      {code}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}
          </div>

          <SummaryCard summary={summary} currency={currency} />

          <div className="rounded-xl border bg-card p-4 shadow-xs">
            <MonthProgress expenses={expenses} currency={currency} month={month} today={today} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-card p-4 shadow-xs">
              <MonthlyColumns
                totals={totals}
                currency={currency}
                selected={month}
                lastSelectable={currentMonth}
                onSelect={setMonth}
              />
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-xs">
              {breakdown.length > 0 ? (
                <CategoryBars
                  breakdown={breakdown}
                  byId={categoriesState.byId}
                  currency={currency}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('plugins.expenses.nothingThisMonth')}
                </p>
              )}
            </div>
          </div>

          {days.length > 0 && (
            <ul className="space-y-3">
              {days.map(([dateKey, dayExpenses]) => (
                <DayGroup
                  key={dateKey}
                  dateKey={dateKey}
                  expenses={dayExpenses}
                  byId={categoriesState.byId}
                  onEdit={setEditing}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </PageContainer>
  );
}

/** Exported for the tour's page preview, which shows it over made-up numbers. */
export function SummaryCard({
  summary,
  currency,
}: {
  summary: ReturnType<typeof monthSummary>;
  currency: string;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-evenly gap-4 rounded-xl border bg-card p-3 shadow-xs">
      <StatItem
        icon={Wallet}
        label={t('plugins.expenses.monthTotal')}
        value={formatMinor(summary.total, currency, i18n.language)}
      />
      {summary.dailyAverage !== undefined && (
        <StatItem
          icon={CalendarDays}
          label={t('plugins.expenses.dailyAverage', { count: summary.countedDays })}
          value={formatMinor(summary.dailyAverage, currency, i18n.language)}
        />
      )}
      <StatItem
        icon={Hash}
        label={t('plugins.expenses.expenseCountLabel')}
        value={new Intl.NumberFormat(i18n.language).format(summary.count)}
      />
    </div>
  );
}

/** Same shape as the period tracker's stat halves — an icon, a figure, what it counts. */
function StatItem({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold tabular-nums">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function DayGroup({
  dateKey,
  expenses,
  byId,
  onEdit,
}: {
  dateKey: string;
  expenses: readonly Expense[];
  byId: ReadonlyMap<string, Category>;
  onEdit: (expense: Expense) => void;
}) {
  const { i18n } = useTranslation();
  const totals = [...sumByCurrency(expenses)].map(([code, minor]) =>
    formatMinor(minor, code, i18n.language),
  );
  return (
    <li className="rounded-xl border bg-card px-4 py-3 shadow-xs">
      <div className="flex items-center gap-2">
        {/* To the day itself, where the rest of what happened that day is. */}
        <Link
          to={`/diary/${dateKey}`}
          className="flex-1 text-sm font-medium capitalize hover:underline"
        >
          {formatDateKey(dateKey, i18n.language, 'EEEE d')}
        </Link>
        <span className="text-xs text-muted-foreground tabular-nums">{totals.join(' · ')}</span>
      </div>
      <ul className="mt-1 divide-y divide-border/60">
        {expenses.map((expense) => (
          <ExpenseRow
            key={expense.id}
            expense={expense}
            category={expense.category ? byId.get(expense.category) : undefined}
            onEdit={() => onEdit(expense)}
          />
        ))}
      </ul>
    </li>
  );
}

/** Adding from the page, for any day up to today — the day card only ever adds to the day it's on. */
function AddExpenseDialog({
  open,
  onOpenChange,
  defaultCurrency,
  categories,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCurrency: string;
  categories: readonly Category[];
  onSubmit: (dateKey: string, input: Parameters<typeof addExpense>[1]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const today = todayKey();
  const [dateKey, setDateKey] = useState(today);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setDateKey(todayKey());
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('plugins.expenses.addExpense')}</DialogTitle>
          <DialogDescription>{t('plugins.expenses.addExpenseDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="expense-add-date">{t('plugins.expenses.dateLabel')}</Label>
          <DatePicker
            id="expense-add-date"
            value={dateKey}
            max={today}
            onChange={(next) => next && setDateKey(next)}
          />
        </div>
        <ExpenseForm
          idPrefix="expense-add"
          defaultCurrency={defaultCurrency}
          categories={categories}
          autoFocus
          onCancel={() => onOpenChange(false)}
          onSubmit={(input) => onSubmit(dateKey, input)}
        />
      </DialogContent>
    </Dialog>
  );
}
