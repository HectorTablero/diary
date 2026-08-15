import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';

/* A driver test, not a habits test — it stands in a fake two-step plugin so what is asserted here
   is the dialog chrome itself (navigation, progress, the empty/failed guard) rather than any one
   plugin's content. habits/onboarding/steps.test.tsx covers the real steps. */

vi.mock('./i18n', () => ({ ensurePluginLocales: vi.fn(async () => {}) }));

const loads = vi.hoisted(() => ({ tour: vi.fn(), nothing: vi.fn() }));

vi.mock('./registry', () => {
  const PLUGINS = [
    { id: 'tour-plugin', surfaces: ['onboarding'], load: loads.tour },
    // Declares the surface but its module has nothing for it — the guard against that state, not
    // just against a chunk that fails outright.
    { id: 'empty-plugin', surfaces: ['onboarding'], load: loads.nothing },
  ];
  return { findPlugin: (id: string) => PLUGINS.find((plugin) => plugin.id === id) };
});

const { PluginOnboarding } = await import('./PluginOnboarding');

beforeEach(() => {
  loads.tour.mockReset().mockResolvedValue({
    default: {
      onboardingSteps: [
        { id: 'first', Component: () => <p>First step body</p> },
        { id: 'second', Component: () => <p>Second step body</p> },
      ],
    },
  });
  loads.nothing.mockReset().mockResolvedValue({ default: {} });
});

const setup = (pluginId: string) => {
  const onDone = vi.fn();
  return {
    onDone,
    user: userEvent.setup(),
    ...renderWithProviders(<PluginOnboarding pluginId={pluginId} onDone={onDone} />),
  };
};

describe('PluginOnboarding', () => {
  it('walks a plugin’s own steps by title, with dot progress, and closes on the last one', async () => {
    const { user, onDone } = setup('tour-plugin');

    expect(await screen.findByText('First step body')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Step 1 of 2');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Second step body')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Step 2 of 2');
    expect(screen.queryByText('First step body')).not.toBeInTheDocument();

    // The last step's primary button reads as a finish, not another "Next" — alongside the
    // top-right dismiss, which reads the same on every step, so there are now two of them.
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    expect(closeButtons).toHaveLength(2);
    expect(onDone).not.toHaveBeenCalled();
    await user.click(closeButtons[closeButtons.length - 1]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('steps back with Back, and the first step hides it', async () => {
    const { user } = setup('tour-plugin');
    await screen.findByText('First step body');

    // Kept in the layout rather than unmounted, so the dot progress doesn't jump sideways — but
    // still not a control a screen reader or keyboard user can reach.
    expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('invisible');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Second step body');
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(await screen.findByText('First step body')).toBeInTheDocument();
  });

  it('closes on the top-right button from any step', async () => {
    const { user, onDone } = setup('tour-plugin');
    await screen.findByText('First step body');

    await user.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('closes without opening a dialog when the plugin declares the surface but ships no steps', async () => {
    const { onDone } = setup('empty-plugin');

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the same way when the plugin id is unknown to the registry', async () => {
    const { onDone } = setup('does-not-exist');

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes if the chunk fails to load', async () => {
    loads.tour.mockRejectedValue(new Error('chunk 404'));
    const { onDone } = setup('tour-plugin');

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});
