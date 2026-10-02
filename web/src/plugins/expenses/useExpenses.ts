import { UNDATED_KEY, type PluginRecordDto } from '@diary/shared';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { db } from '@/db/db';
import {
  createPluginRecord,
  deletePluginRecord,
  getDayRecords,
  getUndatedRecords,
  updatePluginRecord,
} from '@/db/pluginRecords';
import { onSyncApplied } from '@/db/sync';
import {
  getPluginActivePeriods,
  getPluginSettings,
  savePluginSettings,
  type ActivePeriod,
} from '@/plugins/enabled';
import { guessCurrency, isCurrencyCode } from './currency';
import {
  byCreation,
  categoryData,
  expenseData,
  parseExpense,
  PLUGIN_ID,
  resolveCategories,
  type Category,
  type Expense,
  type ExpenseInput,
} from './model';

/* --- Local change notifications ---------------------------------------------------------------
   `onSyncApplied` covers what another device wrote. This covers what *this* one did: the day card
   and the plugin page can both be mounted (a wide layout, or the tour over a real page), and an
   expense added in one must show in the other without waiting for a sync round-trip. */

const changeListeners = new Set<() => void>();
const announceChange = () => {
  for (const listener of changeListeners) listener();
};

/** Re-run `reload` whenever this plugin's rows change, from here or from a sync. */
function useReloadOnChange(reload: () => void) {
  useEffect(() => {
    reload();
    changeListeners.add(reload);
    const unsubscribe = onSyncApplied(reload);
    return () => {
      changeListeners.delete(reload);
      unsubscribe();
    };
  }, [reload]);
}

/* --- Settings ----------------------------------------------------------------------------------
   Synced, in the plugin's config row: which currency a diary is kept in is a fact about the diary,
   not about the phone — the laptop pre-filling dollars while the phone pre-fills euros would be the
   kind of bug that quietly splits a month's total in two. Held in a module-level store so the
   settings card, the page and every open form move together the moment one changes.

   `currency` is what new expenses start in: a code, or — absent or null — "whatever I used last",
   which is `lastCurrency`, recorded on every save the way the composer records `lastImportance`.
   Absent means "last used" because that is the default now; a diary that picked a currency before
   this existed has it stored and keeps it. `lastCurrency` is synced too, so the phone remembers the
   euros the laptop just used.

   `displayCurrency` and `view` are the page's: which currency the combined figures are shown in, and
   whether they are combined at all. Absent means automatic — see `resolveDisplayCurrency`. */

export type ExpensesView = 'combined' | 'separate';

export interface ExpenseSettings {
  /** A fixed default for new expenses, or null for "whatever I used last". */
  currency: string | null;
  lastCurrency: string | null;
  /** Null until picked on the page. */
  displayCurrency: string | null;
  view: ExpensesView;
}

const code = (value: unknown): string | null =>
  typeof value === 'string' && isCurrencyCode(value) ? value : null;

export function parseExpenseSettings(raw: Record<string, unknown>): ExpenseSettings {
  return {
    currency: code(raw.currency),
    lastCurrency: code(raw.lastCurrency),
    displayCurrency: code(raw.displayCurrency),
    view: raw.view === 'separate' ? 'separate' : 'combined',
  };
}

const EMPTY_SETTINGS: ExpenseSettings = parseExpenseSettings({});

let settings: ExpenseSettings | null = null;
const settingsListeners = new Set<() => void>();

function publishSettings(next: ExpenseSettings) {
  if (
    settings &&
    next.currency === settings.currency &&
    next.lastCurrency === settings.lastCurrency &&
    next.displayCurrency === settings.displayCurrency &&
    next.view === settings.view
  ) {
    return;
  }
  settings = next;
  for (const listener of settingsListeners) listener();
}

async function refreshSettings(): Promise<ExpenseSettings> {
  publishSettings(parseExpenseSettings(await getPluginSettings(PLUGIN_ID)));
  return settings!;
}

const subscribeSettings = (listener: () => void) => {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
};

/** Only exported for tests, which need a fresh read per case. */
export const resetExpenseSettingsCache = () => {
  settings = null;
};

/** Write some settings, showing them here at once rather than after the round-trip. */
export async function saveExpenseSettings(patch: Partial<ExpenseSettings>): Promise<void> {
  publishSettings({ ...(settings ?? (await refreshSettings())), ...patch });
  await savePluginSettings(PLUGIN_ID, patch);
}

/** What the composer's "remember last used" does for importance, for currency. Only writes when
    it changed, which is rarely — most expenses are in the same currency as the last one. */
async function rememberCurrency(currency: string): Promise<void> {
  const current = settings ?? (await refreshSettings());
  if (current.lastCurrency === currency) return;
  await saveExpenseSettings({ lastCurrency: currency });
}

