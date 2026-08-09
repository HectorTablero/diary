import type { Locator, Page } from '@playwright/test';

/* The app's screens, each paired with proof that it actually rendered.
 *
 * Shared by two specs that need the same table for different reasons. `navigation.spec.ts` walks it
 * to prove every lazy chunk resolves in the built artefact; `a11y.spec.ts` walks it to scan each
 * screen with axe. Both would otherwise carry their own copy, and the copies would agree only until
 * the next route was added — at which point the accessibility scan would quietly stop covering it,
 * which is the failure mode that matters least visibly and most.
 *
 * The `proof` locator is not decoration in either case. Every page is a lazy `import()` behind a
 * Suspense boundary, so `goto` resolving means the *URL* changed and nothing more: what is on screen
 * at that moment is a spinner. Scanning then would report a clean bill of health for a loading
 * state, so both specs wait on the page's own content before doing anything.
 */

export interface AppRoute {
  path: string;
  /** Something only this page renders, on the far side of its Suspense boundary. */
  proof: (page: Page) => Locator;
}

/**
 * The diary composer — the diary page having rendered.
 *
 * Its own export because `/diary/:dateKey` is parameterised (see `todayKey()`), so it cannot sit in
 * the static table below, and because it doubles as the "the app booted" check every spec opens
 * with.
 */
export const composer = (page: Page): Locator =>
  page.getByPlaceholder('What happened? Use @person and #tag…');

/**
 * The static routes.
 *
 * Proofs are chosen to be a *control* of the page rather than its heading wherever possible: the
 * three Explore screens hide their own titles under the bottom tab bar (the segmented switcher names
 * them there instead), so a title-based check would be asserting a viewport as much as a route.
 */
export const ROUTES: AppRoute[] = [
  { path: '/calendar', proof: (page) => page.getByRole('button', { name: 'Previous month' }) },
  /* `.first()` because an empty people list offers "Add person" twice — in the header and again in
     the empty state. Both are the page having rendered, which is all this check asks. */
  { path: '/people', proof: (page) => page.getByRole('button', { name: 'Add person' }).first() },
  { path: '/search', proof: (page) => page.getByPlaceholder('Search your entries…') },
  { path: '/tags', proof: (page) => page.getByRole('button', { name: 'Add tag' }) },
  { path: '/threads', proof: (page) => page.getByRole('button', { name: 'New thread' }) },
  { path: '/settings', proof: (page) => page.getByRole('switch', { name: 'Require a passcode' }) },
];
