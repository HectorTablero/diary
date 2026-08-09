import { anEntry, aPerson, aTag } from '../../web/src/test/fixtures';
import { entryRow, expect, syncMessage, test, todayKey } from '../support/app';

/* The claim that makes this app usable on a train: everything renders from IndexedDB, and the
 * server is an optimisation.
 *
 * "Renders from IndexedDB" is only meaningful against a real one. In jsdom a module that still
 * holds its data in memory passes every test a reload would fail, because there is no reload — so
 * this is the check that the diary survives the JavaScript heap being thrown away, with nothing
 * answering on the network to fill it back in.
 *
 * The reconnect probe is the other half. The browser never thinks it is offline here — only the
 * server is gone — so `navigator.onLine` stays true and nothing in the platform will ever tell the
 * app the server came back. The probe polling `/api/health` is the only mechanism that can, which
 * is exactly why it exists and why it is worth a spec.
 */

const COMPOSER = 'What happened? Use @person and #tag…';

test('the whole diary comes back from local storage with the server unreachable', async ({
  app: page,
  api,
}) => {
  const today = todayKey();
  const work = aTag({ id: 'tag_work', name: 'work' });
  const ana = aPerson({ id: 'person_ana', name: 'Ana' });
  api.state.tags = [work];
  api.state.people = [ana];
  api.state.entries = [
    anEntry({
      id: 'entry_root',
      content: 'Reviewed the plan with @Ana about #work',
      dateKey: today,
      orderKey: 'a0',
      tags: [work],
      people: [{ id: ana.id, name: ana.name }],
    }),
    anEntry({
      id: 'entry_child',
      content: 'She is moving in September',
      dateKey: today,
      parentId: 'entry_root',
      orderKey: 'a0',
    }),
  ];

  await page.goto(`/diary/${today}`);
  await expect(entryRow(page, 'Reviewed the plan with @Ana about #work')).toBeVisible();

  /* The server goes, and the whole JS heap with it. Note `setUnreachable` rather than
     `context.setOffline`: taking the network down would also fail the document request to
     `vite preview`, so the page could never load and the spec would be testing nothing. */
  api.setUnreachable(true);
  await page.reload();

  // Every one of these is a *join*, resolved locally from ids: the mention, the tag and the tree
  // nesting all come out of repo.ts's lookup maps rather than off the wire.
  await expect(entryRow(page, 'Reviewed the plan with @Ana about #work')).toBeVisible();
  /* The child is addressed by id rather than through `entryRow`. That helper filters rows by their
     text, and a parent row *contains* its children — so a nested entry matches two rows and trips
     Playwright's strict mode. Which is itself the evidence the tree was rebuilt locally. */
  await expect(page.locator('[data-tree-row-id="entry_child"]')).toContainText(
    'She is moving in September',
  );
  await expect(page.getByRole('link', { name: '@Ana' })).toHaveAttribute(
    'href',
    '/people/person_ana',
  );
  await expect(page.getByRole('link', { name: '#work' })).toHaveAttribute(
    'href',
    '/search?tags=tag_work',
  );

  // And it is still writable — the queue is what absorbs a missing server, not a read-only mode.
  await page.getByPlaceholder(COMPOSER).fill('Written with no server');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(entryRow(page, 'Written with no server')).toBeVisible();
});

test('the probe notices the server coming back, which nothing else would', async ({
  app: page,
  api,
}) => {
  /* Required, and silently fatal if forgotten: `quietNotifications` defaults to **true** and
     lib/notify.ts drops any success toast that is neither `important` nor carrying an action. The
     reconnect toast is neither, so with the default this waits for something deliberately never
     rendered. Settings arrive through the sync pull, hence before the first navigation. */
  api.state.settings.quietNotifications = false;

  const today = todayKey();
  await page.goto(`/diary/${today}`);
  await expect(page.getByPlaceholder(COMPOSER)).toBeVisible();

  api.setUnreachable(true);
  await page.getByPlaceholder(COMPOSER).fill('Waiting for a server');
  await page.getByRole('button', { name: 'Save' }).click();

  // The app can tell "no network" from "server not answering", and says the second.
  await expect(syncMessage(page, /Can't reach the server/)).toBeVisible({ timeout: 20_000 });

  /* The probe only starts once a pass has failed on network grounds — polling /api/health every
     ten seconds — so the call below is evidence the failure was classified correctly, not merely
     that something was retried. */
  await api.waitForCall('GET', /^\/api\/health$/, 30_000);

  api.setUnreachable(false);

  await expect(page.getByText('Connection restored — syncing…')).toBeVisible({ timeout: 30_000 });
  const post = await api.waitForCall('POST', /^\/api\/entries$/, 20_000);
  expect((post.body as { content: string }).content).toBe('Waiting for a server');
  await expect(syncMessage(page, /change to sync/)).toBeHidden();
});
