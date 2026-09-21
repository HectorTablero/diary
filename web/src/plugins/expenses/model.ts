import { UNDATED_KEY, type PluginRecordDto } from '@diary/shared';
import {
  Bus,
  Gift,
  HeartPulse,
  House,
  Receipt,
  ShoppingBag,
  ShoppingBasket,
  Tag,
  Ticket,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { z } from 'zod';
import { isCurrencyCode } from './currency';

export const PLUGIN_ID = 'expenses';

/**
 * What the expense tracker stores, and how it reads it back.
 *
 * ## One row per expense, not one per day
 *
 * Habits and the period tracker keep one row per day, because what they record about a day is a
 * single value that is *replaced*. An expense is *added*, and that turns the same shape into a
 * trap: the phone adding a coffee and the laptop adding lunch to the same day would be two writes to
 * one row, and last-write-wins would quietly drop one of them. A row per expense makes those two
 * independent creates that cannot collide. The row's `dateKey` is still the day, so reading a day
 * is the same indexed range scan it is for every other plugin.
 *
 * The cost is headroom against MAX_PLUGIN_RECORDS_PER_PLUGIN (20,000) — about ten years at five
 * expenses a day — which is the right trade for a diary rather than a ledger.
 *
 * ## Amounts are integers in the currency's minor unit
 *
 * `minor` is cents for EUR, yen for JPY, fils for KWD (see `currencyDigits`). Summing a month of
 * floats drifts; summing integers doesn't, and every total the page shows is a sum.
 *
 * ## Categories are undated rows, and the starters are never written
 *
 * The starter set is built in, with fixed ids and translated names, rather than seeded as rows on
 * first use: two devices enabling the plugin offline would otherwise each seed a full set, and a
 * sync later the list holds every category twice. A starter only ever gets a row once someone
 * renames or retires it — an *override*, keyed by the starter's id. A custom category is a plain
 * undated row whose own id is its identity, the same idiom habits uses for its definitions.
 */

export const DESCRIPTION_MAX = 120;
export const CATEGORY_NAME_MAX = 40;
/** Far above anything a diary will see, and far below where integer arithmetic stops being exact. */
export const MAX_MINOR = 1_000_000_000_000;

/* --- Expenses --------------------------------------------------------------------------------- */

const expenseSchema = z.object({
  kind: z.literal('expense'),
  minor: z.number().int().positive().max(MAX_MINOR),
  currency: z.string().refine(isCurrencyCode),
  // `.catch` rather than a hard failure, for the same reason the period tracker's flow uses it: an
  // odd field should cost that field, not the whole expense vanishing from a month's total.
  description: z.string().max(DESCRIPTION_MAX).catch(''),
  category: z.string().nullable().catch(null),
});

export interface Expense {
  id: string;
  dateKey: string;
  minor: number;
  currency: string;
  description: string;
  /** A category id — `builtin:<id>` for a starter, a row id for a custom one — or null. */
  category: string | null;
  createdAt: string;
}

export type ExpenseInput = Pick<Expense, 'minor' | 'currency' | 'description' | 'category'>;

export function parseExpense(record: PluginRecordDto): Expense | undefined {
  if (record.dateKey === UNDATED_KEY || record.scope !== 'record') return undefined;
  const parsed = expenseSchema.safeParse(record.data);
  if (!parsed.success) return undefined;
  const { minor, currency, description, category } = parsed.data;
  return {
    id: record.id,
    dateKey: record.dateKey,
    minor,
    currency,
    description,
    category,
    createdAt: record.createdAt,
  };
}

export const expenseData = (input: ExpenseInput) => ({
  kind: 'expense' as const,
  minor: input.minor,
  currency: input.currency,
  description: input.description.trim().slice(0, DESCRIPTION_MAX),
  category: input.category,
});

/** Oldest first within a day — the order they were added in, which is the order they happened. */
export const byCreation = (a: Expense, b: Expense) => a.createdAt.localeCompare(b.createdAt);

/* --- Categories ------------------------------------------------------------------------------- */

/**
 * The starters. Everyday, and deliberately without a "treats" or "impulse" bucket: a category is
 * where money went, not a verdict on whether it should have. Order here is the order they list in.
 */
export const BUILTIN_CATEGORIES = [
  { id: 'groceries', icon: ShoppingBasket },
  { id: 'eatingOut', icon: UtensilsCrossed },
  { id: 'transport', icon: Bus },
  { id: 'home', icon: House },
  { id: 'bills', icon: Receipt },
  { id: 'health', icon: HeartPulse },
  { id: 'leisure', icon: Ticket },
  { id: 'shopping', icon: ShoppingBag },
  { id: 'gifts', icon: Gift },
] as const satisfies readonly { id: string; icon: LucideIcon }[];

export type BuiltinCategoryId = (typeof BUILTIN_CATEGORIES)[number]['id'];

const BUILTIN_PREFIX = 'builtin:';
export const builtinCategoryId = (id: BuiltinCategoryId) => `${BUILTIN_PREFIX}${id}`;

const categorySchema = z.object({
  kind: z.literal('category'),
  /** For a starter's override: which starter. Absent for a custom category. */
  builtin: z.string().nullable().catch(null),
  /** A starter's name is translated until renamed, so null there means "the translated one". */
  name: z.string().max(CATEGORY_NAME_MAX).nullable().catch(null),
  retired: z.boolean().catch(false),
});

export interface Category {
  id: string;
  /** Null for a starter that was never renamed — the caller translates `builtinKey`. */
  name: string | null;
  builtinKey: BuiltinCategoryId | null;
  retired: boolean;
  icon: LucideIcon;
  /** The row that stores this category, if any. A starter never renamed or retired has none. */
  rowId: string | null;
}

export const categoryData = (fields: {
  builtin: BuiltinCategoryId | null;
  name: string | null;
  retired: boolean;
}) => ({
  kind: 'category' as const,
  builtin: fields.builtin,
  name: fields.name === null ? null : fields.name.trim().slice(0, CATEGORY_NAME_MAX),
  retired: fields.retired,
});

const isBuiltin = (id: string): id is BuiltinCategoryId =>
  BUILTIN_CATEGORIES.some((category) => category.id === id);

/**
 * The full category list: every starter (with its override applied, if it has one), then every
 * custom category in the order it was created.
 *
 * Two overrides for one starter can exist — two devices renaming it before either synced — and the
 * newest wins, which is the same answer last-write-wins would have given on a single row.
 */
export function resolveCategories(undated: readonly PluginRecordDto[]): Category[] {
  const overrides = new Map<BuiltinCategoryId, { row: PluginRecordDto; data: CategoryData }>();
  const custom: { row: PluginRecordDto; data: CategoryData }[] = [];

  for (const row of undated) {
    const parsed = categorySchema.safeParse(row.data);
    if (!parsed.success) continue;
    const data = parsed.data;
    if (data.builtin !== null) {
      if (!isBuiltin(data.builtin)) continue;
      const current = overrides.get(data.builtin);
      if (!current || current.row.updatedAt < row.updatedAt) {
        overrides.set(data.builtin, { row, data });
      }
    } else if (data.name) {
      custom.push({ row, data });
    }
  }

  const builtins: Category[] = BUILTIN_CATEGORIES.map(({ id, icon }) => {
    const override = overrides.get(id);
    return {
      id: builtinCategoryId(id),
      name: override?.data.name || null,
      builtinKey: id,
      retired: override?.data.retired ?? false,
      icon,
      rowId: override?.row.id ?? null,
    };
  });

  const customs: Category[] = custom
    .sort((a, b) => a.row.createdAt.localeCompare(b.row.createdAt))
    .map(({ row, data }) => ({
      id: row.id,
      name: data.name,
      builtinKey: null,
      retired: data.retired,
      icon: Tag,
      rowId: row.id,
    }));

  return [...builtins, ...customs];
}

type CategoryData = z.infer<typeof categorySchema>;

/** A category row's own name, for the backup-import review, which has no i18n context to resolve
    a starter's translated name with — the caller does that. */
export function parseCategoryRow(
  record: PluginRecordDto,
): { builtin: BuiltinCategoryId | null; name: string | null } | undefined {
  if (record.dateKey !== UNDATED_KEY) return undefined;
  const parsed = categorySchema.safeParse(record.data);
  if (!parsed.success) return undefined;
  const builtin = parsed.data.builtin;
  return {
    builtin: builtin !== null && isBuiltin(builtin) ? builtin : null,
    name: parsed.data.name,
  };
}
