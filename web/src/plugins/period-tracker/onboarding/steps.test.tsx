import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';
import en from '../locales/en.json';
import { CalendarStep } from './CalendarStep';
import { CyclePageStep } from './CyclePageStep';
import { DayWarningsStep } from './DayWarningsStep';

/* Each screen of the period tracker's own tour, rendered on its own rather than through
   PluginOnboarding (that dialog's chrome is PluginOnboarding.test.tsx's job) — what matters here is
   that each step reuses the real plugin components rather than a redrawing of them, and reads its
   own strings rather than raw keys. */

beforeEach(() => {
  i18n.addResourceBundle('en', 'translation', { plugins: { 'period-tracker': en } }, true, true);
});

describe('CyclePageStep', () => {
  it('previews a logged period through the real CycleCard, expanded, with nothing to save', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CyclePageStep />);

    // The per-day list is open on arrival — the whole point of this preview, so the disclosure
    // already reads as its *opened* state rather than the label a first click would reveal — and
    // shows all three flow levels, not just one repeated five times.
    expect(screen.getByRole('button', { name: 'Hide per-day intensity' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getAllByRole('radio', { name: 'Light' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('radio', { name: 'Heavy' }).length).toBeGreaterThan(0);

    // Genuinely live: picking a different level for a day actually flips its selected icon. The
    // last day (light by default) rather than the first (already heavy) — clicking a button that
    // was already selected would prove nothing about whether the click did anything.
    const lastDayHeavy = screen.getAllByRole('radio', { name: 'Heavy' }).at(-1)!;
    expect(lastDayHeavy).toHaveAttribute('aria-checked', 'false');
    await user.click(lastDayHeavy);
    expect(lastDayHeavy).toHaveAttribute('aria-checked', 'true');

    // But nothing here can actually be created, edited or deleted.
    expect(screen.getByRole('button', { name: 'Add a past period' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    // The tooltip echoing this same note is closed by default (Radix doesn't mount its content
    // until hovered/focused), so only the always-visible caption shows up here.
    expect(screen.getByText('Just a preview — nothing here is saved.')).toBeInTheDocument();
  });
});

describe('DayWarningsStep', () => {
  it('shows the heads-up text and the recording control as the two examples they are', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DayWarningsStep />);

    // The literal example from the request this step exists to satisfy.
    expect(screen.getByText('Period may arrive in about 5 days')).toBeInTheDocument();

    // The control is live — selecting a level, or "no period" (how a period is marked over),
    // actually moves the selection.
    const heavy = screen.getByRole('radio', { name: 'Heavy' });
    const off = screen.getByRole('radio', { name: 'No period' });
    expect(heavy).toHaveAttribute('aria-checked', 'false');
    await user.click(heavy);
    expect(heavy).toHaveAttribute('aria-checked', 'true');
    await user.click(off);
    expect(off).toHaveAttribute('aria-checked', 'true');
    expect(heavy).toHaveAttribute('aria-checked', 'false');
  });
});

describe('CalendarStep', () => {
  it('pins the switcher to Period tracker and shades the grid in the plugin’s own hue', () => {
    const { container } = renderWithProviders(<CalendarStep />);

    expect(screen.getByRole('tab', { name: 'Period tracker' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Entries' })).toBeDisabled();

    // 21 fabricated days, none of them a real one to navigate to.
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    // Shaded with the plugin's own reddish hue (registry.ts's `220, 38, 38`) rather than the
    // shared violet every plugin without one falls back to — the whole reason this reads at
    // `findPlugin('period-tracker').hue` instead of a literal. Legend swatches carry the same hue
    // too (bar the "less" one, transparent by design), so this filters to actual `rgba(...)` reads
    // rather than every `background-color` in the card.
    const tinted = [...container.querySelectorAll<HTMLElement>('[style*="background-color"]')]
      .map((cell) => cell.style.backgroundColor)
      .filter((color) => color.startsWith('rgba'));
    expect(tinted.length).toBeGreaterThan(0);
    expect(tinted.every((color) => color.includes('220, 38, 38'))).toBe(true);

    // A confirmed day (opaque) and a predicted one (a light wash of the same hue) both land
    // inside the grid, at visibly different strengths — and most of the 21 days are neither,
    // carrying no background at all rather than `pluginHeatmapBg`'s own baseline tint, the same
    // choice `usePeriodCalendar` makes by simply not reporting a day it has nothing to say about.
    const opacities = new Set(tinted.map((color) => Number(color.match(/([\d.]+)\)$/)?.[1])));
    expect(Math.max(...opacities)).toBeGreaterThan(Math.min(...opacities));
    expect(container.querySelectorAll('.grid > div').length).toBeGreaterThan(tinted.length);
  });
});
