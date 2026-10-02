import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Hash,
  Plus,
  Tags,
  TriangleAlert,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateKey, todayKey } from '@/lib/dates';
import { notifyError, notifySuccess } from '@/lib/notify';
import { captureError } from '@/lib/telemetry';
import { CategoriesDialog } from './CategoriesDialog';
import { CategoryBars, monthLabel, MonthlyColumns, MonthProgress } from './charts';
import { currencyName, formatMinor } from './currency';
import { ExpenseRow } from './ExpensesDayWidget';
import { CurrencyPicker, ExpenseForm, useCategoryLabel } from './ExpenseForm';
import type { Category, Expense } from './model';
import { RatesExplorer } from './RatesExplorer';
import {
  convertExpenses,
  ratesAreStale,
  useExchangeRates,
  type ConvertedExpenses,
  type ExchangeRates,
} from './rates';
import {
  categoryBreakdown,
  currenciesUsed,
  type CategoryTotal,
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
  resolveDefaultCurrency,
  resolveDisplayCurrency,
  saveExpenseSettings,
  useExpenseSettings,
  type ExpenseSettings,
} from './useExpenses';

/**
 * The expense tracker's own screen: one month at a time — what it came to, how it compares to the
 * months around it, where it went, and every expense in it.
 *
 * A month rather than a running balance or a rolling 30 days, because a month is how most people
 * are paid and billed, so it is the unit "what did that come to" is naturally asked in.
 *
 * Everything is shown in one currency by default — the display currency, picked here and synced —
 * with expenses paid in any other converted at the latest exchange rates this device has (see
 * rates.ts). The page says when that's happened and how old the rates are, and warns once they're
 * over a week old. Each row still shows what was actually paid, with the converted figure beneath.
 *
 * With more than one currency in use, a second switch shows them separately instead: one currency
 * at a time, everything below the switcher in that currency only, nothing converted — the way this
 * page worked before conversion existed, for anyone who'd rather see exact figures.
 */
