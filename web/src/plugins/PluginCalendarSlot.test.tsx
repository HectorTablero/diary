import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';

/* Unlike PluginDaySlot, this component does not decide *which* plugin to show — CalendarPage and
   usePluginCalendarViews already did that before it is ever rendered. What is asserted here is
   that loading one plugin's chunk can never take the calendar page down: no crash on a rejected
   chunk, no call at all to onData when the module doesn't fill CalendarView. */

const loads = vi.hoisted(() => ({ habits: vi.fn() }));

vi.mock('./i18n', () => ({
  ensurePluginLocales: vi.fn(async () => {}),
}));

const { PluginCalendarSlot } = await import('./PluginCalendarSlot');
const { CircleCheckBig } = await import('lucide-react');

const habitsPlugin = {
  id: 'habits',
  icon: CircleCheckBig,
  surfaces: ['calendar'] as const,
  load: loads.habits,
};

beforeEach(() => {
  loads.habits.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('a plugin that fills CalendarView', () => {
  it('mounts it with the given range and forwards onData', async () => {
    loads.habits.mockResolvedValue({
      default: {
        CalendarView: ({
          start,
          end,
          onData,
        }: {
          start: string;
          end: string;
          onData: (data: ReadonlyMap<string, { level: number; label: string }>) => void;
        }) => {
          onData(new Map([[start, { level: 1, label: `${start}..${end}` }]]));
          return null;
        },
      },
    });
    const onData = vi.fn();

    renderWithProviders(
      <PluginCalendarSlot
        plugin={habitsPlugin}
        start="2026-08-01"
        end="2026-08-31"
        onData={onData}
      />,
    );

    await waitFor(() =>
      expect(onData).toHaveBeenCalledWith(
        new Map([['2026-08-01', { level: 1, label: '2026-08-01..2026-08-31' }]]),
      ),
    );
  });
});

describe('a plugin that cannot supply one', () => {
  it('never calls onData when the chunk fails to load', async () => {
    loads.habits.mockRejectedValue(new Error('chunk 404'));
    const onData = vi.fn();

    renderWithProviders(
      <PluginCalendarSlot
        plugin={habitsPlugin}
        start="2026-08-01"
        end="2026-08-31"
        onData={onData}
      />,
    );

    await waitFor(() => expect(loads.habits).toHaveBeenCalled());
    expect(onData).not.toHaveBeenCalled();
  });

  it('never calls onData when the manifest claims a surface the module does not fill', async () => {
    loads.habits.mockResolvedValue({ default: {} });
    const onData = vi.fn();

    renderWithProviders(
      <PluginCalendarSlot
        plugin={habitsPlugin}
        start="2026-08-01"
        end="2026-08-31"
        onData={onData}
      />,
    );

    await waitFor(() => expect(loads.habits).toHaveBeenCalled());
    expect(onData).not.toHaveBeenCalled();
  });
});
