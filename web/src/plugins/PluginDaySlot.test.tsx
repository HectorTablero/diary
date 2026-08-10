import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';

/* The one behaviour that makes plugins worth having: costing nothing when you have none.
 *
 * "Nothing" is stricter than "renders null". A slot that renders null *after* fetching a chunk to
 * ask it what to draw has already spent the download — and the app would look perfectly correct
 * while doing it, on every day page, for every user, for every plugin that ever ships. So what is
 * asserted here is that `load()` is never called. */

const loads = vi.hoisted(() => ({ habits: vi.fn() }));
const enabledIds = vi.hoisted(() => ({ value: new Set<string>() }));

vi.mock('./enabled', () => ({
  useEnabledPlugins: () => enabledIds.value,
}));

vi.mock('./i18n', () => ({
  ensurePluginLocales: vi.fn(async () => {}),
}));

vi.mock('./registry', async () => {
  const { CircleCheckBig, Cake } = await import('lucide-react');
  return {
    PLUGINS: [
      {
        id: 'habits',
        icon: CircleCheckBig,
        surfaces: ['day'],
        load: loads.habits,
      },
      // Declares no day surface, so the slot must skip it without loading it — this is what the
      // `surfaces` field on the manifest exists for.
      {
        id: 'pageonly',
        icon: Cake,
        surfaces: ['page'],
        load: vi.fn(() => {
          throw new Error('a plugin with no day widget must never be loaded by the day slot');
        }),
      },
    ],
  };
});

const { PluginDaySlot } = await import('./PluginDaySlot');

beforeEach(() => {
  enabledIds.value = new Set();
  loads.habits.mockReset().mockResolvedValue({
    default: { DayWidget: () => <div>habits widget</div> },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('with no plugins enabled', () => {
  it('renders nothing and loads nothing', async () => {
    const { container } = renderWithProviders(<PluginDaySlot dateKey="2026-08-10" />);

    expect(container.textContent).toBe('');
    // The assertion the whole design is for. Not "renders null" — never asked.
    expect(loads.habits).not.toHaveBeenCalled();
  });
});

describe('with a plugin enabled', () => {
  beforeEach(() => {
    enabledIds.value = new Set(['habits', 'pageonly']);
  });

  it('renders its day widget', async () => {
    renderWithProviders(<PluginDaySlot dateKey="2026-08-10" />);

    expect(await screen.findByText('habits widget')).toBeInTheDocument();
  });

  it('still never loads a plugin that declares no day surface', async () => {
    renderWithProviders(<PluginDaySlot dateKey="2026-08-10" />);

    await screen.findByText('habits widget');
    // `pageonly`'s loader throws if called; reaching here at all is the assertion.
    expect(loads.habits).toHaveBeenCalledTimes(1);
  });

  it('survives a plugin that fails to load', async () => {
    // A broken habit tracker must not be able to take down the diary's main screen.
    loads.habits.mockRejectedValue(new Error('chunk 404'));

    const { container } = renderWithProviders(<PluginDaySlot dateKey="2026-08-10" />);

    await waitFor(() => expect(loads.habits).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('draws nothing when a manifest claims a surface the module does not fill', async () => {
    loads.habits.mockResolvedValue({ default: {} });

    const { container } = renderWithProviders(<PluginDaySlot dateKey="2026-08-10" />);

    await waitFor(() => expect(loads.habits).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
