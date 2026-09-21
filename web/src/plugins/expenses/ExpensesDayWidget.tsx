import { Lock, LockOpen, Wallet } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HintTooltip } from '@/components/common/HintTooltip';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { todayKey } from '@/lib/dates';
import { notifyError, notifySuccess } from '@/lib/notify';
import { captureError } from '@/lib/telemetry';
import { cn } from '@/lib/utils';
import { formatMinor } from './currency';
import { ExpenseForm, useCategoryLabel } from './ExpenseForm';
import type { Category, Expense, ExpenseInput } from './model';
import { sumByCurrency } from './stats';
import {
  addExpense,
  removeExpense,
  restoreExpense,
  updateExpense,
  useCategories,
  useDefaultCurrency,
  useExpenseDay,
} from './useExpenses';

/**
 * The expense card on the day page.
 *
 * When it shows, following the period tracker's rule that a card on every day has to earn it:
 *
 *   - **today**, always — noting what something cost is most useful at the moment it's paid;
 *   - a **past** day, if anything was recorded on it, locked behind the same padlock habits and the
 *     period tracker use. A past day with nothing on it gets a single quiet line instead of a card,
 *     for the coffee remembered a day late; pressing it is the deliberate act the padlock would
 *     otherwise ask for, so the card opens already unlocked;
 *   - a **future** day, never. Nothing has been spent there yet.
 *
 * Amounts are plain text in the foreground colour, however large. A big number in red, or a bar
 * filling towards a limit, is the app passing judgement on a purchase it knows nothing about.
 */
export function ExpensesDayWidget({ dateKey }: { dateKey: string }) {
  const { t } = useTranslation();
  const { expenses, ready } = useExpenseDay(dateKey);
  const { categories, byId, loading: categoriesLoading } = useCategories();
  const [defaultCurrency] = useDefaultCurrency();
  const today = todayKey();
  const isToday = dateKey === today;
  const isPast = dateKey < today;

  /* Both keyed by the day they were set for rather than reset by an effect, so moving to another
     day starts from "locked, not opened" in the same render — with no frame in which one day's
     answer is shown for the next.

     `openedFor` is sticky for the visit, as in the period tracker: deleting the only expense on a
     past day must not make the card — and the Undo that goes with it — vanish from under the tap.
     It is set during render (React's documented pattern for state derived from props) the moment
     this day's own rows arrive with something in them. */
  const [unlockedFor, setUnlockedFor] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (ready && expenses.length > 0 && openedFor !== dateKey) setOpenedFor(dateKey);
  const shown = openedFor === dateKey || (ready && expenses.length > 0);

  if (dateKey > today) return null;
  // `ready`, not "loaded once": until this day's rows are in, `expenses` may still be the previous
  // day's, and deciding what to draw from those is how a day full of expenses showed the empty-day
  // button instead.
  if (!ready || categoriesLoading) return isToday ? <CardSkeleton /> : null;

  if (isPast && !shown) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs text-muted-foreground"
        onClick={() => {
          setOpenedFor(dateKey);
          setUnlockedFor(dateKey);
        }}
      >
        {/* The wallet names the plugin, so the words only have to say what pressing does. */}
        <Wallet className="size-3.5" aria-hidden />
        {t('plugins.expenses.addForgotten')}
      </Button>
    );
  }

  const locked = !isToday && unlockedFor !== dateKey;

  return (
    <ExpenseDayCard
      dateKey={dateKey}
      expenses={expenses}
      categories={categories}
      byId={byId}
      defaultCurrency={defaultCurrency}
      locked={locked}
      action={
        isToday ? undefined : (
          <DayLockButton locked={locked} onToggle={() => setUnlockedFor(locked ? dateKey : null)} />
        )
      }
      onAdd={(input) => addExpense(dateKey, input).then(() => undefined)}
      onUpdate={updateExpense}
      onDelete={removeExpense}
      onRestore={(expense) => restoreExpense(expense).then(() => undefined)}
    />
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="mt-3 h-8 w-full" />
    </div>
  );
}

/**
 * The card itself, with every write passed in — so the tour can render the real thing over
 * in-memory state and nothing it does reaches the database.
 */
