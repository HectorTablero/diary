import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

/* The module is mocked rather than the env var stubbed. API_BASE is `import.meta.env.VITE_API_BASE`
   read at module scope, and Vite replaces that statically during transform — so by the time any
   stub could run, the value is already baked in as the empty string the web build uses, and every
   case below would return null for the wrong reason. */
vi.mock('./apiClient', () => ({ API_BASE: 'https://diary.tablerus.es' }));

import { routeForUrl } from './deepLinks';

/*
 * What the app is willing to open from a link.
 *
 * The list here has to stay in step with the `pathPrefix` entries in AndroidManifest.xml — Android
 * decides which URLs reach the app, this decides what happens to them once they arrive, and a gap
 * either way is silent. Too narrow and a claimed link opens the app on the wrong screen; too wide
 * and the app offers to handle URLs it cannot render.
 */
describe('routeForUrl', () => {
  it('opens the screens the manifest claims', () => {
    expect(routeForUrl('https://diary.tablerus.es/diary/2026-08-07')).toBe('/diary/2026-08-07');
    expect(routeForUrl('https://diary.tablerus.es/people/abc123')).toBe('/people/abc123');
    expect(routeForUrl('https://diary.tablerus.es/calendar')).toBe('/calendar');
    expect(routeForUrl('https://diary.tablerus.es/settings')).toBe('/settings');
  });

  it('keeps the query and hash, which carry state on the search screen', () => {
    expect(routeForUrl('https://diary.tablerus.es/search?q=climbing')).toBe('/search?q=climbing');
    expect(routeForUrl('https://diary.tablerus.es/people/abc#events')).toBe('/people/abc#events');
  });

  it('refuses another origin outright', () => {
    // A link that merely mentions the host must not be enough to steer the app.
    expect(routeForUrl('https://example.com/people/abc')).toBeNull();
    expect(routeForUrl('https://diary.tablerus.es.evil.com/people/abc')).toBeNull();
    expect(routeForUrl('http://diary.tablerus.es/people/abc')).toBeNull(); // wrong scheme
  });

  it('never claims the API', () => {
    /* The most important case. /api is this app's own REST endpoint including the OAuth callback,
       and an app that offered to open those URLs could intercept a request meant for the server. */
    expect(routeForUrl('https://diary.tablerus.es/api/sync')).toBeNull();
    expect(routeForUrl('https://diary.tablerus.es/api/auth/callback/google')).toBeNull();
  });

  it('ignores paths the router has no screen for', () => {
    expect(routeForUrl('https://diary.tablerus.es/')).toBeNull();
    expect(routeForUrl('https://diary.tablerus.es/login')).toBeNull();
    expect(routeForUrl('https://diary.tablerus.es/.well-known/assetlinks.json')).toBeNull();
  });

  it('matches whole segments, not string prefixes', () => {
    // `/peopleish` starts with `/people` as text but is a different route entirely.
    expect(routeForUrl('https://diary.tablerus.es/peopleish')).toBeNull();
    expect(routeForUrl('https://diary.tablerus.es/settingsx/y')).toBeNull();
  });

  it('cannot be walked out of its allowed prefixes', () => {
    // URL parsing resolves `..` before this ever sees it; pinned so that stays true.
    expect(routeForUrl('https://diary.tablerus.es/people/../api/sync')).toBeNull();
  });

  it('tolerates a trailing slash and rubbish input', () => {
    expect(routeForUrl('https://diary.tablerus.es/people/')).toBe('/people');
    expect(routeForUrl('not a url')).toBeNull();
    expect(routeForUrl('')).toBeNull();
  });

  it('accepts exactly what the manifest claims, and nothing else', () => {
    /* Two halves of one decision, in two files that cannot import each other: Android decides
       which URLs reach the app, this decides what becomes of them. Drift is silent in both
       directions — a prefix only in the manifest gives a link that opens the app and then does
       nothing, and one only here is dead code waiting to be trusted. */
    const manifest = readFileSync(
      fileURLToPath(new URL('../../android/app/src/main/AndroidManifest.xml', import.meta.url)),
      'utf8',
    );
    const claimed = [...manifest.matchAll(/android:pathPrefix="([^"]+)"/g)].map((m) => m[1]).sort();

    expect(claimed.length).toBeGreaterThan(0);
    for (const prefix of claimed) {
      expect(routeForUrl(`https://diary.tablerus.es${prefix}`), `${prefix} is claimed but ignored`)
        .toBe(prefix);
    }
  });
});