export function useExpenseSettings(): ExpenseSettings {
  const current = useSyncExternalStore(subscribeSettings, () => settings);

  useEffect(() => {
    void refreshSettings();
    return onSyncApplied(() => void refreshSettings());
  }, []);

  // Defaults stand in for the first frame, before the config row has been read.
  return current ?? EMPTY_SETTINGS;
}

/** The currency a new expense starts in: the fixed default, else the last one used, else a guess
    from the browser's locale for a diary that has never recorded anything. */
export const resolveDefaultCurrency = (s: ExpenseSettings): string =>
  s.currency ?? s.lastCurrency ?? guessCurrency();

export const useDefaultCurrency = (): string => resolveDefaultCurrency(useExpenseSettings());

/**
 * The currency the page combines everything into, unless one was picked there: the fixed default if
 * there is one, otherwise whichever currency most expenses were recorded in. Deliberately *not* the
 * last one used — one coffee bought abroad shouldn't re-denominate the whole page.
 */
export function resolveDisplayCurrency(s: ExpenseSettings, expenses: readonly Expense[]): string {
  if (s.displayCurrency) return s.displayCurrency;
  if (s.currency) return s.currency;
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const expense of expenses) {
    const count = (counts.get(expense.currency) ?? 0) + 1;
    counts.set(expense.currency, count);
    if (!best || count > counts.get(best)!) best = expense.currency;
  }
  return best ?? resolveDefaultCurrency(s);
}

/* --- Categories -------------------------------------------------------------------------------- */

export interface CategoriesState {
  /** Every category, retired ones included — an old expense still has to show its name. */
  categories: readonly Category[];
  byId: ReadonlyMap<string, Category>;
  loading: boolean;
  addCategory: (name: string, icon?: string | null) => Promise<string>;
  renameCategory: (category: Category, name: string) => Promise<void>;
  setRetired: (category: Category, retired: boolean) => Promise<void>;
  /** A Lucide icon name, or null to go back to the category's default. */
  setIcon: (category: Category, icon: string | null) => Promise<void>;
  /**
   * Only for a category no expense uses — see CategoriesDialog. Resolves to what puts it back.
   *
   * A custom category's row is deleted; a starter gets a `deleted` override instead, since it has
   * no row of its own to delete (see model.ts).
   */
  deleteCategory: (category: Category) => Promise<() => Promise<void>>;
}

export function useCategories(): CategoriesState {
  const [rows, setRows] = useState<PluginRecordDto[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    void getUndatedRecords(PLUGIN_ID).then((next) => {
      setRows(next);
      setLoading(false);
    });
  }, []);
  useReloadOnChange(reload);

  const categories = useMemo(() => resolveCategories(rows), [rows]);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  /* A starter with no row yet gets one on its first edit; after that, edits go to the row. Every
     edit writes the whole category — name, icon, retired, deleted — so the row is always complete.
     Resolves to the row's id, which a starter's first edit has only just created. */
  const writeCategory = useCallback(
    async (
      category: Category,
      patch: { name?: string | null; retired?: boolean; icon?: string | null; deleted?: boolean },
    ): Promise<string> => {
      const data = categoryData({
        builtin: category.builtinKey,
        name: patch.name !== undefined ? patch.name : category.name,
        retired: patch.retired ?? category.retired,
        icon: patch.icon !== undefined ? patch.icon : category.iconName,
        deleted: patch.deleted ?? false,
      });
      let rowId = category.rowId;
      if (rowId) await updatePluginRecord(rowId, data);
      else rowId = (await createPluginRecord(PLUGIN_ID, 'record', UNDATED_KEY, data)).id;
      announceChange();
      return rowId;
    },
    [],
  );

  const addCategory = useCallback(async (name: string, icon: string | null = null) => {
    const row = await createPluginRecord(
      PLUGIN_ID,
      'record',
      UNDATED_KEY,
      categoryData({ builtin: null, name, retired: false, icon }),
    );
    announceChange();
    return row.id;
  }, []);

  const renameCategory = useCallback(
    // An empty name on a starter means "back to the translated one"; a custom category has no
    // such fallback, so the caller doesn't offer it.
    async (category: Category, name: string) => {
      await writeCategory(category, {
        name: name.trim() || (category.builtinKey ? null : category.name),
      });
    },
    [writeCategory],
  );

  const setRetired = useCallback(
    async (category: Category, retired: boolean) => {
      await writeCategory(category, { retired });
    },
    [writeCategory],
  );

  const setIcon = useCallback(
    async (category: Category, icon: string | null) => {
      await writeCategory(category, { icon });
    },
    [writeCategory],
  );

  const deleteCategory = useCallback(
    async (category: Category): Promise<() => Promise<void>> => {
      if (category.builtinKey) {
        const rowId = await writeCategory(category, { deleted: true });
        // Back to exactly what it was, on the row that now exists either way.
        return () => writeCategory({ ...category, rowId }, {}).then(() => undefined);
      }
      if (!category.rowId) return async () => {};
      await deletePluginRecord(category.rowId);
      announceChange();
      // A new row, not the old id back — nothing referred to it, which is why it could go.
      return () => addCategory(category.name ?? '', category.iconName).then(() => undefined);
    },
    [writeCategory, addCategory],
  );

  return {
    categories,
    byId,
    loading,
    addCategory,
    renameCategory,
    setRetired,
    setIcon,
    deleteCategory,
  };
}

