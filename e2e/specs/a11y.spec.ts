import { anEntry, aPerson, aTag } from '../../web/src/test/fixtures';
import { asJson, report, scan, type Finding } from '../support/a11y';
import type { ApiMock } from '../support/api';
import { entryRow, expect, seedBrowserState, test, todayKey } from '../support/app';
import { composer, ROUTES } from '../support/routes';

/* Every screen, measured by axe, in both themes.
 *
 * This belongs in the Playwright suite and nowhere else. Roughly a third of what axe checks is a
 * question about pixels — contrast ratios, whether an element is actually visible, what a focus ring
 * looks like — and those rules return "incomplete" or silently pass under jsdom, which computes no
 * layout and resolves no stylesheet. Running the same library there would produce a green result
 * that means considerably less than it appears to. Here it runs against the built bundle with real
 * CSS, which is the only configuration where the answer is worth having.
 *
 * Populated with data rather than scanned empty, deliberately: an empty diary renders empty states,
 * and empty states are the one part of the app with no user content, no colour-coded chips and no
 * lists — precisely the markup least likely to have an accessibility problem. A scan of nothing
 * passes trivially.
 */

/**
 * Enough of a diary that the screens under test render their real content.
 *
 * The tag is attached to both a person and an entry on purpose. Tag chips are the only place in an
 * otherwise achromatic app where a user-chosen colour becomes a background, so they are where a
 * contrast failure would actually come from — and they render differently in the two places.
 */
function seedApi(api: ApiMock): void {
  const today = todayKey();
  const work = aTag({ id: 'tag_work', name: 'work', color: '#4ECDC4' });
  const ana = aPerson({ id: 'person_ana', name: 'Ana', tags: [work] });

  api.state.tags = [work];
  api.state.people = [ana];
  api.state.entries = [
    anEntry({
      id: 'entry_one',
      content: 'Coffee with @Ana about #work',
      dateKey: today,
      // Real keys, because an empty one makes repo.ts treat the row as legacy data to heal, which
      // writes to Dexie and enqueues a PATCH — noise this scan does not need.
      orderKey: 'a0',
      people: [{ id: ana.id, name: ana.name }],
      tags: [work],
      importance: 4,
    }),
    anEntry({
      id: 'entry_two',
      content: 'Walked home',
      dateKey: today,
      orderKey: 'a1',
      importance: 5,
    }),
  ];
}

/**
 * Walk every screen in one browser session, scanning each, and fail once with all of it.
 *
 * One test per route would be the conventional shape and is the wrong one here: it pays the whole
 * boot — bundle, IndexedDB, first sync — seven times over to learn seven independent facts, and
 * worse, it reports them one at a time, so fixing a contrast bug on `/calendar` only reveals the
 * identical one on `/tags`. Accumulating into a single report means one run tells you everything
 * that is wrong.
 */
async function scanEveryRoute(
  page: import('@playwright/test').Page,
  theme: 'light' | 'dark',
): Promise<void> {
  const findings: Finding[] = [];

  await page.goto(`/diary/${todayKey()}`);
  await expect(composer(page)).toBeVisible({ timeout: 20_000 });
  /* The composer is there before the entries are — it is not behind the Dexie query. Scanning on
     the composer alone means sometimes scanning an empty list, which is how the seeded rows'
     importance markers came and went between runs. */
  await expect(entryRow(page, 'Walked home')).toBeVisible({ timeout: 20_000 });
  findings.push(await scan(page, `${theme} /diary`));

  for (const { path, proof } of ROUTES) {
    await page.goto(path);
    await expect(proof(page)).toBeVisible({ timeout: 20_000 });
    findings.push(await scan(page, `${theme} ${path}`));
  }

  await test.info().attach(`axe-${theme}.json`, {
    body: asJson(findings),
    contentType: 'application/json',
  });

  expect(report(findings)).toBe('');
}

/* Tagged `@a11y`, which is how the two npm scripts divide this directory: `test:e2e` runs everything
   *except* this tag, `test:a11y` runs only it. The split is not about cost — it is so CI reports
   "the app still works" and "the app is still accessible" as two answers, since they fail for
   unrelated reasons and are usually fixed by different changes. Run `npm run test:e2e:all` for both
   in one pass. */
test(
  'every screen is free of WCAG A/AA violations in the light theme',
  { tag: '@a11y' },
  async ({ app: page, api }) => {
    seedApi(api);
    await scanEveryRoute(page, 'light');
  },
);

test(
  'every screen is free of WCAG A/AA violations in the dark theme',
  { tag: '@a11y' },
  async ({ page, context, api }) => {
    /* Seeded here rather than through the `app` fixture, which hardcodes light. Two `addInitScript`
     calls would also work — the later one wins on the `theme` key — but relying on that ordering to
     express "dark" would be a trick rather than a statement. */
    seedApi(api);
    await seedBrowserState(context, { theme: 'dark' });

    await scanEveryRoute(page, 'dark');
  },
);

/**
 * The states a route walk never reaches.
 *
 * A modal is where accessibility regressions concentrate and where they cost the most: a dialog
 * that fails to name itself, or that leaves the page behind it exposed to the accessibility tree,
 * is unusable with a screen reader in a way no static page is. None of it is on screen until
 * something is clicked, so a scan of the seven routes above has never looked at any of it.
 */
test(
  'open dialogs are free of WCAG A/AA violations',
  { tag: '@a11y' },
  async ({ app: page, api }) => {
    seedApi(api);
    const findings: Finding[] = [];

    await page.goto('/people');
    await expect(page.getByRole('button', { name: 'Add person' }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'Add person' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    findings.push(await scan(page, 'dialog: add person'));
    await page.keyboard.press('Escape');

    /* The passcode dialog, because it is the one modal in the app that is a security control as well
     as a form — a label that does not associate with its input here means someone cannot set a
     passcode by voice or by screen reader, and the fallback is not using the lock at all. */
    await page.goto('/settings');
    await page.getByRole('switch', { name: 'Require a passcode' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    findings.push(await scan(page, 'dialog: set passcode'));

    await test.info().attach('axe-dialogs.json', {
      body: asJson(findings),
      contentType: 'application/json',
    });

    expect(report(findings)).toBe('');
  },
);
