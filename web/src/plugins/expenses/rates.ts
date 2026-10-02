import { EXCHANGE_RATE_SOURCES } from '@diary/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { parseDateKey } from '@/lib/dates';
import { currencyDigits } from './currency';
import type { Expense } from './model';
import snapshot from './rates.snapshot.json';

/**
 * Exchange rates, for showing a month spent in several currencies as one total.
 *
 * ## Where they come from
 *
 * Fetched straight from the browser, never through the diary's server — that keeps this plugin a
 * client-only change, and it means the APK in local-only mode, with no server at all, gets them the
 * same way. The source is the free, keyless currency-api (`@fawazahmed0/currency-api`), published
 * daily, which covers every currency `Intl` knows but one (XSU). Two mirrors of the same file, tried
 * in order — `EXCHANGE_RATE_SOURCES` in @diary/shared, which the server's CSP also reads.
 *
 * Asked for when the plugin's page is open (it carries a rates explorer), and elsewhere only when
 * something actually needs converting — the calendar of a diary kept in one currency never makes
 * the request. At most twice a day either way.
 *
 * ## What happens offline
 *
 * Three layers, newest wins: what this device last fetched (localStorage — a cache, so per device
 * and never synced), and under it a snapshot taken when the app was built (scripts/generateRates.ts,
 * refreshed on every CI build), so an APK that has never been online still converts. Rates more
 * than `STALE_AFTER_DAYS` old still convert, but the page says how old they are.
 *
 * ## The numbers
 *
 * Every rate is units of that currency per one euro, so any pair converts through the euro. A
 * converted amount is an estimate and the page says so; the stored expense is never touched, and
 * the export still lists each amount in the currency it was paid in.
 */

export interface ExchangeRates {
  /** `yyyy-MM-dd` — the day the source published these, not the day they were fetched. */
  date: string;
  /** Units per one EUR, keyed by ISO code. EUR itself is 1. */
  rates: Readonly<Record<string, number>>;
}

/** Past this, the page warns that converted totals may be off. */
export const STALE_AFTER_DAYS = 7;
/** How often to ask for newer ones. The source publishes once a day. */
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;

const CODE = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The source's shape — `{ date, eur: { usd: 1.08, … } }` — as ExchangeRates, or undefined if it
 * isn't that. Lowercase codes are uppercased; crypto tokens and anything else that isn't an ISO
 * code shape are dropped, as are rates that aren't positive finite numbers.
 */
export function parseRatesResponse(json: unknown): ExchangeRates | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  const { date, eur } = json as { date?: unknown; eur?: unknown };
  if (typeof date !== 'string' || !DATE.test(date)) return undefined;
  if (typeof eur !== 'object' || eur === null) return undefined;
  const rates: Record<string, number> = {};
  for (const [key, value] of Object.entries(eur)) {
    const code = key.toUpperCase();
    if (CODE.test(code) && typeof value === 'number' && Number.isFinite(value) && value > 0) {
      rates[code] = value;
    }
  }
  rates.EUR = 1;
  return Object.keys(rates).length > 1 ? { date, rates } : undefined;
}

/**
 * `minor` units of `from`, in minor units of `to` — or undefined when either rate is unknown.
 * Rounded to the target's minor unit, so the result sums like any other amount.
 */
export function convertMinor(
  minor: number,
  from: string,
  to: string,
  rates: ExchangeRates,
): number | undefined {
  if (from === to) return minor;
  const fromRate = rates.rates[from];
  const toRate = rates.rates[to];
  if (!fromRate || !toRate) return undefined;
  const major = minor / 10 ** currencyDigits(from);
  return Math.round((major / fromRate) * toRate * 10 ** currencyDigits(to));
}

/** How many of `to` one unit of `from` buys, or undefined when either rate is unknown. */
export function rateBetween(from: string, to: string, rates: ExchangeRates): number | undefined {
  const fromRate = rates.rates[from];
  const toRate = rates.rates[to];
  return fromRate && toRate ? toRate / fromRate : undefined;
}

export interface ConvertedExpenses {
  /** Every expense that could be converted, now in the target currency. Ids are unchanged. */
  expenses: Expense[];
  /** Currencies with no rate, whose expenses were left out — sorted, for a stable message. */
  unconverted: string[];
  /** Whether anything was actually converted, i.e. whether the totals are estimates at all. */
  converted: boolean;
}

