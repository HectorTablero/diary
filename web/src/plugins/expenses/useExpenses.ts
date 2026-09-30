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

/* --- Default currency --------------------------------------------------------------------------
   Synced, in the plugin's config row: which currency a diary is kept in is a fact about the diary,
   not about the phone — the laptop pre-filling dollars while the phone pre-fills euros would be the
   kind of bug that quietly splits a month's total in two. Held in a module-level store so the
   settings card and every open form move together the moment it changes. */

let defaultCurrency: string | null = null;
const currencyListeners = new Set<() => void>();

function publishCurrency(next: string) {
  if (next === defaultCurrency) return;
  defaultCurrency = next;
  for (const listener of currencyListeners) listener();
}

async function refreshDefaultCurrency() {
  const settings = await getPluginSettings(PLUGIN_ID);
  const stored = typeof settings.currency === 'string' ? settings.currency : '';
  publishCurrency(isCurrencyCode(stored) ? stored : guessCurrency());
}

const subscribeCurrency = (listener: () => void) => {
  currencyListeners.add(listener);
  return () => {
    currencyListeners.delete(listener);
  };
};

/** Only exported for tests, which need a fresh read per case. */
export const resetDefaultCurrencyCache = () => {
  defaultCurrency = null;
};

export function useDefaultCurrency(): [string, (currency: string) => Promise<void>] {
  const current = useSyncExternalStore(subscribeCurrency, () => defaultCurrency);

  useEffect(() => {
    void refreshDefaultCurrency();
    return onSyncApplied(() => void refreshDefaultCurrency());
  }, []);

  const set = useCallback(async (currency: string) => {
    if (!isCurrencyCode(currency)) return;
    publishCurrency(currency);
    await savePluginSettings(PLUGIN_ID, { currency });
  }, []);

  // The guess stands in for the first frame, before the config row has been read — the same answer
  // the read will give for a diary that never picked one.
  return [current ?? guessCurrency(), set];
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

export async function addExpense(dateKey: string, input: ExpenseInput): Promise<Expense> {
  const row = await createPluginRecord(PLUGIN_ID, 'record', dateKey, expenseData(input));
  announceChange();
  return parseExpense(row)!;
}

export async function updateExpense(expense: Expense, input: ExpenseInput): Promise<void> {
  await updatePluginRecord(expense.id, expenseData(input));
  announceChange();
}

/** The caller keeps the `Expense` it passed in, which is everything `restoreExpense` needs. */
export async function removeExpense(expense: Expense): Promise<void> {
  await deletePluginRecord(expense.id);
  announceChange();
}

/** Undo for `removeExpense`: the same expense, on the same day. A new row id — nothing refers to an
    expense by id, so nothing can tell. */
export const restoreExpense = (expense: Expense) => addExpense(expense.dateKey, expense);

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
