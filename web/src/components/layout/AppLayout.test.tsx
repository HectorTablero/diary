import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteObject } from 'react-router';
import { aPerson } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { seed } from '@/test/seed';

/* The gate in front of everything: whether the app opens at all.
 *
 * It has four answers and three of them look the same on screen, which is exactly why it is worth
 * a test. "Still checking", "signed out", "signed in once and currently offline" and "never had an
 * account" are four different states of the same two variables, and getting the third one wrong
 * means a diary that shows a login page on a train — with all of its data sitting in IndexedDB two
 * inches away. That bug is invisible to anyone testing on a desk.
 */

/* better-auth's `useSession` is a live subscription to a network call, so it is the one thing here
   that has to be replaced. A mutable hoisted object rather than a fixed return value: the three
   fields vary independently and this file's whole point is the combinations between them. */
interface SessionResult {
  data: { user: { name: string; email: string; image: string | null } } | null;
  isPending: boolean;
  error: Error | null;
}
const session = vi.hoisted(() => ({
  value: { data: null, isPending: false, error: null } as SessionResult,
}));
vi.mock('@/lib/authClient', () => ({ useSession: () => session.value }));

/* The idle *scheduler*, not the preloaders it schedules. AppLayout warms every route chunk once
   the shell is up, which under jsdom means dynamically importing the entire app into this one
   file's module graph — minutes of transform for something no assertion here looks at. Stubbing
   `onIdle` leaves the effect's own logic (the Save-Data check, the session guard) real and simply
   never fires the callback. */
vi.mock('@/lib/idle', () => ({ onIdle: () => 0, cancelIdle: () => {} }));

/* `kick` is recorded rather than run. Left real it would reach `syncNow`, which in a signed-in
   test means an actual fetch out of jsdom — and the fact worth asserting is that the sign-in
   *triggered* a drain, not what the network said about it. */
const kicks = vi.hoisted(() => ({ triggers: [] as string[] }));
vi.mock('@/db/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/sync')>()),
  kick: (trigger: string) => kicks.triggers.push(trigger),
}));

const AppLayout = (await import('./AppLayout')).default;

const CONTENT = 'The diary itself';

/** The real shape from App.tsx: a layout route with children, plus the page it redirects to. */
const routes: RouteObject[] = [
  { path: '/', element: <AppLayout />, children: [{ index: true, element: <p>{CONTENT}</p> }] },
  { path: '/login', element: <p>Sign in page</p> },
];

const renderApp = () => renderWithProviders(null, { routes });

const SIGNED_IN: SessionResult = {
  data: { user: { name: 'Ana', email: 'ana@example.com', image: null } },
  isPending: false,
  error: null,
};

beforeEach(async () => {
  localStorage.clear();
  session.value = { data: null, isPending: false, error: null };
  kicks.triggers = [];
  await seed({});
});

