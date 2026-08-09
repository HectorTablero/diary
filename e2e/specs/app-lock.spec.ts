import { anEntry } from '../../web/src/test/fixtures';
import { expect, test, todayKey } from '../support/app';

/* The passcode, set the way a person sets it and then survived a restart.
 *
 * Deliberately not seeded as a pre-baked `appLock` blob. Doing that would mean this spec computing
 * a PBKDF2 hash of its own — a second implementation of the exact thing under test, which would
 * agree with the app right up until one of them changed. Driving the settings UI means the hash is
 * produced by the app, stored by the app, and verified by the app, and the test only ever asserts
 * on what a user can see.
 *
 * The other assertion here cannot be made anywhere but in a real browser: that while locked, no
 * diary content is *anywhere in the document*. `LockScreen` replaces the router rather than
 * covering it, so there is no route mounted behind it — nothing querying, nothing painted under a
 * translucent panel, and on Android nothing for the recents thumbnail to capture. A jsdom test
 * could assert the lock screen renders; only this can assert what is not underneath it.
 */

const PASSCODE = '4821';
const SECRET = 'The private thing I wrote';

/**
 * Turn the lock on through Settings → Security, exactly as a person would.
 *
 * Assumes the app is already open somewhere and *navigates by clicking*. That is not stylistic: the
 * lock's initial state is read at module load, so after a passcode exists every `page.goto` is a
 * restart that locks the app again. Clicking keeps the session alive, which is what lets a spec set
 * a passcode and then choose which screen is sitting behind the lock when it restarts.
 */
async function setPasscodeThroughSettings(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.getByRole('switch', { name: 'Require a passcode' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New passcode').fill(PASSCODE);
  await dialog.getByLabel('Confirm passcode').fill(PASSCODE);
  await dialog.getByRole('button', { name: 'Save' }).click();

  // `important: true`, so this one survives the quiet-notifications default.
  await expect(page.getByText('Passcode saved')).toBeVisible({ timeout: 20_000 });
}

test('the passcode survives a restart and hides everything until it is given', async ({
  app: page,
  api,
}) => {
  const today = todayKey();
  api.state.entries = [
    anEntry({ id: 'entry_secret', content: SECRET, dateKey: today, orderKey: 'a0' }),
  ];

  // Pull it down first, so there is genuinely something in the local database to hide.
  await page.goto(`/diary/${today}`);
  await expect(page.getByText(SECRET)).toBeVisible();

  await setPasscodeThroughSettings(page);

  /* Back to the diary by clicking, so the route sitting behind the lock is the one with something
     to hide. Locking on the settings screen would make the "no diary content anywhere" assertion
     below pass for the wrong reason — there would have been none there to begin with. */
  await page.getByRole('link', { name: 'Entries' }).first().click();
  await expect(page.getByText(SECRET)).toBeVisible();

  /* The restart. The lock's initial state is read synchronously at module load, so a cold start is
     already locked before anything renders — no frame of the diary escapes on the way. */
  await page.reload();

  await expect(page.getByText('Diary is locked')).toBeVisible();

  /* Not "the entry isn't visible" — *nothing* in the document mentions it. `toBeVisible` would
     pass just as happily for a diary rendered underneath an opaque overlay, which is exactly the
     design this is here to rule out. */
  await expect(page.locator('body')).not.toContainText(SECRET);
  await expect(page.getByPlaceholder('What happened? Use @person and #tag…')).toHaveCount(0);
  // The navigation is gone with it: there is no route mounted to navigate within.
  await expect(page.getByRole('link', { name: 'Calendar' })).toHaveCount(0);

  await page.getByLabel('Passcode').fill('0000');
  await page.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.getByRole('alert')).toHaveText('That passcode is not right.');
  await expect(page.getByText('Diary is locked')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(SECRET);
  // Cleared, so the next attempt starts from nothing rather than from a wrong guess.
  await expect(page.getByLabel('Passcode')).toHaveValue('');

  await page.getByLabel('Passcode').fill(PASSCODE);
  await page.getByRole('button', { name: 'Unlock' }).click();

  // Straight back to the diary that was behind it, intact — the lock hides, it never deletes.
  await expect(page.getByText(SECRET)).toBeVisible({ timeout: 20_000 });
});

test('the stored record is a salted hash and never the passcode', async ({ app: page }) => {
  await page.goto(`/diary/${todayKey()}`);
  await expect(page.getByPlaceholder('What happened? Use @person and #tag…')).toBeVisible();
  await setPasscodeThroughSettings(page);

  const stored = await page.evaluate(() => localStorage.getItem('appLock'));

  /* localStorage is trivially readable by precisely the person this lock defends against — someone
     holding the unlocked device. Asserted here as well as in the unit tests because this is the
     shipped bundle writing it, not the module under a test harness. */
  expect(stored).not.toBeNull();
  expect(stored).not.toContain(PASSCODE);

  const config = JSON.parse(stored!) as { hash: string; salt: string; iterations: number };
  expect(config.hash).toBeTruthy();
  expect(config.salt).toBeTruthy();
  expect(config.iterations).toBeGreaterThanOrEqual(100_000);
});

test('the lock is device-local, so it is not something the server can hand over', async ({
  app: page,
  api,
}) => {
  await page.goto(`/diary/${todayKey()}`);
  await expect(page.getByPlaceholder('What happened? Use @person and #tag…')).toBeVisible();
  await setPasscodeThroughSettings(page);

  /* Nothing about the lock is queued for the server, by design: it describes *this device*, it has
     to survive a sign-out (which wipes IndexedDB), and it has to work with no account at all. A
     synced passcode would fail all three. */
  const lockCalls = api.calls.filter(
    (call) => JSON.stringify(call.body ?? '').includes(PASSCODE) || /lock/i.test(call.path),
  );
  expect(lockCalls).toEqual([]);
});