export function ExpenseDayCard({
  dateKey,
  expenses,
  categories,
  byId,
  defaultCurrency,
  locked,
  action,
  onAdd,
  onUpdate,
  onDelete,
  onRestore,
}: {
  dateKey: string;
  expenses: readonly Expense[];
  categories: readonly Category[];
  byId: ReadonlyMap<string, Category>;
  defaultCurrency: string;
  locked: boolean;
  action?: ReactNode;
  onAdd: (input: ExpenseInput) => Promise<void>;
  onUpdate: (expense: Expense, input: ExpenseInput) => Promise<void>;
  onDelete: (expense: Expense) => Promise<void>;
  onRestore: (expense: Expense) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    setEditing(null);
  }, [dateKey]);
  // Locking again closes whatever was open, rather than leaving a live form on a locked card.
  useEffect(() => {
    if (locked) setEditing(null);
  }, [locked]);

  const totals = [...sumByCurrency(expenses)].map(([currency, minor]) =>
    formatMinor(minor, currency, i18n.language),
  );

  /* Reports and rethrows: a form handed a rejected submit keeps what was typed rather than clearing
     itself as if it had been saved. Fire-and-forget callers go through `run`, which stops there. */
  const report = (error: unknown): never => {
    captureError(error, { scope: 'plugin.expenses.write' });
    notifyError(t('plugins.expenses.saveFailed'));
    throw error;
  };
  const run = (work: () => Promise<void>) =>
    work()
      .catch(report)
      .catch(() => undefined);

  const remove = (expense: Expense) =>
    run(async () => {
      setEditing(null);
      await onDelete(expense);
      notifySuccess(t('plugins.expenses.deleted'), {
        action: { label: t('common.undo'), onClick: () => void run(() => onRestore(expense)) },
      });
    });

  return (
    <section
      className="rounded-xl border bg-card p-4 shadow-xs"
      aria-labelledby={`expenses-day-title-${dateKey}`}
    >
      <div className="flex items-center gap-2">
        <Wallet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 id={`expenses-day-title-${dateKey}`} className="flex-1 text-sm font-medium">
          {t('plugins.expenses.title')}
        </h2>
        {totals.length > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            <span className="sr-only">{t('plugins.expenses.dayTotal')} </span>
            {totals.join(' · ')}
          </span>
        )}
        {action}
      </div>

      {expenses.length > 0 && (
        <ul className="mt-2 divide-y divide-border/60">
          {expenses.map((expense) =>
            editing === expense.id ? (
              <li key={expense.id} className="py-2.5">
                <ExpenseForm
                  idPrefix={`expense-${expense.id}`}
                  initial={expense}
                  defaultCurrency={defaultCurrency}
                  categories={categories}
                  autoFocus
                  onCancel={() => setEditing(null)}
                  onDelete={() => void remove(expense)}
                  onSubmit={(input) =>
                    onUpdate(expense, input).then(() => setEditing(null), report)
                  }
                />
              </li>
            ) : (
              <ExpenseRow
                key={expense.id}
                expense={expense}
                category={expense.category ? byId.get(expense.category) : undefined}
                onEdit={locked ? undefined : () => setEditing(expense.id)}
              />
            ),
          )}
        </ul>
      )}

      {!locked && editing === null && (
        <div className={cn('mt-3', expenses.length > 0 && 'border-t border-border/60 pt-3')}>
          <ExpenseForm
            key={dateKey}
            idPrefix={`expense-new-${dateKey}`}
            defaultCurrency={defaultCurrency}
            categories={categories}
            onSubmit={(input) => onAdd(input).catch(report)}
          />
        </div>
      )}

      {locked && expenses.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">{t('plugins.expenses.nothingThatDay')}</p>
      )}
    </section>
  );
}

export function ExpenseRow({
  expense,
  category,
  onEdit,
}: {
  expense: Expense;
  category: Category | undefined;
  /** Absent while locked: the row is then plain text rather than a button that does nothing. */
  onEdit?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const labelOf = useCategoryLabel();
  const Icon = category?.icon ?? Wallet;
  const categoryName = labelOf(category);
  const title = expense.description || categoryName;
  const amount = formatMinor(expense.minor, expense.currency, i18n.language);

  const body = (
    <>
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden
      >
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{title}</span>
        {expense.description && category && (
          <span className="block truncate text-xs text-muted-foreground">{categoryName}</span>
        )}
      </span>
      <span className="shrink-0 text-sm tabular-nums">{amount}</span>
    </>
  );

  return (
    <li>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('plugins.expenses.editExpense', { name: title, amount })}
          className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60"
        >
          {body}
        </button>
      ) : (
        <div className="flex items-center gap-3 py-2">{body}</div>
      )}
    </li>
  );
}

/** Own copy of the period tracker's padlock — a plugin doesn't reach into another's internals for
    a component this small. Only ever on a past day: a future day never shows the card at all. */
function DayLockButton({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <HintTooltip
      content={t(locked ? 'plugins.expenses.dayLockedPast' : 'plugins.expenses.dayUnlockedHint')}
    >
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground"
        aria-label={t(locked ? 'plugins.expenses.unlock' : 'plugins.expenses.lock')}
        onClick={onToggle}
      >
        {locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
      </Button>
    </HintTooltip>
  );
}