describe('AppLayout · the auth gate', () => {
  it('waits rather than guessing while the session check is in flight', () => {
    session.value = { data: null, isPending: true, error: null };

    renderApp();

    /* The spinner, by the thing it says rather than by its class — FullScreenSpinner exists to be
       a *live region* with text in it, not a spinning icon, and asserting on the icon would pass
       just as well if the announcement were dropped. */
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(CONTENT)).not.toBeInTheDocument();
  });

  it('sends a definitively signed-out visitor to the login page', async () => {
    // No data, not pending, no error: the server answered, and the answer was "nobody".
    const { router } = renderApp();

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(screen.queryByText(CONTENT)).not.toBeInTheDocument();
  });

  /* The two cases that make this local-first rather than merely offline-tolerant. A cached user is
     the app's memory of having been signed in here before; while the session check is unresolved —
     because it is slow, or because it failed outright — that memory is better evidence than the
     absence of an answer. The data is already on the device. */
  it('opens for a cached user while the session check is still pending', async () => {
    localStorage.setItem('diary.user', JSON.stringify({ name: 'Ana', email: 'ana@example.com' }));
    session.value = { data: null, isPending: true, error: null };

    renderApp();

    expect(await screen.findByText(CONTENT)).toBeInTheDocument();
    expect(screen.queryByText('Sign in page')).not.toBeInTheDocument();
  });

  it('opens for a cached user when the session check fails outright', async () => {
    localStorage.setItem('diary.user', JSON.stringify({ name: 'Ana', email: 'ana@example.com' }));
    session.value = { data: null, isPending: false, error: new Error('Failed to fetch') };

    renderApp();

    expect(await screen.findByText(CONTENT)).toBeInTheDocument();
  });

  /* Deliberately a separate concept from the cached user (see lib/localOnly.ts): this device never
     had an account at all, so there is no session to be pending about and no redirect to make. */
  it('opens with no session at all in local-only mode', async () => {
    localStorage.setItem('diary.localOnly', '1');

    renderApp();

    expect(await screen.findByText(CONTENT)).toBeInTheDocument();
  });

  it('caches the user, ends local-only mode and drains the queue when a session arrives', async () => {
    // Everything queued while local-only is still in the outbox — signing in is the moment it can
    // finally go somewhere, which is why this is an ordinary sync trigger and not a special case.
    localStorage.setItem('diary.localOnly', '1');
    session.value = SIGNED_IN;

    renderApp();

    await waitFor(() => expect(kicks.triggers).toContain('signin'));
    expect(localStorage.getItem('diary.localOnly')).toBeNull();
    expect(JSON.parse(localStorage.getItem('diary.user')!)).toMatchObject({
      name: 'Ana',
      email: 'ana@example.com',
    });
  });

  /* StrictMode is off in the harness precisely so this can be counted (see renderWithProviders):
     under it every effect runs twice and "exactly one" becomes untestable. */
  it('drains once per sign-in, not once per render', async () => {
    session.value = SIGNED_IN;

    const { rerender } = renderApp();
    await waitFor(() => expect(kicks.triggers).toEqual(['signin']));
    rerender(<div />);

    expect(kicks.triggers).toEqual(['signin']);
  });
});

describe('AppLayout · navigation chrome', () => {
  beforeEach(() => {
    session.value = SIGNED_IN;
  });

  it('offers every screen, counting the ones behind the phone’s More menu', async () => {
    renderApp();

    await screen.findByText(CONTENT);

    /* Both navigations are in the DOM at once — which is correct, and the reason these are
       `getAllBy`: the sidebar and the tab bar are shown and hidden by CSS media queries, and jsdom
       has no layout, so it sees both. What matters is that a link exists for each destination. */
    for (const label of ['Entries', 'Calendar', 'People', 'Settings']) {
      expect(screen.getAllByRole('link', { name: label }).length).toBeGreaterThan(0);
    }
    // Search/Tags/Threads are sidebar links on the web and menu items on a phone.
    expect(screen.getByRole('link', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('badges People with the number of overdue checkups', async () => {
    /* A checkup is due once `checkupIntervalDays` have passed since `lastCheckupAt` (lib/checkup),
       so the fixture dates the last contact well outside a 7-day interval and leaves the second
       person with checkups switched off entirely — the badge must count one, not two. */
    await seed({
      people: [
        aPerson({
          id: 'p1',
          name: 'Ana',
          checkupIntervalDays: 7,
          lastCheckupAt: '2020-01-01T00:00:00.000Z',
        }),
        aPerson({ id: 'p2', name: 'Ben', checkupIntervalDays: null }),
      ],
    });

    renderApp();

    /* The count is announced through sr-only text rather than the bare numeral beside it, which is
       `aria-hidden` — a screen reader hearing "People 1" would learn nothing. Two matches, one per
       navigation, for the same jsdom-has-no-media-queries reason as above. */
    const badges = await screen.findAllByText('1 checkup pending');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('puts a skip link first, ahead of the seven sidebar stops', async () => {
    renderApp();

    await screen.findByText(CONTENT);

    /* Keyboard users pay for the sidebar on every navigation, and on the diary the composer is the
       last thing in the document. The link has to be the first focusable element for that to help,
       so its position is the assertion — not merely its existence. */
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    const focusable = screen.getAllByRole('link');
    expect(focusable[0]).toBe(skip);
  });
});
