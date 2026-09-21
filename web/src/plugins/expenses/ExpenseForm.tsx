import { Check, Plus, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  allCurrencies,
  currencyName,
  currencySymbol,
  minorToInput,
  parseAmountInput,
} from './currency';
import { DESCRIPTION_MAX, type Category, type ExpenseInput } from './model';

/** A category's display name: its own if it has one, the translated starter name otherwise. */
export function useCategoryLabel() {
  const { t } = useTranslation();
  return (category: Category | undefined) =>
    category
      ? (category.name ?? t(`plugins.expenses.category.${category.builtinKey}`))
      : t('plugins.expenses.uncategorized');
}

/**
 * A searchable currency list, in a popover. Searchable by code and by name in the reader's
 * language, so "yen" and "JPY" both find it — there are around 300 of them and scrolling is not a
 * way to find one.
 */
export function CurrencyPicker({
  value,
  onChange,
  trigger,
}: {
  value: string;
  onChange: (currency: string) => void;
  trigger: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const currencies = useMemo(
    () => allCurrencies().map((code) => ({ code, name: currencyName(code, i18n.language) })),
    [i18n.language],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Portal into an enclosing dialog, if any, so the list scrolls under its scroll lock — the
        // same arrangement EntityPicker makes.
        if (next) setContainer(triggerRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
      }}
    >
      <PopoverTrigger asChild ref={triggerRef}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent container={container} className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={t('plugins.expenses.searchCurrency')} />
          <CommandList>
            <CommandEmpty>{t('common.noResults')}</CommandEmpty>
            <CommandGroup>
              {currencies.map(({ code, name }) => (
                <CommandItem
                  key={code}
                  value={`${code} ${name}`}
                  onSelect={() => {
                    onChange(code);
                    setOpen(false);
                  }}
                >
                  <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">
                    {code}
                  </span>
                  <span className="flex-1 truncate">{name}</span>
                  {code === value && <Check className="size-3.5 text-muted-foreground" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const NO_CATEGORY = '__none__';

export function CategorySelect({
  value,
  onChange,
  categories,
  id,
  className,
}: {
  value: string | null;
  onChange: (category: string | null) => void;
  categories: readonly Category[];
  id?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const labelOf = useCategoryLabel();
  // Retired categories stay out of the list — except the one this expense already has, which must
  // still be able to show as selected.
  const offered = categories.filter((category) => !category.retired || category.id === value);

  return (
    <Select
      value={value ?? NO_CATEGORY}
      onValueChange={(next) => onChange(next === NO_CATEGORY ? null : next)}
    >
      <SelectTrigger id={id} className={className} aria-label={t('plugins.expenses.categoryLabel')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CATEGORY}>
          <span className="text-muted-foreground">{t('plugins.expenses.uncategorized')}</span>
        </SelectItem>
        {offered.map((category) => {
          const Icon = category.icon;
          return (
            <SelectItem key={category.id} value={category.id}>
              <Icon className="size-3.5 text-muted-foreground" aria-hidden />
              {labelOf(category)}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/**
 * Adding an expense and editing one: an amount, what it was, and optionally which category.
 *
 * Only the amount is required. "What was it" is the part a diary is actually about, but a form that
 * refuses €3.20 until it has been given a name is a form that stops getting used at the till.
 *
 * In "add" mode the form clears itself after each submit and keeps the currency and focus, so three
 * things bought on one trip are three quick entries rather than three trips through the picker.
 */
export function ExpenseForm({
  initial,
  defaultCurrency,
  categories,
  onSubmit,
  onCancel,
  onDelete,
  autoFocus,
  idPrefix,
}: {
  /** Present when editing. */
  initial?: ExpenseInput;
  defaultCurrency: string;
  categories: readonly Category[];
  onSubmit: (input: ExpenseInput) => Promise<void> | void;
  onCancel?: () => void;
  onDelete?: () => void;
  autoFocus?: boolean;
  /** Keeps ids unique when several forms share a page. */
  idPrefix: string;
}) {
  const { t, i18n } = useTranslation();
  const editing = initial !== undefined;
  const [currency, setCurrency] = useState(initial?.currency ?? defaultCurrency);
  const [amount, setAmount] = useState(
    initial ? minorToInput(initial.minor, initial.currency, i18n.language) : '',
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [category, setCategory] = useState<string | null>(initial?.category ?? null);
  const [working, setWorking] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  /* Follows the default while untouched — the settings card changing it, or the synced value
     arriving a moment after mount, should pre-fill the new one, not the guess from the first frame.
     The previous default is tracked in state rather than a ref, so it's compared during render. */
  const [seenDefault, setSeenDefault] = useState(defaultCurrency);
  if (seenDefault !== defaultCurrency) {
    setSeenDefault(defaultCurrency);
    if (!editing && currency === seenDefault) setCurrency(defaultCurrency);
  }

  const minor = parseAmountInput(amount, currency);
  const invalid = amount.trim() !== '' && minor === undefined;

  const submit = async () => {
    if (minor === undefined || working) return;
    setWorking(true);
    try {
      await onSubmit({ minor, currency, description, category });
      if (!editing) {
        setAmount('');
        setDescription('');
        setCategory(null);
        amountRef.current?.focus();
      }
    } catch {
      // The caller has already said what went wrong; keeping the fields is the rest of the answer.
    } finally {
      setWorking(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap gap-2">
        <div className="flex w-36 shrink-0 items-center rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
          <CurrencyPicker
            value={currency}
            onChange={setCurrency}
            trigger={
              <button
                type="button"
                className="h-8 shrink-0 rounded-l-lg border-r px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                aria-label={t('plugins.expenses.currencyLabel', {
                  currency: currencyName(currency, i18n.language),
                })}
              >
                {currencySymbol(currency, i18n.language)}
              </button>
            }
          />
          <input
            ref={amountRef}
            id={`${idPrefix}-amount`}
            inputMode="decimal"
            autoComplete="off"
            autoFocus={autoFocus}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={minorToInput(0, currency, i18n.language)}
            aria-label={t('plugins.expenses.amountLabel')}
            aria-invalid={invalid || undefined}
            className="h-8 w-full min-w-0 bg-transparent px-2 text-base tabular-nums outline-none placeholder:text-muted-foreground md:text-sm"
          />
        </div>
        <Input
          id={`${idPrefix}-description`}
          value={description}
          maxLength={DESCRIPTION_MAX}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t('plugins.expenses.descriptionPlaceholder')}
          aria-label={t('plugins.expenses.descriptionLabel')}
          className="min-w-40 flex-1"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CategorySelect
          id={`${idPrefix}-category`}
          value={category}
          onChange={setCategory}
          categories={categories}
          className="min-w-36"
        />
        <div className="ml-auto flex items-center gap-1.5">
          {onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
              onClick={onDelete}
              disabled={working}
            >
              <Trash2 className="size-3.5" />
              {t('common.delete')}
            </Button>
          )}
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={working}>
              {t('common.cancel')}
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            className={cn('gap-1', !editing && 'pl-2')}
            disabled={minor === undefined || working}
          >
            {!editing && <Plus className="size-3.5" />}
            {editing ? t('common.save') : t('common.add')}
          </Button>
        </div>
      </div>
      {invalid && (
        <p className="text-xs text-muted-foreground" role="status">
          {t('plugins.expenses.amountInvalid')}
        </p>
      )}
    </form>
  );
}
