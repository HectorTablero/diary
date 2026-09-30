import type { Page } from '@playwright/test';
import { expect, test, todayKey } from '../support/app';
import { composer } from '../support/routes';

/* Keyboard shortcuts and the hold-to-preview hints, in a real browser.
 *
 * Here rather than in a jsdom test because the parts most likely to break are the ones jsdom fakes:
 * real key events with real modifier flags, focus sitting in the composer's textarea, CSS
 * transitions that leave a faded-out hint in the DOM, and the sidebar only existing at desktop
 * width. The rules for *when* a hold counts are unit-tested in shortcuts/holdDetector.test.ts. */

/** Well past the default half-second hold. */
const HOLD = { timeout: 3_000 };

const visibleHints = (page: Page, within: string) =>
  page.locator(`${within} [data-shortcut-hint][data-visible="true"]`);

const sidebarLink = (page: Page, name: string) =>
  page.locator('aside').getByRole('link', { name, exact: true });

async function openToday(page: Page) {
  await page.goto(`/diary/${todayKey()}`);
  await expect(composer(page)).toBeVisible();
}

test('holding Ctrl shows the importance keys on the composer, and Ctrl+2 sets one', async ({
  app: page,
}) => {
  await openToday(page);
  // Focus in the textarea is the normal case: the shortcut is for while you're writing.
  await composer(page).click();

  await page.keyboard.down('Control');
  await expect(visibleHints(page, '[data-entry-composer]')).toHaveCount(5, HOLD);
  await expect(visibleHints(page, '[data-entry-composer]').first()).toHaveText('1');

  await page.keyboard.press('2');
  await expect(page.getByRole('radio', { name: 'Significant' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // Still up after using one: the hints stay while the modifier does.
  await expect(visibleHints(page, '[data-entry-composer]')).toHaveCount(5);

  await page.keyboard.up('Control');
  await expect(visibleHints(page, '[data-entry-composer]')).toHaveCount(0);
  // And the textarea was left alone — Ctrl+2 was claimed, not typed.
  await expect(composer(page)).toHaveValue('');
});

test('holding Alt turns the sidebar icons into their keys, and Alt+2 goes there', async ({
  app: page,
}) => {
  await openToday(page);

  await page.keyboard.down('Alt');
  const calendarHint = sidebarLink(page, 'Calendar').locator('[data-shortcut-hint]');
  await expect(calendarHint).toHaveAttribute('data-visible', 'true', HOLD);
  await expect(calendarHint).toHaveText('2');
  // The importance keys belong to Ctrl, so they stay hidden under Alt.
  await expect(visibleHints(page, '[data-entry-composer]')).toHaveCount(0);

  await page.keyboard.press('2');
  await expect(page).toHaveURL(/\/calendar$/);
  await page.keyboard.up('Alt');
  await expect(visibleHints(page, 'aside')).toHaveCount(0);
});

test('a quick tap shows nothing, and a second hold works as well as the first', async ({
  app: page,
}) => {
  await openToday(page);
  const diaryHint = sidebarLink(page, 'Entries').locator('[data-shortcut-hint]');

  // A tap, released well before the hold delay.
  await page.keyboard.down('Alt');
  await page.keyboard.up('Alt');
  await expect(diaryHint).toHaveAttribute('data-visible', 'false');

  for (let hold = 0; hold < 3; hold++) {
    await page.keyboard.down('Alt');
    await expect(diaryHint).toHaveAttribute('data-visible', 'true', HOLD);
    await page.keyboard.up('Alt');
    await expect(diaryHint).toHaveAttribute('data-visible', 'false');
  }
});

test('a key shared by several places cycles through them', async ({ app: page }) => {
  await openToday(page);
  /* People moved onto Calendar's Alt+2, as if rebound in Settings. Written after boot rather than
     from an init script: the fixture's own init script also writes this key, and which of the two
     runs last is not something to depend on. The storage event is how preferences.ts hears about
     a change it didn't make, so dispatching one applies it without a reload. */
  await page.evaluate(() => {
    const value = JSON.stringify({
      onboardingSeen: true,
      shortcutOverrides: { 'nav.people': 'alt+2' },
    });
    localStorage.setItem('preferences', value);
    window.dispatchEvent(new StorageEvent('storage', { key: 'preferences', newValue: value }));
  });

  await page.keyboard.press('Alt+2');
  await expect(page).toHaveURL(/\/calendar$/);
  await page.keyboard.press('Alt+2');
  await expect(page).toHaveURL(/\/people$/);
  await page.keyboard.press('Alt+2');
  await expect(page).toHaveURL(/\/calendar$/);
});

test('a shortcut recorded in Settings replaces the default, without firing on the way', async ({
  app: page,
}) => {
  await page.goto('/settings');
  const record = page.getByRole('button', { name: 'Change the shortcut for “Go to Calendar”' });
  await record.click();
  await expect(record).toHaveText('Press keys…');

  // Alt+1 is Entries' key. Recording it must not also go there.
  await page.keyboard.press('Alt+1');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(record).toHaveText('Alt+1');
  await expect(page.getByText(/Shares its keys with Go to Entries/)).toBeVisible();

  // And the old key no longer goes to the calendar; the new one cycles with Entries.
  await page.keyboard.press('Alt+2');
  await expect(page).toHaveURL(/\/settings$/);
  await page.keyboard.press('Alt+1');
  await expect(page).toHaveURL(/\/diary/);
});
