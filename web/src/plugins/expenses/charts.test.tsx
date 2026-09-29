import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CategoryBars, MonthlyColumns } from './charts';
import en from './locales/en.json';
import { monthlyTotals } from './stats';

beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', { plugins: { expenses: en } }, true, true);
  await i18n.changeLanguage('en');
});

/* One divider per turn of the year, in each row (bars and labels), and none when the chart
   starts on a January — there is no December beside it to separate it from. */
const dividers = (container: HTMLElement) => container.querySelectorAll('span.w-px').length;

describe('MonthlyColumns', () => {
  it('draws a divider between December and January', () => {
    const { container } = renderWithProviders(
      <MonthlyColumns
        totals={monthlyTotals([], 'EUR', '2026-09')}
        currency="EUR"
        selected="2026-09"
        lastSelectable="2026-09"
      />,
    );
    expect(dividers(container)).toBe(2);
  });

  it('draws none when the twelve months are a single calendar year', () => {
    const { container } = renderWithProviders(
      <MonthlyColumns
        totals={monthlyTotals([], 'EUR', '2026-12')}
        currency="EUR"
        selected="2026-12"
        lastSelectable="2026-12"
      />,
    );
    expect(dividers(container)).toBe(0);
  });
});

describe('CategoryBars', () => {
  it('reports the picked category, null for the uncategorised row', async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <CategoryBars
        breakdown={[
          { category: 'food', minor: 500, count: 2 },
          { category: null, minor: 100, count: 1 },
        ]}
        byId={new Map()}
        currency="EUR"
        selected="food"
        onSelect={onSelect}
      />,
    );
    const [food, none] = screen.getAllByRole('button');
    expect(food).toHaveAttribute('aria-pressed', 'true');
    expect(none).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(none);
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
