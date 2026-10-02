import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';

/* The plugin route is the only surface reachable by URL, which means it is reachable in states the
   UI would never offer: a bookmark kept after switching a plugin off, a link from a device that has
   it enabled, a typo. A switched-off plugin gets a page offering to turn it on; everything else goes
   quietly back to the diary — and none of them may fetch a chunk on the way. */

const loads = vi.hoisted(() => ({ habits: vi.fn(), widgetOnly: vi.fn() }));
const enabledIds = vi.hoisted(() => ({ value: new Set<string>() }));

const setPluginEnabled = vi.hoisted(() => vi.fn());
vi.mock('./enabled', () => ({
  useEnabledPlugins: () => enabledIds.value,
  setPluginEnabled,
}));
vi.mock('./nativeWidgets', () => ({ syncNativeWidgets: vi.fn(async () => {}) }));
vi.mock('./PluginOnboarding', () => ({ PluginOnboarding: () => <div>Tour</div> }));
vi.mock('./i18n', () => ({ ensurePluginLocales: vi.fn(async () => {}) }));
vi.mock('./registry', async () => {
  const { CircleCheckBig, Cake } = await import('lucide-react');
  const PLUGINS = [
    {
      id: 'habits',
      icon: CircleCheckBig,
      surfaces: ['day', 'page', 'onboarding'],
      load: loads.habits,
    },
    // Enabled, but has no page — a URL naming it is as unreachable as an unknown id.
    { id: 'widgetonly', icon: Cake, surfaces: ['day'], load: loads.widgetOnly },
  ];
  return {
    PLUGINS,
    findPlugin: (id: string) => PLUGINS.find((plugin) => plugin.id === id),
  };
});

const { default: PluginPage } = await import('./PluginPage');

const renderAt = (pluginId: string) =>
  renderWithProviders(null, {
    routes: [
      { path: '/plugins/:pluginId', element: <PluginPage /> },
      { path: '/diary', element: <h1>Diary</h1> },
    ],
    initialEntries: [`/plugins/${pluginId}`],
  });

beforeEach(() => {
  enabledIds.value = new Set(['habits', 'widgetonly']);
  loads.habits.mockReset().mockResolvedValue({ default: { Page: () => <h1>Habits page</h1> } });
  loads.widgetOnly.mockReset().mockResolvedValue({ default: {} });
  setPluginEnabled.mockReset().mockResolvedValue(undefined);
});

describe('an enabled plugin with a page', () => {
  it('renders the plugin’s own screen', async () => {
    renderAt('habits');

    expect(await screen.findByRole('heading', { name: 'Habits page' })).toBeInTheDocument();
  });
});

describe('a plugin that is switched off', () => {
  // A bookmark kept after disabling it, or a link from a device where it is still on.
  beforeEach(() => {
    enabledIds.value = new Set();
  });

  it('offers to switch it on, without loading its chunk', async () => {
    const user = userEvent.setup();
    renderAt('habits');

    const toggle = await screen.findByRole('switch');
    /* The assertion that matters: the guard is checked *before* the chunk is fetched, so a
       disabled plugin costs nothing even when its URL is opened directly. */
    expect(loads.habits).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Diary' })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(setPluginEnabled).toHaveBeenCalledWith('habits', true);
  });

  it('offers the plugin’s tour from there', async () => {
    const user = userEvent.setup();
    renderAt('habits');

    await user.click(await screen.findByRole('button', { name: /tour/i }));
    expect(await screen.findByText('Tour')).toBeInTheDocument();
  });
});

describe('everything else goes back to the diary', () => {
  it('redirects an unknown plugin id', async () => {
    renderAt('nope');

    expect(await screen.findByRole('heading', { name: 'Diary' })).toBeInTheDocument();
    expect(loads.habits).not.toHaveBeenCalled();
  });

  it('redirects a plugin that declares no page, without loading it', async () => {
    renderAt('widgetonly');

    expect(await screen.findByRole('heading', { name: 'Diary' })).toBeInTheDocument();
    expect(loads.widgetOnly).not.toHaveBeenCalled();
  });

  it('redirects when the chunk fails to load', async () => {
    loads.habits.mockRejectedValue(new Error('chunk 404'));

    renderAt('habits');

    // Offline with an evicted chunk. There is nothing useful to say about it, and a blank screen
    // with the app's nav around it reads as broken.
    await waitFor(() => expect(loads.habits).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Diary' })).toBeInTheDocument();
  });
});
