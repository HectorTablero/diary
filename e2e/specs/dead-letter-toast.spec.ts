import { entryRow, expect, test, todayKey } from '../support/app';

/* What happens to a write the server refuses outright.
 *
 * This is the most serious thing the app does that isn't a crash: the user was told their entry was
 * saved — it is on screen, it is in IndexedDB — and the server threw it away. The queue cannot
 * simply retry it, because a 400 will be a 400 forever and the op would jam every write behind it
 * for good. So it leaves the queue, and the *only* moment anybody is ever told is the toast this
 * spec asserts on.
 *
 * The local copy is deliberately not rolled back. That looks like the wrong call and isn't: the
 * writing is the user's, the rejection is the server's opinion of a payload, and quietly deleting
 * someone's diary entry because an API validation changed is a far worse failure than an entry that
 * exists locally and nowhere else. The dead-letter row keeps the receipt.
 */

const COMPOSER = 'What happened? Use @person and #tag…';

test('a rejected write is reported once, kept locally, and never retried', async ({
  app: page,
  api,
}) => {
  const today = todayKey();
  await page.goto(`/diary/${today}`);
  await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();

  /* A 400 with the server's own error-key body, which is the contract the whole path depends on:
     apiClient parses `{ error }` into `ApiError.code`, sync.ts stores that on the dead-letter row,
     and the toast renders it. Any other body shape would make this path untestable while still
     looking like a failure. */
  api.rejectOnce({
    method: 'POST',
    path: /^\/api\/entries$/,
    status: 400,
    code: 'errors.validation',
  });

  await page.getByPlaceholder(COMPOSER).fill('Rejected by the server');
  await page.getByRole('button', { name: 'Save' }).click();

  // Told, in an error toast — never suppressed by the quiet-notifications preference, unlike the
  // routine success toasts, and the only notice this will ever get.
  await expect(page.getByText(/couldn't be saved/i)).toBeVisible({ timeout: 20_000 });

  // Still on screen. The user's writing is not the server's to discard.
  await expect(entryRow(page, 'Rejected by the server')).toBeVisible();

  /* Exactly one attempt. The op has left the outbox for the dead-letter table, so nothing should
     be sending it again — and a queue that kept retrying a permanent 400 would be a request loop
     for as long as the app is open. The wait is deliberately generous: a second attempt would come
     from the sixty-second poll or from any later kick, and a short check would miss it. */
  const attempts = () =>
    api.calls.filter((c) => c.method === 'POST' && c.path === '/api/entries').length;
  expect(attempts()).toBe(1);

  await page.getByPlaceholder(COMPOSER).fill('A second entry, which is fine');
  await page.getByRole('button', { name: 'Save' }).click();

  /* The queue is not jammed either — which is the other half of moving the op out. The second
     write goes through, and the rejected one is still not retried alongside it. */
  await expect.poll(attempts, { timeout: 20_000 }).toBe(2);
  const bodies = api.calls
    .filter((c) => c.method === 'POST' && c.path === '/api/entries')
    .map((c) => (c.body as { content: string }).content);
  expect(bodies).toEqual(['Rejected by the server', 'A second entry, which is fine']);
});

test('a rejection survives a reload without becoming a retry', async ({ app: page, api }) => {
  const today = todayKey();
  await page.goto(`/diary/${today}`);
  await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();

  api.rejectOnce({
    method: 'POST',
    path: /^\/api\/entries$/,
    status: 400,
    code: 'errors.validation',
  });
  await page.getByPlaceholder(COMPOSER).fill('Rejected by the server');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/couldn't be saved/i)).toBeVisible({ timeout: 20_000 });

  await page.reload();

  /* The entry is still local — the failure cost the user nothing but a note that never syncs — and
     the outbox came back empty, so a restart doesn't quietly resurrect the op. That distinction
     matters: an op left in the outbox would look identical until the next launch. */
  await expect(entryRow(page, 'Rejected by the server')).toBeVisible();
  const before = api.calls.filter((c) => c.method === 'POST' && c.path === '/api/entries').length;
  await expect(page.getByText(/change to sync/)).toBeHidden();
  expect(api.calls.filter((c) => c.method === 'POST' && c.path === '/api/entries')).toHaveLength(
    before,
  );
});
