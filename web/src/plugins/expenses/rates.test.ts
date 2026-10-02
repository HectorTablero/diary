import { describe, expect, it } from 'vitest';
import type { Expense } from './model';
import {
  BUNDLED_RATES,
  convertExpenses,
  convertMinor,
  parseRatesResponse,
  ratesAgeDays,
  ratesAreStale,
  type ExchangeRates,
} from './rates';

const RATES: ExchangeRates = {
  date: '2026-09-20',
  rates: { EUR: 1, USD: 1.25, JPY: 160, KWD: 0.35 },
};

const expense = (minor: number, currency: string, id = `${currency}-${minor}`): Expense => ({
  id,
  dateKey: '2026-09-21',
  minor,
  currency,
  description: '',
  category: null,
  createdAt: '2026-09-21T10:00:00.000Z',
});

describe('parseRatesResponse', () => {
  it('reads the source’s shape, uppercasing ISO codes and dropping the rest', () => {
    const parsed = parseRatesResponse({
      date: '2026-10-01',
      eur: { usd: 1.1, jpy: 160.5, '1inch': 10, btc: 0.00001, bad: -1, nan: 'x' },
    });
    // BTC is three letters, so it survives the shape check — it simply never matches a real
    // expense's currency. What matters is that malformed entries can't.
    expect(parsed).toEqual({
      date: '2026-10-01',
      rates: { USD: 1.1, JPY: 160.5, BTC: 0.00001, EUR: 1 },
    });
  });

  it('rejects anything that is not that shape', () => {
    expect(parseRatesResponse(null)).toBeUndefined();
    expect(parseRatesResponse({ date: 'yesterday', eur: { usd: 1 } })).toBeUndefined();
    expect(parseRatesResponse({ date: '2026-10-01', eur: {} })).toBeUndefined();
    expect(parseRatesResponse({ date: '2026-10-01' })).toBeUndefined();
  });

  it('ships a usable snapshot for devices that are never online', () => {
    expect(BUNDLED_RATES.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(BUNDLED_RATES.date > '2026-01-01').toBe(true);
    for (const code of ['EUR', 'USD', 'GBP', 'JPY', 'CNY', 'MXN']) {
      expect(BUNDLED_RATES.rates[code]).toBeGreaterThan(0);
    }
  });
});

describe('convertMinor', () => {
  it('goes through the euro, honouring each currency’s minor unit', () => {
    // $12.50 → €10.00 → ¥1,600 (yen have no minor unit).
    expect(convertMinor(1250, 'USD', 'JPY', RATES)).toBe(1600);
    // ¥1,600 → €10.00 → 3.500 KWD (fils, three decimals).
    expect(convertMinor(1600, 'JPY', 'KWD', RATES)).toBe(3500);
    expect(convertMinor(1000, 'EUR', 'USD', RATES)).toBe(1250);
  });

  it('leaves a same-currency amount alone and refuses an unknown one', () => {
    expect(convertMinor(999, 'XYZ', 'XYZ', RATES)).toBe(999);
    expect(convertMinor(100, 'XYZ', 'EUR', RATES)).toBeUndefined();
    expect(convertMinor(100, 'EUR', 'XYZ', RATES)).toBeUndefined();
  });
});

describe('convertExpenses', () => {
  it('puts everything it can in the target currency, keeping ids', () => {
    const result = convertExpenses(
      [expense(1000, 'EUR'), expense(1250, 'USD'), expense(500, 'XYZ')],
      'EUR',
      RATES,
    );
    expect(result.expenses.map((e) => [e.id, e.minor, e.currency])).toEqual([
      ['EUR-1000', 1000, 'EUR'],
      ['USD-1250', 1000, 'EUR'],
    ]);
    expect(result.unconverted).toEqual(['XYZ']);
    expect(result.converted).toBe(true);
  });

  it('says nothing was converted when nothing needed to be', () => {
    const result = convertExpenses([expense(1000, 'EUR')], 'EUR', RATES);
    expect(result.converted).toBe(false);
    expect(result.unconverted).toEqual([]);
  });
});

describe('staleness', () => {
  it('counts whole days since publication and warns past a week', () => {
    expect(ratesAgeDays(RATES, '2026-09-20')).toBe(0);
    expect(ratesAgeDays(RATES, '2026-09-27')).toBe(7);
    expect(ratesAreStale(RATES, '2026-09-27')).toBe(false);
    expect(ratesAreStale(RATES, '2026-09-28')).toBe(true);
  });
});
