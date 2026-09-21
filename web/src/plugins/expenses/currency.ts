/**
 * Currencies, entirely through `Intl` — no table of symbols or decimal places to keep up to date.
 *
 * There is deliberately no conversion anywhere in this plugin. A rate is either fetched (a network
 * dependency in an offline-first app, and a server change in a system built so plugins are
 * client-only) or invented, and a total made of invented rates is a number that looks exact and
 * isn't. Each currency is summed on its own instead.
 */

const CODE = /^[A-Z]{3}$/;

export const isCurrencyCode = (value: string): boolean => {
  if (!CODE.test(value)) return false;
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: value });
    return true;
  } catch {
    return false;
  }
};

const digitsCache = new Map<string, number>();

/** Decimal places of the currency's minor unit: 2 for EUR, 0 for JPY, 3 for KWD. */
export function currencyDigits(currency: string): number {
  let digits = digitsCache.get(currency);
  if (digits === undefined) {
    digits =
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    digitsCache.set(currency, digits);
  }
  return digits;
}

export const minorToMajor = (minor: number, currency: string) =>
  minor / 10 ** currencyDigits(currency);

/** €12.50, ¥1,200 — in the reader's locale, not the currency's country. */
export function formatMinor(
  minor: number,
  currency: string,
  language: string,
  options: { compact?: boolean } = {},
): string {
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency,
    ...(options.compact
      ? { notation: 'compact', maximumFractionDigits: 1 }
      : { minimumFractionDigits: currencyDigits(currency) }),
  }).format(minorToMajor(minor, currency));
}

/**
 * What someone typed into an amount field, as minor units — or undefined if it isn't an amount.
 *
 * Accepts either separator as the decimal point, because a Spanish keyboard and an English one
 * disagree and neither person should have to think about it. When both appear, the last is the
 * decimal point ("1.234,50", "1,234.50"). When only one appears, it is a decimal point unless it is
 * followed by more digits than the currency has decimals — so "12,5" is twelve and a half euros and
 * "1.200" is twelve hundred.
 */
export function parseAmountInput(raw: string, currency: string): number | undefined {
  // Spaces (including the no-break ones French and Swiss grouping uses) and apostrophes are only
  // ever grouping, so they go before anything else is decided.
  const text = raw.replace(/[\s\u00a0\u202f']/g, '');
  if (!/^\d*[.,]?\d*([.,]\d*)*$/.test(text) || !/\d/.test(text)) return undefined;

  const digits = currencyDigits(currency);
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let integer = text;
  let fraction = '';

  const separator = Math.max(lastDot, lastComma);
  if (separator >= 0) {
    const both = lastDot >= 0 && lastComma >= 0;
    const tail = text.slice(separator + 1);
    const occurrences = text.split(text[separator]).length - 1;
    const isDecimal = both || (occurrences === 1 && tail.length <= digits && digits > 0);
    if (isDecimal) {
      integer = text.slice(0, separator);
      fraction = tail;
    } else if (!/^\d{1,3}([.,]\d{3})+$/.test(text)) {
      // Not a decimal point, so it has to be grouping — and grouping comes in threes.
      return undefined;
    }
  }

  integer = integer.replace(/[.,]/g, '');
  if (fraction.length > digits) return undefined;
  const minor = Number(`${integer || '0'}${fraction.padEnd(digits, '0')}`);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : undefined;
}

/** The inverse, for seeding an edit field: plain digits and the locale's decimal separator. */
export function minorToInput(minor: number, currency: string, language: string): string {
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: currencyDigits(currency),
    maximumFractionDigits: currencyDigits(currency),
    useGrouping: false,
  }).format(minorToMajor(minor, currency));
}

/** "Euro", "US Dollar" — in the reader's language. Falls back to the code. */
export function currencyName(currency: string, language: string): string {
  try {
    return new Intl.DisplayNames(language, { type: 'currency' }).of(currency) ?? currency;
  } catch {
    return currency;
  }
}

/** The symbol alone, as the reader's locale writes it: "€", "US$", "¥". */
export function currencySymbol(currency: string, language: string): string {
  const part = new Intl.NumberFormat(language, { style: 'currency', currency })
    .formatToParts(0)
    .find((p) => p.type === 'currency');
  return part?.value ?? currency;
}

/** Listed first in the picker; everything else follows alphabetically. */
const COMMON = ['EUR', 'USD', 'GBP', 'JPY', 'CNY', 'CHF', 'CAD', 'AUD', 'MXN'];

export function allCurrencies(): string[] {
  let codes: string[] = [];
  try {
    codes = Intl.supportedValuesOf('currency');
  } catch {
    codes = COMMON;
  }
  const rest = codes.filter((code) => !COMMON.includes(code)).sort();
  return [...COMMON.filter((code) => codes.includes(code)), ...rest];
}

/** A handful of regions whose currency differs from what the language alone would suggest. */
const REGION_CURRENCY: Record<string, string> = {
  US: 'USD',
  GB: 'GBP',
  IE: 'EUR',
  CA: 'CAD',
  AU: 'AUD',
  NZ: 'NZD',
  IN: 'INR',
  ZA: 'ZAR',
  MX: 'MXN',
  AR: 'ARS',
  CO: 'COP',
  CL: 'CLP',
  PE: 'PEN',
  UY: 'UYU',
  VE: 'VES',
  ES: 'EUR',
  FR: 'EUR',
  DE: 'EUR',
  IT: 'EUR',
  PT: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  CH: 'CHF',
  JP: 'JPY',
  CN: 'CNY',
  TW: 'TWD',
  HK: 'HKD',
  SG: 'SGD',
  KR: 'KRW',
  BR: 'BRL',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
};

const LANGUAGE_CURRENCY: Record<string, string> = {
  es: 'EUR',
  it: 'EUR',
  de: 'EUR',
  fr: 'EUR',
  pt: 'EUR',
  ja: 'JPY',
  zh: 'CNY',
  en: 'USD',
};

/**
 * The default currency before anyone has picked one: the browser's region if it names one, the
 * language otherwise, euros as a last resort. Only ever a first guess — Settings says what it is and
 * changing it is one tap — so it only has to be right often, not always.
 */
export function guessCurrency(locales: readonly string[] = navigator.languages ?? []): string {
  for (const tag of locales) {
    try {
      const locale = new Intl.Locale(tag);
      const byRegion = locale.region ? REGION_CURRENCY[locale.region] : undefined;
      if (byRegion) return byRegion;
    } catch {
      // A malformed tag says nothing; try the next.
    }
  }
  for (const tag of locales) {
    const byLanguage = LANGUAGE_CURRENCY[tag.slice(0, 2).toLowerCase()];
    if (byLanguage) return byLanguage;
  }
  return 'EUR';
}