export default function ExpensesPage() {
  const { t, i18n } = useTranslation();
  const today = todayKey();
  const currentMonth = monthOf(today);
  const { expenses, loading } = useAllExpenses();
  const categoriesState = useCategories();
  const settings = useExpenseSettings();
  const defaultCurrency = resolveDefaultCurrency(settings);
  const periods = useActivePeriods();
  const [month, setMonth] = useState(currentMonth);
  const [pickedCurrency, setPickedCurrency] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  /* Undefined for no filter; null filters to expenses without a category. */
  const [pickedCategory, setPickedCategory] = useState<string | null | undefined>(undefined);

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
  /* With a single currency there is nothing to show separately, so a saved "separate" is moot —
     and the display currency still applies, for someone who wants their euros shown in dollars. */
  const combined = settings.view === 'combined' || currencies.length <= 1;
  const displayCurrency = useMemo(
    () => resolveDisplayCurrency(settings, expenses),
    [settings, expenses],
  );
  /* Always asks (at most twice a day) rather than only when something needs converting, unlike the
     calendar: the page also carries the rates explorer, which is worth fresh rates on its own. */
  const rates = useExchangeRates(true);
  const conversion = useMemo(
    () => (combined ? convertExpenses(expenses, displayCurrency, rates) : null),
    [combined, expenses, displayCurrency, rates],
  );
  /* What every figure and chart is computed from. Combined, it is every expense already in the
     display currency, so the stats below run exactly as they do for a diary kept in one. */
  const counted = conversion?.expenses ?? expenses;
  const currency = combined
    ? displayCurrency
    : pickedCurrency && currencies.includes(pickedCurrency)
      ? pickedCurrency
      : currencies[0];

  const summary = useMemo(
    () => monthSummary(counted, currency, month, today, periods),
    [counted, currency, month, today, periods],
  );
  /* The chart's twelve months stay put while the picked month is anywhere inside the last year, so
     clicking a column doesn't slide the chart out from under the pointer. Browsing further back
     re-centres it on the picked month instead. */
  const chartEnd = month >= shiftMonth(currentMonth, -11) ? currentMonth : shiftMonth(month, 6);
  const totals = useMemo(
    () => monthlyTotals(counted, currency, chartEnd),
    [counted, currency, chartEnd],
  );
  const breakdown = useMemo(
    () => categoryBreakdown(counted, currency, month),
    [counted, currency, month],
  );
  /* Only while this month has that category, so moving to a month without it shows everything
     rather than an empty list with no bar left to click off. */
  const categoryFilter = breakdown.some((item) => item.category === pickedCategory)
    ? pickedCategory
    : undefined;
  /* The list shows what was paid, so it is built from the originals: in combined mode every one of
     them (including any with no rate, which the totals leave out and the notice names), and
     separately only the currency on screen. */
  const days = useMemo(() => {
    const byDay = new Map<string, Expense[]>();
    for (const expense of expenses) {
      if (monthOf(expense.dateKey) !== month) continue;
      if (!combined && expense.currency !== currency) continue;
      if (categoryFilter !== undefined && expense.category !== categoryFilter) continue;
      const list = byDay.get(expense.dateKey) ?? [];
      list.push(expense);
      byDay.set(expense.dateKey, list);
    }
    // Most recent day first, the order a history is read in; within a day, the order they happened.
    return [...byDay].sort(([a], [b]) => b.localeCompare(a));
  }, [expenses, combined, currency, month, categoryFilter]);
  /* Each expense's amount in the display currency, by id — for the rows and the day totals. */
  const convertedById = useMemo(
    () => new Map((conversion?.expenses ?? []).map((expense) => [expense.id, expense.minor])),
    [conversion],
  );

  const tell = (error: unknown) => {
    captureError(error, { scope: 'plugin.expenses.write' });
    notifyError(t('plugins.expenses.saveFailed'));
  };
  /* For form submits: reported *and* rethrown, so a form whose save failed keeps what was typed. */
  const report = (error: unknown): never => {
    tell(error);
    throw error;
  };
  const saveSettings = (patch: Partial<ExpenseSettings>) =>
    void saveExpenseSettings(patch).catch(tell);

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
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {currencies.length > 1 && (
                <Tabs
                  value={combined ? 'combined' : 'separate'}
                  onValueChange={(view) =>
                    saveSettings({ view: view === 'separate' ? 'separate' : 'combined' })
                  }
                >
                  <TabsList aria-label={t('plugins.expenses.viewSwitcher')}>
                    <TabsTrigger value="combined">{t('plugins.expenses.viewCombined')}</TabsTrigger>
                    <TabsTrigger value="separate">{t('plugins.expenses.viewSeparate')}</TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
              {combined ? (
                <CurrencyPicker
                  value={displayCurrency}
                  onChange={(next) => {
                    if (next !== displayCurrency) saveSettings({ displayCurrency: next });
                  }}
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      aria-label={t('plugins.expenses.displayCurrencyLabel', {
                        currency: currencyName(displayCurrency, i18n.language),
                      })}
                    >
                      <span className="font-mono text-xs">{displayCurrency}</span>
                      <ChevronsUpDown className="size-3.5 text-muted-foreground" />
                    </Button>
                  }
                />
              ) : (
                <Tabs value={currency} onValueChange={setPickedCurrency}>
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
          </div>

          {conversion && <RatesNotice conversion={conversion} rates={rates} today={today} />}

          <SummaryCard summary={summary} currency={currency} />

          <div className="rounded-xl border bg-card p-4 shadow-xs">
            <MonthProgress expenses={counted} currency={currency} month={month} today={today} />
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
            {/* Side by side, the category list mustn't set the row's height: taken out of flow, it
                fills whatever height the monthly chart gives the row and scrolls within it. */}
            <div className="relative rounded-xl border bg-card shadow-xs">
              <div className="flex max-h-80 flex-col p-4 md:absolute md:inset-0 md:max-h-none">
                {breakdown.length > 0 ? (
                  <CategoryBars
                    breakdown={breakdown}
                    byId={categoriesState.byId}
                    currency={currency}
                    selected={categoryFilter}
                    onSelect={(category) =>
                      setPickedCategory(category === categoryFilter ? undefined : category)
                    }
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('plugins.expenses.nothingThisMonth')}
                  </p>
                )}
              </div>
            </div>
          </div>

          {breakdown.length > 0 && (
            <CategoryFilter
              value={categoryFilter}
              onChange={setPickedCategory}
              categories={categoriesState.categories}
              breakdown={breakdown}
            />
          )}

          {days.length > 0 && (
            // Capped at the viewport so a busy month scrolls in place instead of stretching the page.
            <ul className="max-h-[70vh] space-y-3 overflow-y-auto overscroll-contain">
              {days.map(([dateKey, dayExpenses]) => (
                <DayGroup
                  key={dateKey}
                  dateKey={dateKey}
                  expenses={dayExpenses}
                  byId={categoriesState.byId}
                  onEdit={setEditing}
                  display={combined ? { currency, convertedById } : undefined}
                />
              ))}
            </ul>
          )}

          {!ratesAreStale(rates, today) && (
            <RatesExplorer
              rates={rates}
              displayCurrency={displayCurrency}
              currencies={currencies}
            />
          )}
        </div>
      )}
    </PageContainer>
  );
}

