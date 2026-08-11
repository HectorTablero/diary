import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Same contract as PluginDaySlot's, one level earlier: nothing enabled must cost nothing (no
   locale fetch, nobody in the list), and a plugin that doesn't declare "calendar" never gets a tab
   just because it happens to be enabled for something else. */

const enabledIds = vi.hoisted(() => ({ value: new Set<string>() }));
const ensureLocales = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('./enabled', () => ({ useEnabledPlugins: () => enabledIds.value }));
vi.mock('./i18n', () => ({ ensurePluginLocales: ensureLocales }));

vi.mock('./registry', async () => {
  const { CircleCheckBig, Cake } = await import('lucide-react');
  return {
    PLUGINS: [
      { id: 'habits', icon: CircleCheckBig, surfaces: ['day', 'calendar'], load: vi.fn() },
      // Enabled below, but declares no calendar view — must not get a tab either.
      { id: 'dayonly', icon: Cake, surfaces: ['day'], load: vi.fn() },
    ],
  };
});

const { usePluginCalendarViews } = await import('./usePluginCalendarViews');

beforeEach(() => {
  enabledIds.value = new Set();
  ensureLocales.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('with no plugins enabled', () => {
  it('returns nothing, and fetches no locale', async () => {
    const { result } = renderHook(() => usePluginCalendarViews());

    expect(result.current).toEqual([]);
    expect(ensureLocales).not.toHaveBeenCalled();
  });
});

describe('with a plugin enabled', () => {
  beforeEach(() => {
    enabledIds.value = new Set(['habits', 'dayonly']);
  });

  it('lists only the one that declares a calendar view', async () => {
    const { result } = renderHook(() => usePluginCalendarViews());

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].id).toBe('habits');
  });

  it('waits for the locale before listing it', async () => {
    let resolveLocale!: () => void;
    ensureLocales.mockReturnValue(new Promise<void>((resolve) => (resolveLocale = resolve)));

    const { result } = renderHook(() => usePluginCalendarViews());
    expect(result.current).toEqual([]);

    resolveLocale();
    await waitFor(() => expect(result.current).toHaveLength(1));
  });
});
