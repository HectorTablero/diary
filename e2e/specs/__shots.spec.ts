import { installApiMock } from '../support/api';
import { expect, seedBrowserState, test } from '../support/app';

// Temporary: screenshots for visual review. Delete after looking.
test('shots', async ({ page, context }) => {
  await installApiMock(page, {}, { signedIn: false });
  await seedBrowserState(context, { firstRun: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/login');
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });

  // Desktop: does the footer bar reach the right edge?
  await page.waitForTimeout(400);
  const gutter = await page.evaluate(() => {
    const footer = document.querySelector('[data-slot="dialog-content"] > div:last-child');
    return {
      windowWidth: window.innerWidth,
      docWidth: document.documentElement.clientWidth,
      footerRight: footer?.getBoundingClientRect().right,
      htmlFullbleed: document.documentElement.hasAttribute('data-fullbleed'),
    };
  });
  console.log('GUTTER', JSON.stringify(gutter));
  await page.screenshot({ path: 'shots/desktop-language.png' });

  await page.setViewportSize({ width: 420, height: 900 });
  for (const step of ['1-language', '2-writing', '3-importance', '4-people']) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `shots/${step}.png` });
    const next = page.getByRole('button', { name: 'Next' });
    if (await next.isVisible()) await next.click();
  }
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /1 hidden sub-entry/ }).click();
  await page.getByRole('button', { name: 'Mark as said' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/4b-expanded.png' });
});
