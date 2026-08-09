import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteObject } from 'react-router';
import type { SyncStatus } from '@/db/sync';
import { renderWithProviders } from '@/test/renderWithProviders';
import { seed } from '@/test/seed';
import { resetPreferences, setPreference } from '@/lib/preferences';

/* The pill in the corner, which is the only thing that ever says a write has not left the device.
 *
 * Split from AppLayout.test.tsx rather than added to it because the two need opposite setups: that
 * file varies the session and lets sync alone, this one pins a session and varies sync. Between
 * them they cover the same component from its two independent axes without either file having to
 * hold both mocks straight.
 *
 * The reason this is worth pinning at all: every failure mode here is a *silence*. A pill that
 * never appears looks exactly like a diary that is syncing fine, and the whole promise of the app
 * is that you can trust it to have kept your writing.
 */

/* Signed in for every test but one. The exception has to be a real signed-out session rather than
   only a `diary.localOnly` flag: AppLayout's session effect calls `setLocalOnly(false)` the moment
   a user arrives, so a signed-in local-only device is a state that cannot exist for longer than an
   effect — which is the point of the flag, and worth knowing before trying to set up around it. */
const signedIn = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/authClient', () => ({
  useSession: () => ({
    data: signedIn.value ? { user: { name: 'Ana', email: 'ana@example.com', image: null } } : null,
    isPending: false,
    error: null,
  }),
}));
vi.mock('@/lib/idle', () => ({ onIdle: () => 0, cancelIdle: () => {} }));

/* The status store is a module-level `let` with no exported setter — deliberately, since only the
   engine may move it — so the seam is the hook that reads it. Everything downstream stays real:
   `shouldShowBlocker` decides, the preference store decides with it, and the wording comes out of
   the locale bundle. A test that mocked `shouldShowBlocker` too would assert nothing but its own
   arrangement. */
const status = vi.hoisted(() => ({
  value: {
    pending: 0,
    syncing: false,
    blocker: null,
    needsAuth: false,
    lastSyncAt: null,
  } as SyncStatus,
}));
vi.mock('@/db/useSyncStatus', () => ({ useSyncStatus: () => status.value }));

const forced = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/db/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/sync')>()),
  kick: () => {},
  forceSyncNow: () => {
    forced.count += 1;
    return Promise.resolve();
  },
}));

const AppLayout = (await import('./AppLayout')).default;

/* Not "Diary" — that is `app.name`, which the sidebar already renders, and a duplicate would make
   every `findByText` in this file ambiguous rather than merely wrong. */
const CONTENT = 'The diary itself';

const routes: RouteObject[] = [
  { path: '/', element: <AppLayout />, children: [{ index: true, element: <p>{CONTENT}</p> }] },
  { path: '/login', element: <p>Sign in page</p> },
];

const renderWith = (patch: Partial<SyncStatus>) => {
  status.value = { ...status.value, ...patch };
  return { user: userEvent.setup(), ...renderWithProviders(null, { routes }) };
};

beforeEach(async () => {
  localStorage.clear();
  resetPreferences();
  signedIn.value = true;
  forced.count = 0;
  status.value = { pending: 0, syncing: false, blocker: null, needsAuth: false, lastSyncAt: null };
  await seed({});
});

afterEach(() => resetPreferences());

describe('the sync pill', () => {
  it('says nothing while sync is working', async () => {
    renderWith({});

    await screen.findByText(CONTENT);
    /* The live region itself is still mounted and still empty — that is the design. Going offline
       has to be a *text change inside an existing region* rather than a region appearing, because
       only the first is announced reliably by screen readers. */
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('counts the writes waiting behind a lost network', async () => {
    renderWith({ blocker: 'offline', pending: 2 });

    // The real plural from the real bundle: `offlinePending_other`. A copy change that emptied the
    // pill would fail here rather than pass quietly.
    expect(await screen.findByText('Offline — 2 changes to sync')).toBeInTheDocument();
  });

  it('still announces being offline with nothing queued', async () => {
    renderWith({ blocker: 'offline', pending: 0 });

    /* Worth saying even with an empty outbox: it is also the reason nothing is *arriving* from the
       other device. `paused` is the only blocker that goes quiet at zero. */
    expect(await screen.findByText('Offline')).toBeInTheDocument();
  });

  it('distinguishes a server that is down from a device with no network', async () => {
    renderWith({ blocker: 'unreachable', pending: 1 });

    /* Two different situations that `navigator.onLine` cannot tell apart, and which need different
       things from the user — wait, versus check whether you are behind a captive portal. */
    expect(
      await screen.findByText("Can't reach the server — 1 change to sync"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
  });

  it('offers a way out of the Wi-Fi-only hold, because it is the one blocker with one', async () => {
    const { user } = renderWith({ blocker: 'paused', pending: 1 });

    expect(await screen.findByText('Waiting for Wi-Fi · 1 change')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sync now' }));

    // Spends one sync's worth of cellular data on purpose; the preference itself is untouched.
    expect(forced.count).toBe(1);
  });

  it('keeps the button off while a forced sync is already running', async () => {
    renderWith({ blocker: 'paused', pending: 1, syncing: true });

    expect(await screen.findByRole('button', { name: 'Sync now' })).toBeDisabled();
  });

  /* The two ways `paused` disappears, which are the whole reason `shouldShowBlocker` exists as a
     function rather than a boolean. Neither can silence the other two blockers. */
  it('stays quiet about a Wi-Fi-only hold that is holding nothing back', async () => {
    renderWith({ blocker: 'paused', pending: 0 });

    await screen.findByText(CONTENT);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('respects someone who has asked not to be reminded of their own setting', async () => {
    setPreference('hidePausedSyncStatus', true);

    renderWith({ blocker: 'paused', pending: 3 });

    await screen.findByText(CONTENT);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('cannot be silenced about a failure, whatever that preference says', async () => {
    setPreference('hidePausedSyncStatus', true);

    renderWith({ blocker: 'offline', pending: 3 });

    /* The preference is about a setting doing its job. Being offline is not, and staying quiet
       about it is precisely how a diary stops backing itself up without anyone noticing. */
    expect(await screen.findByText('Offline — 3 changes to sync')).toBeInTheDocument();
  });

  it('says nothing at all on a device that was never linked to an account', async () => {
    // Both halves are required, and only together: no session at all, plus the explicit opt-in.
    signedIn.value = false;
    localStorage.setItem('diary.localOnly', '1');

    renderWith({ blocker: 'offline', pending: 2 });

    /* There is no server relationship to be offline *from*. initSync's window listeners flip the
       blocker regardless of whether an account exists, so the overlay needs its own check rather
       than trusting the engine to stay quiet — and this is what would catch that check being lost. */
    await screen.findByText(CONTENT);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
  });
});

describe('the expired-session banner', () => {
  it('interrupts, because writes have quietly stopped reaching the server', async () => {
    renderWith({ needsAuth: true, pending: 4 });

    /* role="alert", not "status", and that distinction is the assertion. Every other state here is
       a polite update the user can read when they get to it; this one means the diary has silently
       become local-only and will stay that way until someone signs in again. */
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Your session has expired.');
    expect(within(banner).getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('replaces the pill rather than stacking with it', async () => {
    renderWith({ needsAuth: true, blocker: 'offline', pending: 4 });

    await screen.findByRole('alert');
    // Two live regions saying overlapping things is worse than one saying the more serious of them.
    await waitFor(() => expect(screen.queryByText(/change[s]? to sync/)).not.toBeInTheDocument());
  });
});
