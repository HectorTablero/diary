/**
 * Offline storage for images a document links to with `![alt](url)`.
 *
 * ## Cache Storage, not Dexie
 *
 * This is content the app *fetched*, not content the user *wrote* — nothing here is synced, replayed
 * through the outbox, or worth a Dexie table and a `db.ts` version bump. The Cache Storage API is the
 * browser's own name for exactly this shape of thing (a URL keying a stored `Response`), and it is
 * already load-bearing in this app: `vite-plugin-pwa`'s service worker keeps its own runtime caches in
 * it. This is a bucket of its own (`notebook-images`) rather than a route added to that worker's
 * config, because populating it needs a resize pass first (see `resizeIfNeeded` below) that a
 * declarative `CacheFirst` rule cannot express, and matching arbitrary external image hosts in that
 * worker's config would widen it app-wide for the sake of one plugin.
 *
 * It is also, on purpose, not made permanent. Cache Storage is already subject to the browser's own
 * storage-pressure eviction, the same as any other origin data — and that is the right lifetime for a
 * resized copy of someone else's image: worth keeping while there is room, never worth guarding with
 * a manual TTL or a "clear cache" button that has to be discovered and pressed. The same mechanism
 * covers the packaged Android build without any native code: Capacitor's WebView is Chromium, and
 * Chromium's Cache Storage implementation is exactly the one the web build already uses.
 *
 * Feature-detected and fails open throughout — a browser (or a very old WebView) with no `caches`
 * simply never caches, and every caller already has to handle "not cached" as the ordinary case.
 */

const CACHE_NAME = 'notebook-images';

/** The stored copy's width is clamped to this before it is written — not the image as displayed,
    only the one kept for later. A note's images are illustrations, not photography; 1600px is
    comfortably past what any phone or laptop screen renders them at, and every pixel beyond that is
    storage spent for no visible gain. */
export const MAX_CACHED_IMAGE_WIDTH = 1600;

const available = () => typeof caches !== 'undefined';

/** The cached copy for `url`, or `undefined` if there isn't one (including "caching isn't available
    here at all"). */
export async function getCachedImage(url: string): Promise<Blob | undefined> {
  if (!available()) return undefined;
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(url);
    return response ? await response.blob() : undefined;
  } catch {
    // A private-mode or quota failure here is not worth losing the image over — the caller falls
    // back to fetching it plainly, same as a cache miss.
    return undefined;
  }
}

/** Store (or replace) the cached copy for `url`. Never throws — caching is always best-effort. */
export async function putCachedImage(url: string, blob: Blob): Promise<void> {
  if (!available()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    // A synthetic Response, not a real network one: what's being stored is the *resized* blob,
    // which never had a Response of its own. Content-Type carries through so a later `cache.match`
    // yields a Blob the browser still knows how to display.
    await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type } }));
  } catch {
    // Full storage, or a browser that opened the cache but refuses the write — the image still
    // displayed from the network moments ago; it just won't survive to the next offline visit.
  }
}

/**
 * Shrinks `blob` to `maxWidth` if it's wider than that, keeping its own format and aspect ratio.
 * Returns the original blob unchanged when it's already narrow enough, or when decoding fails —
 * an image this can't safely resize is still worth caching at its original size rather than not at
 * all, and the caller has no better fallback to offer either way.
 *
 * `createImageBitmap` + `<canvas>` rather than a library: both are native, so this costs nothing in
 * bytes and, being reached only from this plugin's own lazily-loaded chunk, nothing in anyone else's
 * first paint either (see registry.ts rule 5 — this simply never needs a name in VENDOR_CHUNKS to
 * begin with).
 */
export async function resizeIfNeeded(blob: Blob, maxWidth = MAX_CACHED_IMAGE_WIDTH): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width <= maxWidth) {
      bitmap.close();
      return blob;
    }
    const scale = maxWidth / bitmap.width;
    const canvas = document.createElement('canvas');
    canvas.width = maxWidth;
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return blob;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const resized = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, blob.type || 'image/png'),
    );
    return resized ?? blob;
  } catch {
    return blob;
  }
}
