import type { Locator, Page } from '@playwright/test';
import { aPerson } from '../../web/src/test/fixtures';
import { expect, test, todayKey } from '../support/app';

/* Every route, actually resolved.
 *
 * This is the only check in the repo that can catch a broken chunk split. Each page is a lazy
 * `import()` behind a Suspense boundary, and the build assigns them to chunks via `manualChunks` /
 * `chunkFileNames` — so a route can be perfectly correct in source and still fail to load in the
 * artefact that ships, because its chunk was renamed, emptied, or made to depend on something that
 * is not there yet. The dev server never reproduces that: it serves modules on demand and there are
 * no chunks at all. Hence `vite preview` over a real build (see playwright.config.ts).
 *
 * The failure it prevents is total — a blank page on that route for everyone — and nothing else in
 * the suite would notice, because every other spec lives on the diary page.
 */

/**
 * Each route, with something on the far side of its Suspense boundary that only that page renders.
 *
 * Chosen to be a *control* of the page rather than its heading wherever possible: the three
 * Explore screens hide their own titles under the bottom tab bar (the segmented switcher names
 * them there instead), so a title-based check would be asserting a viewport as much as a route.
 */
const ROUTES: { path: string; proof: (page: Page) => Locator }[] = [
  { path: '/calendar', proof: (page) => page.getByRole('button', { name: 'Previous month' }) },
  /* `.first()` because an empty people list offers "Add person" twice — in the header and again in
     the empty state. Both are the page having rendered, which is all this route check asks. */
  { path: '/people', proof: (page) => page.getByRole('button', { name: 'Add person' }).first() },
  { path: '/search', proof: (page) => page.getByPlaceholder('Search your entries…') },
  { path: '/tags', proof: (page) => page.getByRole('button', { name: 'Add tag' }) },
  { path: '/threads', proof: (page) => page.getByRole('button', { name: 'New thread' }) },
  { path: '/settings', proof: (page) => page.getByRole('switch', { name: 'Require a passcode' }) },
];

test('every lazy route resolves in the built bundle', async ({ app: page }) => {
  /* A single test walking the routes rather than one per route: the point is the chunk graph, and
     a fresh browser per route would pay the whole boot six times to learn the same thing. */
  await page.goto(`/diary/${todayKey()}`);
  await expect(page.getByPlaceholder('What happened? Use @person and #tag…')).toBeVisible();

  for (const { path, proof } of ROUTES) {
    await page.goto(path);
    /* Waiting on the page's *own* content, not on the URL. A chunk that fails to load leaves the
       Suspense fallback — a spinner — on screen indefinitely, and the URL is already correct by
       then, so a router-state assertion would pass on exactly the failure this exists to catch. */
    await expect(proof(page)).toBeVisible({ timeout: 20_000 });
  }
});

test('the parameterised routes resolve too, including the one with a literal sibling', async ({
  app: page,
  api,
}) => {
  api.state.people = [aPerson({ id: 'person_ana', name: 'Ana' })];

  await page.goto(`/diary/${todayKey()}`);
  await expect(page.getByPlaceholder('What happened? Use @person and #tag…')).toBeVisible();

  await page.goto('/people/person_ana');
  await expect(page.getByRole('heading', { name: 'Ana' })).toBeVisible({ timeout: 20_000 });

  /* `/people/import` is declared ahead of `/people/:id` so the literal segment always wins the
     match. Get that order wrong and this URL renders a profile page for a person called "import",
     which fails as a confusing empty screen rather than as a routing error. */
  await page.goto('/people/import');
  await expect(page.getByRole('heading', { name: 'Import from contacts' })).toBeVisible({
    timeout: 20_000,
  });
});

test('an unknown path lands on today rather than nowhere', async ({ app: page }) => {
  await page.goto('/no-such-page');

  // The catch-all inside the layout, so a mistyped or stale URL opens the app instead of a blank.
  await expect(page).toHaveURL(new RegExp(`/diary/${todayKey()}$`));
  await expect(page.getByPlaceholder('What happened? Use @person and #tag…')).toBeVisible();
});
