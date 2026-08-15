import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';
import en from '../locales/en.json';
import { AddHabitsStep } from './AddHabitsStep';
import { CalendarStep } from './CalendarStep';
import { TypesStep } from './TypesStep';
import { WidgetStep } from './WidgetStep';

/* Each screen of the habit tracker's own tour, rendered on its own rather than through
   PluginOnboarding — that dialog's chrome (navigation, progress, the empty/failed guard) is
   PluginOnboarding.test.tsx's job; what matters here is that each step's content renders, reads
   its own strings rather than raw keys, and reuses the real day-page controls rather than a
   redrawing of them. */

beforeEach(() => {
  i18n.addResourceBundle('en', 'translation', { plugins: { habits: en } }, true, true);
});

describe('AddHabitsStep', () => {
  it('previews the creation form, live, with nothing to submit', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AddHabitsStep />);

    // Defaults to the numeric kind, so its extra fields are visible without a first click.
    expect(screen.getByLabelText('Habit name')).toHaveValue('Cycling');
    expect(screen.getByLabelText('Daily goal')).toHaveValue('10');
    expect(screen.getByLabelText('Unit')).toHaveValue('km');

    // Genuinely live: picking another kind swaps the hint and the extra fields, same as the real
    // form — the thing this preview exists to demonstrate.
    await user.click(screen.getByLabelText('Type'));
    await user.click(screen.getByRole('option', { name: 'Done or not' }));
    expect(screen.getByText('A box you tick — did it happen today.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Daily goal')).not.toBeInTheDocument();

    // But nothing here can actually be created.
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New habit' })).toBeDisabled();
    expect(screen.getByText('Just a preview — nothing here is saved.')).toBeInTheDocument();
  });
});

describe('TypesStep', () => {
  it('shows all five kinds through the real day-page controls, read-only', () => {
    renderWithProviders(<TypesStep />);

    // Binary: ticked, and on a long enough run to read amber. Scoped to its own row — Sleep
    // quality and Mood are always "met" (a rating or a mood *is* its own goal) and run streaks of
    // their own, so several rows share the amber badge and a page-wide `getByText('5')` would be
    // ambiguous by design, not by accident.
    const meditateRow = screen.getByRole('checkbox', { name: 'Meditate' }).closest('li')!;
    expect(screen.getByRole('checkbox', { name: 'Meditate' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByLabelText('Meditate')).toBeDisabled();
    expect(within(meditateRow).getByText('5')).toBeInTheDocument();

    // Numeric: short of its goal, so its run is about to break rather than continue — the one
    // badge in this list that stays grey.
    const pushupsRow = screen.getByText('20 reps').closest('li')!;
    expect(within(pushupsRow).getByText('3')).toBeInTheDocument();

    // Time, scale and mood are all present too, each as the control HabitsDayWidget itself uses.
    expect(screen.getByText('Read')).toBeInTheDocument();
    // The scale's accessible name lives on Radix's Root, one level up from the Thumb that actually
    // carries role="slider" — a pre-existing gap in ScaleControl itself, not this preview, so this
    // only asserts the track renders rather than asserting a name nothing here can give it.
    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Mood' })).toBeInTheDocument();

    // Read-only throughout: nothing here is a habit that can actually be ticked.
    for (const control of screen.getAllByRole('button')) expect(control).toBeDisabled();
  });
});

describe('CalendarStep', () => {
  it('pins the switcher to Habits and disables the tab with nothing behind it', () => {
    renderWithProviders(<CalendarStep />);

    expect(screen.getByRole('tab', { name: 'Habits' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Entries' })).toBeDisabled();

    // 21 fabricated days, none of them a real one to navigate to.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('WidgetStep', () => {
  it('mimics the real widget — its own logo, title, counter and a scrollable list — never an image', () => {
    const { container } = renderWithProviders(<WidgetStep />);

    expect(screen.getByText('Home screen widget')).toBeInTheDocument();

    // The widget's own header, distinct from TypesStep's day-card header: the diary's logo mark
    // rather than the habits plugin icon, and the same "met/total" counter.
    const widget = screen.getByRole('region', { name: 'Home screen widget' });
    expect(within(widget).getByText('Habits')).toBeInTheDocument();
    expect(within(widget).getByText('3/5')).toBeInTheDocument();

    // The same five examples TypesStep shows — one cast of habits, not a fresh invention here.
    expect(within(widget).getByText('Meditate')).toBeInTheDocument();
    expect(within(widget).getByText('20 reps')).toBeInTheDocument();

    // Push-ups' streak carries over into the widget too, and stays grey here for the same reason
    // it does on the day page: short of today's goal, so the run is about to break rather than
    // continue — a streak badge that read amber regardless would say the opposite of what the
    // numbers next to it say.
    const pushupsRow = within(widget).getByText('20 reps').closest('li')!;
    expect(within(pushupsRow).getByText('3')).not.toHaveClass('text-amber-700');

    // Fixed and scrollable, the one thing a home-screen widget's list must be and a same-height
    // card cannot demonstrate.
    const list = container.querySelector('ul.overflow-y-auto');
    expect(list).toBeInTheDocument();
    expect(list).toHaveClass('max-h-44');

    expect(container.querySelector('img')).not.toBeInTheDocument();
  });
});

describe('habitsOnboardingSteps', () => {
  it('includes the widget step only on native', async () => {
    vi.resetModules();
    vi.doMock('@/lib/native', () => ({ isNative: false }));
    const { habitsOnboardingSteps: webSteps } = await import('./steps');
    expect(webSteps.map((step) => step.id)).toEqual(['add', 'types', 'calendar']);

    vi.resetModules();
    vi.doMock('@/lib/native', () => ({ isNative: true }));
    const { habitsOnboardingSteps: nativeSteps } = await import('./steps');
    expect(nativeSteps.map((step) => step.id)).toEqual(['add', 'types', 'calendar', 'widget']);

    vi.doUnmock('@/lib/native');
    vi.resetModules();
  });
});
