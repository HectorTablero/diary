import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';
import { HabitControl, HabitProgress, useLiveHabitValue } from './HabitControls';
import en from './locales/en.json';
import type { Habit } from './model';

/* Typing a value, which is the half a stepper cannot do: 47 push-ups is nine taps, and a stopwatch
   left running an hour too long cannot be corrected by tapping at all. */

const habit = (patch: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: 'Push-ups',
  type: 'numeric',
  since: '2026-01-01',
  revisions: [],
  order: 0,
  archivedAt: null,
  ...patch,
});

function Harness({ subject, value }: { subject: Habit; value: number }) {
  const live = useLiveHabitValue(subject, value, '2026-08-10');
  return <HabitControl habit={subject} live={live} dateKey="2026-08-10" onChange={onChange} />;
}

const onChange = vi.fn();

beforeEach(() => {
  i18n.addResourceBundle('en', 'translation', { plugins: { habits: en } }, true, true);
  onChange.mockClear();
  localStorage.clear();
});

describe('typing a count', () => {
  it('replaces the value', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness subject={habit()} value={3} />);

    await user.click(screen.getByRole('button', { name: 'Edit Push-ups' }));
    await user.keyboard('47{Enter}');

    expect(onChange).toHaveBeenLastCalledWith(47);
  });

  it('abandons on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness subject={habit()} value={3} />);

    await user.click(screen.getByRole('button', { name: 'Edit Push-ups' }));
    await user.keyboard('47{Escape}');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('abandons something it cannot parse rather than guessing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness subject={habit()} value={3} />);

    await user.click(screen.getByRole('button', { name: 'Edit Push-ups' }));
    // Silently turning "3o" into 3 is worse than leaving what was there.
    await user.keyboard('3o{Enter}');

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the field that replaces the value', () => {
  /* jsdom computes no layout, so these assert the declared width rather than pixels — but it is the
     declared width that decides them, and the bug was always in the declaration. Left to itself an
     `<input>` is twenty characters wide by specification, several times the slot the button was in;
     `min-w-*` cannot cap that, and content-derived sizing resolves differently for the button's
     string and the field's, which is the resize rather than a fix for it. */

  const reading = habit({ id: 'h6', name: 'Reading', type: 'time' });

  it('opens at exactly the width the button had', async () => {
    const user = userEvent.setup();
    // 849s reads "14m" and opens on "14:09" — different strings, and the point of the exercise.
    renderWithProviders(<Harness subject={reading} value={849} />);

    const button = screen.getByRole('button', { name: 'Edit Reading' });
    const before = button.style.width;
    await user.click(button);

    expect(screen.getByRole('textbox', { name: 'Edit Reading' }).style.width).toBe(before);
  });

  it('is measured against the longest thing it can hold, not just what is on screen', () => {
    renderWithProviders(<Harness subject={reading} value={849} />);

    /* "14m" is three characters; the box is sized for the seconds a running stopwatch will show
       ("14m 9s") so that pressing play moves nothing. The floor is five characters. */
    expect(screen.getByRole('button', { name: 'Edit Reading' })).toHaveStyle({
      width: 'calc(6ch + 0.75rem)',
    });
  });
});

describe('typing a duration', () => {
  const reading = habit({ id: 'h2', name: 'Reading', type: 'time' });

  it.each([
    ['40', 2400],
    ['14:09', 849],
    ['1:20:05', 4805],
  ])('reads %s as %i seconds', async (typed, expected) => {
    const user = userEvent.setup();
    renderWithProviders(<Harness subject={reading} value={0} />);

    await user.click(screen.getByRole('button', { name: 'Edit Reading' }));
    await user.keyboard(`${typed}{Enter}`);

    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it('opens on the full precision, not the rounded display', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness subject={reading} value={849} />);

    // Shown as "14m"; editable as 14:09, so correcting it cannot silently drop the nine seconds.
    await user.click(screen.getByRole('button', { name: 'Edit Reading' }));

    expect(screen.getByRole('textbox', { name: 'Edit Reading' })).toHaveValue('14:09');
  });
});

describe('the progress bar', () => {
  /* A 10-minute goal, two minutes banked and three on the clock. The interesting frame is the one
     right after pausing, when those three minutes move from one bar to the other. */
  const reading = habit({ id: 'h4', name: 'Reading', type: 'time', target: 600 });
  const idle = { running: false, elapsed: 0, start: () => {}, stop: () => 0 };

  function Harness() {
    const [banked, setBanked] = useState(false);
    const live = banked
      ? { committed: 300, pending: 0, total: 300, stopwatch: idle }
      : { committed: 120, pending: 180, total: 300, stopwatch: idle };
    return (
      <>
        <button type="button" onClick={() => setBanked(true)}>
          pause
        </button>
        <HabitProgress habit={reading} live={live} dateKey="2026-08-10" />
      </>
    );
  }

  const widths = (container: HTMLElement) =>
    Array.from(container.querySelector('[aria-hidden="true"]')!.children).map(
      (bar) => (bar as HTMLElement).style.width,
    );

  it('keeps the un-banked preview in place and fills across it when the session is banked', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Harness />);

    // Preview to the total (5 of 10 minutes), solid bar to what is saved (2 of 10).
    expect(widths(container)).toEqual(['50%', '20%']);

    await user.click(screen.getByRole('button', { name: 'pause' }));

    /* The preview does not move — banking conserves the total — and the solid bar grows across it
       to the mark the session had already reached. Laid end to end instead, the pale segment's
       width fell to zero the instant it was banked, so finishing a session made the progress you
       had just earned vanish and then crawl back over 300ms. */
    expect(widths(container)).toEqual(['50%', '50%']);
  });

  it('never shows the preview on a habit that has no stopwatch', () => {
    const pushUps = habit({ id: 'h5', name: 'Push-ups', type: 'numeric', target: 50 });
    const live = { committed: 20, pending: 0, total: 20, stopwatch: idle };
    const { container } = renderWithProviders(
      <HabitProgress habit={pushUps} live={live} dateKey="2026-08-10" />,
    );

    const [preview, filled] = Array.from(
      container.querySelector('[aria-hidden="true"]')!.children,
    ) as HTMLElement[];

    /* Nothing is ever pending on a count, so the band is exactly the bar's width and the grey has
       nowhere to show. It only used to appear because the band snapped to the new value while the
       bar eased into it; with nothing running they now ease together. */
    expect(preview.style.width).toBe(filled.style.width);
    expect(preview.className).toContain('transition-[width]');
  });
});

describe('typing a rating', () => {
  const sleep = habit({ id: 'h3', name: 'Sleep', type: 'scale', min: 1, max: 10 });

  it('clamps to the ends of the scale', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness subject={sleep} value={4} />);

    await user.click(screen.getByRole('button', { name: 'Edit Sleep' }));
    await user.keyboard('99{Enter}');

    // A rating has hard ends: 99 on a 1–10 scale plainly means "the top".
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(10));
  });
});
