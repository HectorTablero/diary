import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { getPreferences, resetPreferences } from '@/lib/preferences';
import { renderWithProviders } from '@/test/renderWithProviders';
import OnboardingFlow from './OnboardingFlow';

/* The extra step the phone build gets.
 *
 * Its own file rather than a `describe` in the main one, because `isNative` is read at module scope
 * in half a dozen places — mocking it per-test would mean resetting the module registry between
 * cases, and a file boundary is what vitest already gives for free.
 */

vi.mock('@/lib/native', () => ({ isNative: true }));

/* The permission getters, not the whole module. With `isNative` mocked true the real ones would
   call into @capacitor/local-notifications, which under jsdom has no implementation to call — and
   what is worth asserting here is that the tour *asks* rather than what Android answered. */
const permission = vi.hoisted(() => ({ value: 'prompt' as 'granted' | 'denied' | 'prompt' }));
const requested = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/lib/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications')>()),
  getNotificationPermission: async () => permission.value,
  requestNotificationPermission: async () => {
    requested.count++;
    permission.value = 'granted';
  },
}));

const setup = () => {
  const onDone = vi.fn();
  return {
    onDone,
    user: userEvent.setup(),
    ...renderWithProviders(<OnboardingFlow onDone={onDone} />),
  };
};

const toLastStep = async (user: ReturnType<typeof userEvent.setup>) => {
  for (let i = 0; i < 4; i++) {
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('status');
  }
  await screen.findByText('A nudge at the end of the day');
};

beforeEach(async () => {
  permission.value = 'prompt';
  requested.count = 0;
  resetPreferences();
  await i18n.changeLanguage('en');
  localStorage.removeItem('lang');
});

afterEach(() => {
  resetPreferences();
  localStorage.removeItem('lang');
});

describe('OnboardingFlow · on a phone', () => {
  it('adds a fifth step and counts it', async () => {
    const { user } = setup();
    expect(screen.getByRole('status')).toHaveTextContent('Step 1 of 5');
    await toLastStep(user);
    expect(screen.getByRole('status')).toHaveTextContent('Step 5 of 5');
    // Still the hand-off, not a sixth step.
    expect(screen.getByRole('button', { name: 'Get started' })).toBeInTheDocument();
  });

  it('asks for the notification permission only when the button is pressed', async () => {
    const { user } = setup();
    await toLastStep(user);

    /* Arriving on the step must not raise the system dialog: the ask has to be attached to the
       moment the reason for it is on screen *and* the user acted. */
    expect(requested.count).toBe(0);

    await user.click(screen.getByRole('button', { name: /Allow notifications/i }));
    expect(requested.count).toBe(1);
  });

  it('turns the daily reminder off from inside the tour', async () => {
    const { user } = setup();
    await toLastStep(user);

    // On by default, so the interesting direction is off.
    expect(getPreferences().dailyReminder).toBe(true);
    await user.click(screen.getByRole('switch', { name: /Daily diary reminder/i }));

    expect(getPreferences().dailyReminder).toBe(false);
    /* The scheduling path is the preference itself — main.tsx re-runs refreshNotifications() on
       every change — so there is nothing else for this step to call, and the time picker that
       qualifies the setting goes away with it. */
    expect(screen.queryByLabelText(/^At$/i)).not.toBeInTheDocument();
  });
});
