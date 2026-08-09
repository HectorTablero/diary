import { anEntry } from '../../web/src/test/fixtures';
import { entryRow, expect, test, todayKey } from '../support/app';

/* The one branch in the whole sync engine that deletes local documents nobody asked it to delete.
 *
 * A normal pull is a delta: it names what changed, and anything it doesn't mention is simply
 * unchanged. A `reset: true` pull is the opposite — it carries the *whole* collection, and the ids
 * it omits are the deletions, because a reset has no tombstones left to send. That inversion is
 * what makes it dangerous: apply "unmentioned means deleted" to a delta by mistake and the first
 * quiet minute wipes the entire diary.
 *
 * Which is exactly why it needs an end-to-end test rather than a unit one. The unit tests can prove
 * the reconcile function deletes the right rows; only this can prove that what comes back out of a
 * real IndexedDB after a real reload agrees with it — that the prune was committed rather than only
 * applied to the copy in memory.
 */

const COMPOSER = 'What happened? Use @person and #tag…';

/** Cheapest deterministic way to provoke a sync pass — initSync's `online` listener kicks one
    immediately, where the automatic triggers are a sixty-second timer and a session effect. */
const provokeSync = async (context: { setOffline: (offline: boolean) => Promise<void> }) => {
  await context.setOffline(true);
  await context.setOffline(false);
};

test('a reset pull removes a local doc the server no longer has, permanently', async ({
  app: page,
  context,
  api,
}) => {
  const today = todayKey();
  /* Seeded on the *server*, not in the browser: the point is that these arrived through a pull, so
     the reset that follows is the same machinery undoing its own work.

     Built with the component suite's own fixture builder, which is why that file exists — the
     same DTOs feed both suites, so a field that changes shape breaks both rather than silently
     diverging one from the other. `orderKey` is spelled out here because `seed()` (which fills it
     in for the component tests) has no part in this path. */
  api.state.entries = [
    anEntry({ id: 'entry_kept', content: 'Still on the server', dateKey: today, orderKey: 'a0' }),
    anEntry({
      id: 'entry_removed',
      content: 'Deleted on another device',
      dateKey: today,
      orderKey: 'a1',
    }),
  ];

  await page.goto(`/diary/${today}`);
  await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();
  await expect(entryRow(page, 'Still on the server')).toBeVisible();
  await expect(entryRow(page, 'Deleted on another device')).toBeVisible();

  /* The other device's deletion, as the server would present it after a tombstone sweep: the doc
     is gone from the collection and there is no tombstone naming it. A delta pull could not
     express this at all, which is the entire reason `reset` exists. */
  api.state.entries = api.state.entries.filter((entry) => entry.id !== 'entry_removed');
  api.nextPullIsReset();

  await provokeSync(context);

  await expect(entryRow(page, 'Deleted on another device')).toBeHidden({ timeout: 20_000 });
  // The other one is untouched. A prune that took the whole table would also pass a check that
  // only looked for the absence of the deleted row.
  await expect(entryRow(page, 'Still on the server')).toBeVisible();

  /* And it was committed, not merely applied to the copy in memory. A reload rebuilds every screen
     from IndexedDB, so a prune that never reached disk reappears here — which is the failure this
     spec exists for and the one no unit test can see. */
  await page.reload();

  await expect(entryRow(page, 'Still on the server')).toBeVisible();
  await expect(entryRow(page, 'Deleted on another device')).toBeHidden();
});

test('a queued write is pushed before the reset decides what to prune', async ({
  app: page,
  context,
  api,
}) => {
  const today = todayKey();
  await page.goto(`/diary/${today}`);
  await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();

  /* Written while the server is unreachable, so it is still in the outbox and the server has never
     heard of it. Under "unmentioned means deleted" that is indistinguishable from a doc deleted on
     another device — and if a reset pull ever ran while this was queued, the sync meant to protect
     the diary would eat the note that was just written. */
  api.setUnreachable(true);
  await page.getByPlaceholder(COMPOSER).fill('Written while disconnected');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(entryRow(page, 'Written while disconnected')).toBeVisible();

  api.setUnreachable(false);
  api.nextPullIsReset();
  await provokeSync(context);

  /* What actually protects it is the ordering: a pass pushes the whole outbox first and only pulls
     once it has fully drained, so by the time the reset response is reconciled the server already
     has this entry and its id is in `alive`. That is why the assertion below is on the POST — the
     push having happened *first* is the guarantee, not a lucky outcome of it.

     (The reconcile also skips ids with unpushed ops, read inside the same transaction. That is
     defence in depth for a write enqueued mid-pull, and by construction cannot be provoked from
     the outside — which is exactly why this spec pins the ordering rather than pretending to
     exercise the guard.) */
  await api.waitForCall('POST', /^\/api\/entries$/, 30_000);
  await expect(entryRow(page, 'Written while disconnected')).toBeVisible();

  await page.reload();
  await expect(entryRow(page, 'Written while disconnected')).toBeVisible();
});
