import { entryRow, expect, syncMessage, test, todayKey } from '../support/app';

/* The claim the whole app is built around: writing works with no network, survives the tab being
 * closed, and reaches the server by itself once there is one.
 *
 * Every step here is something jsdom cannot do. Going offline is a browser state, not a flag;
 * "survives a reload" means a real IndexedDB rather than a module that happens to still be in
 * memory; and "the POST actually arrived" is only meaningful against something that saw the
 * request. Unit tests cover each half — sync.test.ts drives the engine, EntryComposer.test.tsx
 * checks what gets queued — and neither can join them up.
 */

const COMPOSER = 'What happened? Use @person and #tag…';

test('an entry written offline survives a reload and reaches the server on reconnect', async ({
  app: page,
  context,
  api,
}) => {
  await page.goto(`/diary/${todayKey()}`);
  await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();

  await context.setOffline(true);

  await page.getByPlaceholder(COMPOSER).fill('Bought milk');
  await page.getByRole('button', { name: 'Save' }).click();

  // Written locally and on screen straight away — the local write does not wait for the network.
  await expect(entryRow(page, 'Bought milk')).toBeVisible();
  // And the app says so, rather than looking as though everything is fine.
  await expect(syncMessage(page, /1 change to sync/)).toBeVisible();
  expect(api.calls.filter((c) => c.method === 'POST' && c.path === '/api/entries')).toHaveLength(0);

  /* The reload that proves persistence: the whole JS heap goes, and the entry has to come back out
     of IndexedDB along with the outbox row that has still never been sent.

     The *browser* comes back online first, while the *server* stays unreachable. It has to: with
     `context.setOffline(true)` the document request to `vite preview` fails too (ERR_INTERNET_
     DISCONNECTED), and the service worker that would normally serve the shell from precache is
     deliberately blocked so route interception keeps working. Swapping one for the other keeps the
     thing under test — nothing has reached the server, and the queue must survive a restart —
     while letting the page actually load. */
  api.setUnreachable(true);
  await context.setOffline(false);
  await page.reload();

  await expect(entryRow(page, 'Bought milk')).toBeVisible();

  /* A sync pass has to be *provoked*. Nothing runs one on its own here: the pill is driven by the
     blocker, and the blocker is only set by an attempt that failed — while the automatic triggers
     are a sixty-second timer (far too slow to wait on) and a session effect that never fires,
     because the aborted `get-session` means no session ever arrives. Flipping the browser offline
     and back is the cheapest deterministic trigger: it fires initSync's `online` listener, which
     kicks a pass immediately. */
  await context.setOffline(true);
  await context.setOffline(false);

  /* Which fails, because the server is still unreachable — and the count proves the outbox row came
     back out of IndexedDB rather than having been sent before the reload.

     Asserted against what the server *holds*, not against `api.calls`. Those are two different
     questions here and only this one is the spec's: `record()` runs before the `unreachable` abort,
     so an attempt that never got past the socket is in `calls` all the same. Counting attempts
     would fail the moment the sync engine tried — which is precisely the behaviour being relied on
     three lines further down. */
  await expect(syncMessage(page, /1 change to sync/)).toBeVisible({ timeout: 20_000 });
  expect(api.state.entries).toHaveLength(0);

  api.setUnreachable(false);

  const post = await api.waitForCall('POST', /^\/api\/entries$/, 30_000);
  expect((post.body as { content: string }).content).toBe('Bought milk');
  // The message goes once the queue has drained — the user's signal that nothing is outstanding.
  await expect(syncMessage(page, /change to sync/)).toBeHidden();
});

test('the pill distinguishes an unreachable server from a device with no network', async ({
  app: page,
  api,
}) => {
  /* Required, and silently fatal if forgotten: `quietNotifications` defaults to **true**, and
     lib/notify.ts drops any success toast that is neither `important` nor carrying an action. The
     reconnect toast is neither — so with the default, the assertion below waits for something that
     was deliberately never rendered. Settings reach the client through the sync pull, so this has
     to be set before the first navigation. */
  api.state.settings.quietNotifications = false;

  await page.goto(`/diary/${todayKey()}`);
  await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();

  /* Not `context.setOffline` — the network is up and `navigator.onLine` stays true. Only the
     server is gone, which the app can distinguish and describes differently, and which
     `navigator.onLine` alone can never detect. */
  api.setUnreachable(true);
  await page.getByPlaceholder(COMPOSER).fill('Wrote something');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(syncMessage(page, /Can't reach the server/)).toBeVisible({ timeout: 20_000 });

  api.setUnreachable(false);
  /* The reconnect probe polls /api/health every ten seconds and announces itself. Nothing else
     would notice, because the browser never thought it was offline — which is the entire reason
     the probe exists. */
  await expect(page.getByText('Connection restored — syncing…')).toBeVisible({ timeout: 30_000 });
  await api.waitForCall('POST', /^\/api\/entries$/, 20_000);
});