/* --- Writing expenses ------------------------------------------------------------------------- */

/* Remembering the currency is best-effort: the expense is what was asked for, and a failure to
   update a preference must not turn its save into an error. */
const remember = (currency: string) => void rememberCurrency(currency).catch(() => undefined);

async function createExpense(dateKey: string, input: ExpenseInput): Promise<Expense> {
  const row = await createPluginRecord(PLUGIN_ID, 'record', dateKey, expenseData(input));
  announceChange();
  return parseExpense(row)!;
}

export async function addExpense(dateKey: string, input: ExpenseInput): Promise<Expense> {
  const expense = await createExpense(dateKey, input);
  remember(input.currency);
  return expense;
}

export async function updateExpense(expense: Expense, input: ExpenseInput): Promise<void> {
  await updatePluginRecord(expense.id, expenseData(input));
  announceChange();
  if (input.currency !== expense.currency) remember(input.currency);
}

/** The caller keeps the `Expense` it passed in, which is everything `restoreExpense` needs. */
export async function removeExpense(expense: Expense): Promise<void> {
  await deletePluginRecord(expense.id);
  announceChange();
}

/** Undo for `removeExpense`: the same expense, on the same day. A new row id — nothing refers to an
    expense by id, so nothing can tell. Not a "use" of its currency: undoing a delete shouldn't
   change what the next expense starts in. */
export const restoreExpense = (expense: Expense) => createExpense(expense.dateKey, expense);

/* --- Reading expenses -------------------------------------------------------------------------- */

const parseAll = (rows: readonly PluginRecordDto[]): Expense[] =>
  rows.flatMap((row) => {
    const expense = parseExpense(row);
    return expense ? [expense] : [];
  });

/**
 * One day's expenses, oldest first.
 *
 * `ready` means "these are *this* day's rows". While the next day's read is in flight the previous
 * day's list is still returned — so a card that has one on screen can keep it rather than flash
 * empty — but nothing may decide *what kind* of card to draw from it.
 */
export function useExpenseDay(dateKey: string): { expenses: Expense[]; ready: boolean } {
  const [state, setState] = useState<{ dateKey: string; expenses: Expense[] } | null>(null);

  const reload = useCallback(() => {
    void getDayRecords(PLUGIN_ID, dateKey, dateKey).then((rows) => {
      setState({ dateKey, expenses: parseAll(rows).sort(byCreation) });
    });
  }, [dateKey]);
  useReloadOnChange(reload);

  return { expenses: state?.expenses ?? [], ready: state?.dateKey === dateKey };
}

/**
 * Every expense ever recorded, for the page, the calendar and the export.
 *
 * A whole-table read, the trade the period tracker and habits make for their pages too: the stats
 * look back a year and the calendar can be browsed to any month, and the row count is bounded by
 * MAX_PLUGIN_RECORDS_PER_PLUGIN, so one indexed scan is the simple and sufficient answer.
 */
export function useAllExpenses(): { expenses: Expense[]; loading: boolean } {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);

  const reload = useCallback(() => {
    void readAllExpenses().then(setExpenses);
  }, []);
  useReloadOnChange(reload);

  return { expenses: expenses ?? [], loading: expenses === null };
}

export async function readAllExpenses(): Promise<Expense[]> {
  const rows = await db.pluginRecords
    .where('[pluginId+scope]')
    .equals([PLUGIN_ID, 'record'])
    .toArray();
  return parseAll(rows).sort((a, b) => a.dateKey.localeCompare(b.dateKey) || byCreation(a, b));
}

/** When this plugin has been switched on — what the per-day average is taken over. */
export function useActivePeriods(): ActivePeriod[] {
  const [periods, setPeriods] = useState<ActivePeriod[]>([]);
  useEffect(() => {
    const reload = () => void getPluginActivePeriods(PLUGIN_ID).then(setPeriods);
    reload();
    return onSyncApplied(reload);
  }, []);
  return periods;
}