/** Every expense in `to`, for the stats — which then run exactly as they do for one currency. */
export function convertExpenses(
  expenses: readonly Expense[],
  to: string,
  rates: ExchangeRates,
): ConvertedExpenses {
  const out: Expense[] = [];
  const missing = new Set<string>();
  let converted = false;
  for (const expense of expenses) {
    const minor = convertMinor(expense.minor, expense.currency, to, rates);
    if (minor === undefined) {
      missing.add(expense.currency);
      continue;
    }
    if (expense.currency !== to) converted = true;
    out.push({ ...expense, minor, currency: to });
  }
  return { expenses: out, unconverted: [...missing].sort(), converted };
}

/** Whole days between the rates' publication and `today` (both `yyyy-MM-dd`). */
export function ratesAgeDays(rates: ExchangeRates, today: string): number {
  const ms = parseDateKey(today).getTime() - parseDateKey(rates.date).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

export const ratesAreStale = (rates: ExchangeRates, today: string) =>
  ratesAgeDays(rates, today) > STALE_AFTER_DAYS;

/* --- The device cache --------------------------------------------------------------------------- */

const STORAGE_KEY = 'expenses.exchangeRates';

interface CachedRates extends ExchangeRates {
  /** When this device last *asked* — successful or not — so a failing source isn't hammered. */
  checkedAt: number;
}

/** The snapshot built into the app. Parsed like anything else, so a broken one degrades to EUR. */
export const BUNDLED_RATES: ExchangeRates = parseRatesResponse(snapshot) ?? {
  date: '1970-01-01',
  rates: { EUR: 1 },
};

function readCache(): CachedRates | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { date?: unknown; rates?: unknown; checkedAt?: unknown };
    const rates = parseRatesResponse({ date: parsed.date, eur: parsed.rates });
    if (!rates) return undefined;
    return { ...rates, checkedAt: typeof parsed.checkedAt === 'number' ? parsed.checkedAt : 0 };
  } catch {
    return undefined;
  }
}

function writeCache(value: CachedRates) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the in-memory copy still serves this session.
  }
}

/** Whichever of the two is newer — a fresh install's snapshot can beat a cache from months ago. */
const newest = (a: ExchangeRates, b: ExchangeRates | undefined) => (b && b.date >= a.date ? b : a);

let current: ExchangeRates | null = null;
let checkedAt = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(): ExchangeRates {
  if (!current) {
    const cached = readCache();
    checkedAt = cached?.checkedAt ?? 0;
    current = newest(BUNDLED_RATES, cached && { date: cached.date, rates: cached.rates });
  }
  return current;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

async function fetchFrom(url: string): Promise<ExchangeRates | undefined> {
  // `no-cache` revalidates rather than trusting the browser's copy: one mirror says max-age a week.
  const res = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return undefined;
  return parseRatesResponse(await res.json());
}

/**
 * Ask for newer rates, unless this device asked recently. Never throws — a failed refresh leaves
 * whatever was there, and the staleness warning is what tells the reader.
 */
export function refreshRates(force = false): Promise<void> {
  load();
  if (inFlight) return inFlight;
  if (!force && Date.now() - checkedAt < REFRESH_AFTER_MS) return Promise.resolve();
  // `=== false` rather than falsy: outside a browser (tests, Node) there is no `onLine` at all.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve();

  inFlight = (async () => {
    let fetched: ExchangeRates | undefined;
    for (const url of EXCHANGE_RATE_SOURCES) {
      try {
        fetched = await fetchFrom(url);
      } catch {
        fetched = undefined;
      }
      if (fetched) break;
    }
    checkedAt = Date.now();
    const next = newest(load(), fetched);
    writeCache({ ...next, checkedAt });
    if (next !== current) {
      current = next;
      for (const listener of listeners) listener();
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Only exported for tests, which need a fresh read per case. */
export function resetRatesCache() {
  current = null;
  checkedAt = 0;
  inFlight = null;
}

/**
 * The best rates this device has. With `needed`, also asks for newer ones — now, and again when
 * the device comes back online — so a page that converts nothing never makes a request.
 */
export function useExchangeRates(needed: boolean): ExchangeRates {
  const rates = useSyncExternalStore(subscribe, load, load);

  useEffect(() => {
    if (!needed) return;
    void refreshRates();
    const onOnline = () => void refreshRates();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [needed]);

  return rates;
}
