import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { installApiMock, SIGNED_IN_USER, type ApiMock } from './api';

/* Booting the app into a known state.
 *
 * Two halves are needed and neither is sufficient alone: the session call has to be answered (see
 * api.ts) *and* localStorage has to be seeded. The seeding uses `addInitScript` rather than an
 * `evaluate` after `goto`, because index.html runs a pre-paint script that reads `theme` and `lang`
 * before any module loads — setting them afterwards means the first frame is wrong and the language
 * is whatever Chromium's locale implies. */

interface BootOptions {
  /** Boot without an account, the way "use without signing in" does. */
  localOnly?: boolean;
  /** Passed to the app-lock module's storage, for the lock spec. */
  appLock?: unknown;
}

export async function seedBrowserState(
  context: BrowserContext,
  options: BootOptions = {},
): Promise<void> {
  await context.addInitScript(
    ({ user, localOnly, appLock }) => {
      /* Belt to `serviceWorkers: 'block'`'s braces. workbox-window feature-detects
         `'serviceWorker' in navigator`, so hiding it makes registerSW a no-op even where the
         context option is unavailable. A worker that claims the page would serve index.html from
         precache and route interception would stop seeing navigations. */
      Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined });

      localStorage.setItem('theme', 'light');
      localStorage.setItem('lang', 'en');
      if (localOnly) {
        localStorage.setItem('diary.localOnly', '1');
        localStorage.removeItem('diary.user');
      } else {
        /* Not only the offline-usable bypass in AppLayout: `syncNow()` returns immediately when
           `getCachedUser()` is null, so without this *nothing syncs at all* until AppLayout's
           session effect has run — which makes every sync assertion race a React effect. */
        localStorage.setItem('diary.user', JSON.stringify(user));
        localStorage.removeItem('diary.localOnly');
      }
      if (appLock) localStorage.setItem('appLock', JSON.stringify(appLock));
    },
    {
      user: { name: SIGNED_IN_USER.name, email: SIGNED_IN_USER.email, image: null },
      localOnly: options.localOnly ?? false,
      appLock: options.appLock ?? null,
    },
  );
}

/** `yyyy-MM-dd` for today, computed the way the app computes it (local time, and the zone is
    pinned to UTC in playwright.config.ts) rather than hardcoded into a fixture. */
export const todayKey = (): string => new Date().toISOString().slice(0, 10);

/**
 * An entry *row*, as opposed to anything else showing the same words.
 *
 * A bare `getByText` is ambiguous here and fails strict mode: right after saving, the text is in
 * the entry list *and* still in the composer's textarea (which clears a tick later, once the
 * mutation resolves). `data-tree-row-id` is what EntryItem puts on each row, so this asks the
 * question the specs actually mean — is there an entry saying this.
 */
export const entryRow = (page: Page, text: string) =>
  page.locator('[data-tree-row-id]').filter({ hasText: text });

/**
 * The sync pill's message.
 *
 * Located by its words rather than by `role="status"`, which is also ambiguous — the Save button's
 * spinner carries one too. The words are what the user reads, and pinning them means a copy change
 * that quietly empties the pill fails here rather than passing silently.
 */
export const syncMessage = (page: Page, text: string | RegExp) => page.getByText(text);

/**
 * A page with the API mocked and the browser seeded, ready to navigate.
 *
 * Exposed as a fixture so a spec reads `test('…', async ({ page, api }) => …)` and cannot
 * accidentally navigate before the routes are installed — which would let the first sync through
 * to a real 404 and put the app into an `unreachable` state the spec never asked for.
 */
export const test = base.extend<{ api: ApiMock; app: Page }>({
  api: async ({ page }, use) => {
    await use(await installApiMock(page));
  },
  app: async ({ page, context, api }, use) => {
    void api; // ordering: the mock must be installed before anything navigates
    await seedBrowserState(context);
    await use(page);
  },
});

export { expect } from '@playwright/test';
