import 'fake-indexeddb/auto';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { db } from '@/db/db';
import { putPluginRecord } from '@/db/pluginRecords';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';
import en from './locales/en.json';
import { periodDayData } from './model';
import { PeriodDayWidget } from './PeriodDayWidget';

/* The card is on every day, so the flow buttons are always reachable: in full when there is
   something to say, otherwise as one quiet button that opens it. */

const TODAY = '2026-08-10';
const PAST = '2026-08-05';
const FUTURE = '2026-08-15';
const OPEN = 'Log a period for this day';

const mark = (dateKey: string) =>
  putPluginRecord('period-tracker', 'record', dateKey, periodDayData('heavy'));

const markedOn = async (dateKey: string) =>
  (await db.pluginRecords
    .where('[pluginId+dateKey]')
    .equals(['period-tracker', dateKey])
    .first()) !== undefined;

beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', { plugins: { 'period-tracker': en } }, true, true);
  await i18n.changeLanguage('en');
  await db.pluginRecords.clear();
  await db.outbox.clear();
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${TODAY}T12:00:00`) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PeriodDayWidget', () => {
  it('never offers the buttons, or the quiet button, on a future day', async () => {
    renderWithProviders(<PeriodDayWidget dateKey={FUTURE} />);
    // Let the reads settle, then confirm nothing interactive was drawn.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('shows only the prediction’s words on a future day inside a predicted window', async () => {
    // Two cycles 28 days apart put the next one around 2026-08-12, so the 15th is inside it.
    for (const start of ['2026-06-15', '2026-07-13']) {
      for (let d = 0; d < 4; d++) {
        const day = new Date(`${start}T12:00:00`);
        day.setDate(day.getDate() + d);
        await mark(day.toISOString().slice(0, 10));
      }
    }
    renderWithProviders(<PeriodDayWidget dateKey={FUTURE} />);

    expect(await screen.findByRole('heading', { name: 'Period tracker' })).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['today', TODAY],
    ['a past day', PAST],
  ])(
    'offers the quiet button on %s with nothing to say, opening the card unlocked',
    async (_, day) => {
      const user = userEvent.setup();
      renderWithProviders(<PeriodDayWidget dateKey={day} />);

      await user.click(await screen.findByRole('button', { name: OPEN }));

      const heavy = screen.getByRole('radio', { name: 'Heavy' });
      expect(heavy).toBeEnabled();
      await user.click(heavy);
      await waitFor(async () => expect(await markedOn(day)).toBe(true));
    },
  );

  it('opens a marked past day in full, locked until unlocked', async () => {
    const user = userEvent.setup();
    await mark(PAST);
    renderWithProviders(<PeriodDayWidget dateKey={PAST} />);

    const heavy = await screen.findByRole('radio', { name: 'Heavy' });
    expect(heavy).toHaveAttribute('aria-checked', 'true');
    expect(heavy).toBeDisabled();
    expect(screen.queryByRole('button', { name: OPEN })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Unlock this day' }));
    expect(heavy).toBeEnabled();
  });

  it('shows the full card when moving between two marked past days', async () => {
    // The regression this shares with the expense tracker: the "shown" flag was reset on navigation
    // and only set again when the *answer* changed, so a marked day after a marked day showed nothing.
    const user = userEvent.setup();
    const OTHER_PAST = '2026-08-03';
    await mark(PAST);
    await mark(OTHER_PAST);

    function Navigator() {
      const [day, setDay] = useState(PAST);
      return (
        <>
          <Button onClick={() => setDay(OTHER_PAST)}>previous day</Button>
          <PeriodDayWidget dateKey={day} />
        </>
      );
    }
    renderWithProviders(<Navigator />);

    await screen.findByRole('radio', { name: 'Heavy' });
    await user.click(screen.getByRole('button', { name: 'Unlock this day' }));
    await user.click(screen.getByRole('button', { name: 'previous day' }));

    expect(await screen.findByRole('radio', { name: 'Heavy' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByRole('button', { name: OPEN })).not.toBeInTheDocument();
    // The unlock belonged to the other day.
    expect(screen.getByRole('button', { name: 'Unlock this day' })).toBeInTheDocument();
  });

  it('keeps the card open after unmarking the day it opened for', async () => {
    const user = userEvent.setup();
    await mark(TODAY);
    renderWithProviders(<PeriodDayWidget dateKey={TODAY} />);

    await user.click(await screen.findByRole('radio', { name: 'No period' }));
    await waitFor(async () => expect(await markedOn(TODAY)).toBe(false));
    // Still there — the card that button lives on didn't vanish from under the tap.
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'No period' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    expect(screen.queryByRole('button', { name: OPEN })).not.toBeInTheDocument();
  });
});
