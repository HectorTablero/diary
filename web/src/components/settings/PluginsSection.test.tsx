import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';

/* The tour button's own gating, kept apart from PluginOnboarding.test.tsx (the dialog it opens)
   and from habits/onboarding/steps.test.tsx (that dialog's real content) — this only asserts that
   Settings shows the button for a plugin declaring the surface, not for one that doesn't, and that
   pressing it hands the right plugin id to the dialog. */

const enabledIds = vi.hoisted(() => ({ value: new Set<string>() }));

vi.mock('@/db/pluginRecords', () => ({ countPluginRecords: vi.fn(async () => 0) }));
vi.mock('@/plugins/enabled', () => ({
  useEnabledPlugins: () => enabledIds.value,
  setPluginEnabled: vi.fn(async () => {}),
}));
vi.mock('@/plugins/i18n', () => ({ ensurePluginLocales: vi.fn(async () => {}) }));
vi.mock('@/plugins/nativeWidgets', () => ({ syncNativeWidgets: vi.fn(async () => {}) }));
vi.mock('@/plugins/PluginOnboarding', () => ({
  PluginOnboarding: ({ pluginId, onDone }: { pluginId: string; onDone: () => void }) => (
    <div role="dialog" aria-label={`tour:${pluginId}`}>
      <button onClick={onDone}>end tour</button>
    </div>
  ),
}));
vi.mock('@/plugins/registry', async () => {
  const { CircleCheckBig, Cake } = await import('lucide-react');
  return {
    PLUGINS: [
      { id: 'habits', icon: CircleCheckBig, surfaces: ['day', 'onboarding'], load: vi.fn() },
      // Enabled and real, but has no tour of its own — must get no button.
      { id: 'no-tour', icon: Cake, surfaces: ['day'], load: vi.fn() },
    ],
  };
});

const { PluginsSection } = await import('./PluginsSection');

beforeEach(() => {
  enabledIds.value = new Set();
  // ensurePluginLocales is mocked to a no-op above, so the plugin's own strings need to be here
  // already — same seeding HabitControls.test.tsx uses, kept minimal since only the switch's own
  // label is under test here, not the habits plugin's real copy.
  i18n.addResourceBundle(
    'en',
    'translation',
    {
      plugins: {
        habits: { name: 'Habits', description: 'Track daily habits.' },
        'no-tour': { name: 'No Tour', description: 'Has no tour of its own.' },
      },
    },
    true,
    true,
  );
});

describe('a plugin that declares the onboarding surface', () => {
  it('gets a tour button, and the one without the surface does not', async () => {
    renderWithProviders(<PluginsSection />);

    await screen.findByRole('switch', { name: 'Habits' });
    expect(screen.getByRole('button', { name: 'Take a quick tour' })).toBeInTheDocument();
    // The other plugin renders too, but earns no button of its own.
    expect(screen.getByRole('switch', { name: 'No Tour' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Take a quick tour' })).toHaveLength(1);
  });

  it('opens that plugin’s tour, without requiring the switch to be on first', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PluginsSection />);
    await screen.findByRole('switch', { name: 'Habits' });

    // Off, and the button still works — a tour is how someone decides whether to turn it on.
    expect(screen.getByRole('switch', { name: 'Habits' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Take a quick tour' }));

    expect(screen.getByRole('dialog', { name: 'tour:habits' })).toBeInTheDocument();
  });

  it('closes the tour and can reopen it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PluginsSection />);
    await screen.findByRole('switch', { name: 'Habits' });

    await user.click(screen.getByRole('button', { name: 'Take a quick tour' }));
    await user.click(screen.getByRole('button', { name: 'end tour' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Take a quick tour' }));
    expect(screen.getByRole('dialog', { name: 'tour:habits' })).toBeInTheDocument();
  });
});