const ALL = '__all__';
const NO_CATEGORY = '__none__';

/**
 * What the list below is narrowed to — the same choice as clicking a category's bar. Every category
 * is offered so the list of choices doesn't reshuffle from month to month, but only the ones with
 * something this month can be picked. Retired ones are left out unless the month still has some.
 */
function CategoryFilter({
  value,
  onChange,
  categories,
  breakdown,
}: {
  value: string | null | undefined;
  onChange: (category: string | null | undefined) => void;
  categories: readonly Category[];
  breakdown: readonly CategoryTotal[];
}) {
  const { t } = useTranslation();
  const labelOf = useCategoryLabel();
  const present = new Set(breakdown.map((item) => item.category));
  const offered = categories.filter((category) => !category.retired || present.has(category.id));

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span id="expense-list-filter">{t('plugins.expenses.listFilterLabel')}</span>
      <Select
        value={value === undefined ? ALL : (value ?? NO_CATEGORY)}
        onValueChange={(next) =>
          onChange(next === ALL ? undefined : next === NO_CATEGORY ? null : next)
        }
      >
        <SelectTrigger size="sm" aria-labelledby="expense-list-filter" className="text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('plugins.expenses.allCategories')}</SelectItem>
          {offered.map((category) => {
            const Icon = category.icon;
            return (
              <SelectItem
                key={category.id}
                value={category.id}
                disabled={!present.has(category.id)}
              >
                <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                {labelOf(category)}
              </SelectItem>
            );
          })}
          <SelectItem value={NO_CATEGORY} disabled={!present.has(null)}>
            {t('plugins.expenses.uncategorized')}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * What the combined figures are built on: the date of the rates, and a warning once they're more
 * than a week old. Only shown when something was actually converted — a diary in one currency,
 * shown in that currency, has nothing to explain. Currencies the rates don't cover are named,
 * since their expenses are listed but can't be in any total.
 */
function RatesNotice({
  conversion,
  rates,
  today,
}: {
  conversion: ConvertedExpenses;
  rates: ExchangeRates;
  today: string;
}) {
  const { t, i18n } = useTranslation();
  if (!conversion.converted && conversion.unconverted.length === 0) return null;
  const date = formatDateKey(rates.date, i18n.language, 'PPP');
  const stale = ratesAreStale(rates, today);

  return (
    <div className="space-y-1 text-xs">
      {conversion.converted &&
        (stale ? (
          <p
            role="status"
            className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300"
          >
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            {t('plugins.expenses.ratesStale', { date })}
          </p>
        ) : (
          <p className="text-muted-foreground">{t('plugins.expenses.ratesNote', { date })}</p>
        ))}
      {conversion.unconverted.length > 0 && (
        <p className="text-muted-foreground">
          {t('plugins.expenses.ratesMissing', {
            count: conversion.unconverted.length,
            currencies: conversion.unconverted.join(', '),
          })}
        </p>
      )}
    </div>
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
  display,
}: {
  dateKey: string;
  expenses: readonly Expense[];
  byId: ReadonlyMap<string, Category>;
  onEdit: (expense: Expense) => void;
  /** Present in combined mode: the currency the page is in, and each expense's amount in it. */
  display?: { currency: string; convertedById: ReadonlyMap<string, number> };
}) {
  const { t, i18n } = useTranslation();
  const format = (minor: number, code: string) => formatMinor(minor, code, i18n.language);
  const inDisplay = (expense: Expense) => display?.convertedById.get(expense.id);
  /* Paid in another currency and converted — what gets the secondary figure and the "≈". */
  const wasConverted = (expense: Expense) =>
    display !== undefined &&
    expense.currency !== display.currency &&
    inDisplay(expense) !== undefined;

  let totals: string[];
  if (display) {
    /* One total in the display currency — marked approximate if any of it was converted — then,
       separately, anything with no rate, so no money spent that day goes unmentioned. */
    const counted = expenses.filter((expense) => inDisplay(expense) !== undefined);
    const leftOver = expenses.filter((expense) => inDisplay(expense) === undefined);
    const total = format(
      counted.reduce((sum, expense) => sum + inDisplay(expense)!, 0),
      display.currency,
    );
    totals = [
      ...(counted.length === 0
        ? []
        : [
            counted.some(wasConverted)
              ? t('plugins.expenses.approximately', { amount: total })
              : total,
          ]),
      ...[...sumByCurrency(leftOver)].map(([code, minor]) => format(minor, code)),
    ];
  } else {
    totals = [...sumByCurrency(expenses)].map(([code, minor]) => format(minor, code));
  }
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
            converted={
              wasConverted(expense) ? format(inDisplay(expense)!, display!.currency) : undefined
            }
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
