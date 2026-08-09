import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteObject } from 'react-router';
import { getPreferences, resetPreferences, setPreference } from '@/lib/preferences';
import { renderWithProviders } from '@/test/renderWithProviders';
import LoginPage from './LoginPage';

/* The sign-in screen, and the first-run tour that sits over it.
 *
 * The tour is gated here rather than inside the app because the choice this screen offers — an
 * account, or a local-only diary — is one nobody can make before knowing what the app is. Which
 * makes the ordering of this file's assertions the point: a signed-in user must be redirected
 * *before* the gate is reached, or someone with a three-year diary is shown a welcome tour.
 */

interface SessionResult {
  data: { user: { name: string; email: string; image: string | null } } | null;
  isPending: boolean;
}
const session = vi.hoisted(() => ({
  value: { data: null, isPending: false } as SessionResult,
}));
vi.mock('@/lib/authClient', () => ({ useSession: () => session.value }));

// Reaches better-auth and the native social-login plugin at module scope; no assertion here gets
// as far as pressing the button.
vi.mock('@/lib/googleSignIn', () => ({ googleSignIn: vi.fn(async () => {}) }));

const DIARY = 'the diary';

const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/diary', element: <div>{DIARY}</div> },
];

const setup = () => ({
  user: userEvent.setup(),
  ...renderWithProviders(null, { routes, initialEntries: ['/login'] }),
});

beforeEach(() => {
  session.value = { data: null, isPending: false };
  resetPreferences();
  localStorage.removeItem('lang');
});

afterEach(() => {
  resetPreferences();
  localStorage.removeItem('lang');
});

describe('LoginPage · the first-run gate', () => {
  it('opens the tour over the sign-in screen on a device that has never seen it', async () => {
    setup();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Welcome to your diary')).toBeInTheDocument();
  });

  it('records it and reveals the sign-in choice once the tour is finished', async () => {
    const { user } = setup();
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(getPreferences().onboardingSeen).toBe(true);
    // The point of putting it here: the sign-in decision is made by someone who now knows what
    // they are signing in to, including whether they want an account at all.
    expect(screen.getByRole('button', { name: /Continue with Google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /without an account/i })).toBeInTheDocument();
  });

  it('never shows it twice on the same device', async () => {
    setPreference('onboardingSeen', true);
    setup();
    expect(
      await screen.findByRole('button', { name: /Continue with Google/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('redirects a signed-in visitor without rendering a frame of the tour', async () => {
    session.value = {
      data: { user: { name: 'Ada', email: 'ada@example.com', image: null } },
      isPending: false,
    };
    const { router } = setup();

    await waitFor(() => expect(router.state.location.pathname).toBe('/diary'));
    expect(await screen.findByText(DIARY)).toBeInTheDocument();
    /* The guarantee for everyone upgrading into this build already signed in: the redirect sits
       above the gate, so `onboardingSeen` being false never reaches it. */
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows neither while the session is still being checked', () => {
    session.value = { data: null, isPending: true };
    setup();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue with Google/i })).not.toBeInTheDocument();
  });
});
