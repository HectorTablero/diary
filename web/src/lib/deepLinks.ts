import { API_BASE } from './apiClient';

/**
 * Turning an incoming https:// link into a route.
 *
 * Android hands the app the whole URL it was opened with (see the App Links intent-filter in
 * AndroidManifest.xml). react-router wants a path, and it must be a path this app can actually
 * render — an unrecognised one would land on the catch-all and silently redirect to today's diary,
 * which is a worse answer than not claiming the link at all.
 *
 * Kept apart from the listener that calls it because this is the part with rules in it, and rules
 * are worth testing without a device attached.
 */

/**
 * Route prefixes this app will open from a link.
 *
 * Deliberately the same set as the `pathPrefix` entries in the manifest, and for the same reason:
 * `/api/*` must never be claimed — it is this app's own REST endpoint, including the OAuth callback
 * — and `/login` is a screen the app reaches on its own terms rather than something a link should
 * drop someone onto.
 */
const OPENABLE = ['/diary', '/calendar', '/people', '/search', '/tags', '/threads', '/settings'];

/** The origin whose links belong to this app. Empty on the web, where nothing calls this. */
const appOrigin = (): string | null => {
  try {
    return API_BASE ? new URL(API_BASE).origin : null;
  } catch {
    return null;
  }
};

/**
 * The route to navigate to for an opened URL, or `null` to ignore it.
 *
 * Null rather than a fallback route on purpose. Being handed a URL this app does not recognise
 * means the intent filter and this list have drifted apart, and quietly showing the diary would
 * hide that while also losing wherever the person was actually trying to go.
 */
export function routeForUrl(url: string): string | null {
  const origin = appOrigin();
  if (!origin) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // Same origin only. A link to somebody else's site that happened to reach us is not ours to open.
  if (parsed.origin !== origin) return null;

  // `new URL` has already resolved any `..` segments, so pathname cannot climb out of the prefixes.
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  const openable = OPENABLE.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (!openable) return null;

  return `${path}${parsed.search}${parsed.hash}`;
}
