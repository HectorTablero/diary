import { installApiMock } from '../support/api';
import { entryRow, expect, seedBrowserState, test as base, todayKey } from '../support/app';

/* Using the diary without an account, and then linking one.
 *
 * Two claims, and the first is a negative: a device that opted out of accounts must not talk to
 * `/api/sync` at all, and must not show a sync pill — there is no server relationship to be
 * "offline" from or "reconnected" to, so every one of those messages would be describing something
 * that does not exist. A negative like that is only provable against something that records every
 * request, which is what the API fixture is for.
 *
 * The second is the transition. Everything written while local-only is sitting in the outbox, and
 * signing in is the moment it can finally go somewhere — deliberately as an ordinary drain rather
 * than a special import path, so there is only one code path that has ever moved a write to the
 * server.
 */

const COMPOSER = 'What happened? Use @person and #tag…';

/* A fixture of its own rather than the shared `app` one: this spec needs the session call answered
   with "nobody", which `installApiMock`'s `signedIn` option does and the default fixture cannot. */
const test = base.extend<{ localOnly: import('@playwright/test').Page }>({
  localOnly: async ({ page, context }, use) => {
    await installApiMock(page, {}, { signedIn: false });
    await seedBrowserState(context, { localOnly: true });
    await use(page);
  },
});

test('a device without an account writes locally and never asks the server for anything', async ({
  localOnly: page,
  context,
}) => {
  const today = todayKey();
  await page.goto(`/diary/${today}`);
  await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();

  await page.getByPlaceholder(COMPOSER).fill('Written without an account');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(entryRow(page, 'Written without an account')).toBeVisible();

  /* No pill, in either direction. Going offline flips `SyncStatus.blocker` regardless of whether
     an account exists — initSync's window listeners are unconditional — so the overlay needs its
     own local-only check, and this is the assertion that would catch that check being lost. */
  await expect(page.getByText(/change to sync/)).toBeHidden();
  await context.setOffline(true);
  await context.setOffline(false);
  await expect(page.getByText(/Offline|Can't reach the server/)).toBeHidden();

  // And it survives a restart, because local-first without an account is still local-first.
  await page.reload();
  await expect(entryRow(page, 'Written without an account')).toBeVisible();
});

test('everything written offline-of-account drains the moment one appears', async ({
  page,
  context,
}) => {
  const today = todayKey();

  /* Starts signed out and local-only, then the *same* mock starts answering with a session — which
     is what a sign-in looks like from the client's side of the wire. Installed by hand rather than
     through a fixture because the answer has to change mid-test. */
  let signedIn = false;
  const api = await installApiMock(page, {}, { signedIn: false });
  await page.route('**/api/auth/**', async (route) => {
    if (!route.request().url().includes('get-session')) return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        signedIn
          ? {
              session: { id: 's', userId: 'u', token: 't', expiresAt: '2099-01-01T00:00:00.000Z' },
              user: { id: 'u', name: 'E2E User', email: 'e2e@example.com', emailVerified: true },
            }
          : null,
      ),
    });
  });
  await seedBrowserState(context, { localOnly: true });

  await page.goto(`/diary/${today}`);
  await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();

  await page.getByPlaceholder(COMPOSER).fill('Queued before signing in');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(entryRow(page, 'Queued before signing in')).toBeVisible();
  expect(api.calls.filter((c) => c.path === '/api/sync')).toHaveLength(0);

  // The sign-in. A reload is the cheapest way to make the app ask again; what matters is that the
  // answer is now a real session, not how the question was provoked.
  signedIn = true;
  await page.reload();

  /* The outbox drains as an ordinary reconnect-and-sync — AppLayout's session effect ends
     local-only mode and kicks the queue, which is the same call an `online` event makes. */
  const post = await api.waitForCall('POST', /^\/api\/entries$/, 30_000);
  expect((post.body as { content: string }).content).toBe('Queued before signing in');
  await expect(page.getByText(/change to sync/)).toBeHidden();
});
