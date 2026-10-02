import { ArrowLeftRight, ChevronDown, ChevronsUpDown, Coins } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { currencyDigits, currencyName, formatMinor, parseAmountInput } from './currency';
import { CurrencyPicker } from './ExpenseForm';
import { convertMinor, rateBetween, type ExchangeRates } from './rates';

/**
 * A rate as an amount: "€0.86", "CN¥7.59", "€0.00625". At or above one, the currency's own decimals,
 * like any other amount; below it, three significant digits, so a small rate doesn't round to zero
 * without trailing on into digits nobody reads.
 */
const formatRate = (value: number, currency: string, language: string) =>
  new Intl.NumberFormat(language, {
    style: 'currency',
    currency,
    ...(value >= 1
      ? {
          minimumFractionDigits: currencyDigits(currency),
          maximumFractionDigits: currencyDigits(currency),
        }
      : { minimumSignificantDigits: 2, maximumSignificantDigits: 3 }),
  }).format(value);

/**
 * A small converter over the same rates the page converts with, at the bottom of the page and
 * collapsed until asked for: an amount in one currency, what it is in another, and the diary's own
 * currencies against any one currency, either way round — what one of each is worth in it, or what
 * one of it is worth in each.
 *
 * Only offered while the rates are fresh — once they're over a week old the page is already warning
 * that its own conversions may be off, and a tool for looking up rates would be offering the same
 * stale numbers as if they were current.
 */
export function RatesExplorer({
  rates,
  displayCurrency,
  currencies,
}: {
  rates: ExchangeRates;
  /** What the page shows totals in — where the converter lands by default. */
  displayCurrency: string;
  /** Every currency the diary has used, most used first. */
  currencies: readonly string[];
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  /* Starts on the diary's own foreign currency if it has one — the conversion someone with two
     currencies most likely wants — else on a common one that isn't the display currency. */
  const [from, setFrom] = useState(
    currencies.find((code) => code !== displayCurrency && rates.rates[code] !== undefined) ??
      (displayCurrency === 'USD' ? 'EUR' : 'USD'),
  );
  const [to, setTo] = useState(displayCurrency);
  const [amount, setAmount] = useState('1');
  /* The list's side: which currency the diary's own are compared with (the display currency until
     another is picked), and which way round — 'into' is one of each in the reference, 'from' is
     one of the reference in each. */
  const [reference, setReference] = useState(displayCurrency);
  const [direction, setDirection] = useState<'into' | 'from'>('into');
  const priced = currencies.filter((code) => rates.rates[code] !== undefined);
  const compared = priced.filter((code) => code !== reference);

  const minor = parseAmountInput(amount, from);
  const result = minor === undefined ? undefined : convertMinor(minor, from, to, rates);

  const picker = (value: string, onChange: (code: string) => void, label: string) => (
    <CurrencyPicker
      value={value}
      onChange={onChange}
      trigger={
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          aria-label={t(label, { currency: currencyName(value, language) })}
        >
          <span className="font-mono text-xs">{value}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Button>
      }
    />
  );

  return (
    <Collapsible className="group rounded-xl border bg-card shadow-xs">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <Coins className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1 text-sm font-medium">{t('plugins.expenses.ratesTitle')}</span>
        <span className="text-xs text-muted-foreground">
          {formatDateKey(rates.date, language, 'PP')}
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-label={t('plugins.expenses.ratesAmount')}
            aria-invalid={(amount.trim() !== '' && minor === undefined) || undefined}
            className="h-8 w-28 rounded-lg border border-input bg-transparent px-2 text-base tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          />
          {picker(from, setFrom, 'plugins.expenses.ratesFrom')}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label={t('plugins.expenses.ratesSwap')}
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
          >
            <ArrowLeftRight className="size-4" />
          </Button>
          {picker(to, setTo, 'plugins.expenses.ratesTo')}
          <output
            className={cn(
              'ml-auto text-lg font-semibold tabular-nums',
              result === undefined && 'text-muted-foreground',
            )}
            aria-live="polite"
          >
            {result === undefined ? '—' : formatMinor(result, to, language)}
          </output>
        </div>

        {rateBetween(from, to, rates) === undefined && (
          <p className="text-xs text-muted-foreground">{t('plugins.expenses.ratesUnavailable')}</p>
        )}

        {priced.length > 0 && (
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{t('plugins.expenses.ratesCompareWith')}</span>
              {picker(reference, setReference, 'plugins.expenses.ratesReference')}
              <Tabs
                value={direction}
                onValueChange={(next) => setDirection(next === 'from' ? 'from' : 'into')}
              >
                <TabsList aria-label={t('plugins.expenses.ratesDirection')}>
                  <TabsTrigger value="into">
                    {t('plugins.expenses.ratesEachIn', { currency: reference })}
                  </TabsTrigger>
                  <TabsTrigger value="from">
                    {t('plugins.expenses.ratesOneIn', { currency: reference })}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {compared.length > 0 ? (
              <ul className="divide-y divide-border/60 text-sm">
                {compared.map((code) => {
                  const [unit, target] =
                    direction === 'into' ? [code, reference] : [reference, code];
                  return (
                    <li key={code}>
                      {/* Picking a row loads that pair into the converter above. */}
                      <button
                        type="button"
                        onClick={() => {
                          setFrom(unit);
                          setTo(target);
                        }}
                        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
                      >
                        <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">
                          {code}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {currencyName(code, language)}
                        </span>
                        {/* Spelled out as a pair on every row, so which way round it is never
                            depends on remembering the switch above. */}
                        <span className="shrink-0 tabular-nums">
                          {t('plugins.expenses.ratesPair', {
                            from: formatRate(1, unit, language),
                            to: formatRate(rateBetween(unit, target, rates)!, target, language),
                          })}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('plugins.expenses.ratesNothingToCompare')}
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {t('plugins.expenses.ratesSource', {
            date: formatDateKey(rates.date, language, 'PPP'),
          })}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
