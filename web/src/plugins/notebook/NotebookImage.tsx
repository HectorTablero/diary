import { ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCachedImage, putCachedImage, resizeIfNeeded } from './imageCache';
import { usePluginPreference } from '../reminders';

/**
 * One `![alt](url)` from a document, resolved cache-first.
 *
 * Three outcomes, in order:
 *
 *   1. **Already cached** — an `<img>` pointed at an object URL built from the cached blob. Never
 *      touches the network, so this is the one path guaranteed to work offline.
 *   2. **Not cached** — an `<img>` pointed at `url` directly. Simplest possible path for the common
 *      case: the browser's own network stack fetches and displays it, with no manual `fetch`/CORS
 *      handling standing between the user and just seeing their image. `onError` is the fallback to
 *      the placeholder, for a broken link or no connection.
 *   3. **Not cached, but should be** — same as (2), plus a best-effort background fetch that resizes
 *      and stores a copy for next time (see imageCache.ts). This never gates what's on screen: the
 *      visible `<img>` in (2) already succeeded or failed on its own by the time this settles.
 *
 * A cross-origin image with no CORS headers can be *displayed* by (2) — `<img>` doesn't require it —
 * but can't be read into a canvas for resizing, so step 3 fails silently for it. That is an accepted,
 * invisible degradation: the image still shows, it simply won't survive to the next offline visit.
 */
export function NotebookImage({ src, alt }: { src: string; alt: string }) {
  const { t } = useTranslation();
  const [cacheImages] = usePluginPreference<boolean>('notebook', 'cacheImages', false);
  const [cachedUrl, setCachedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    void (async () => {
      const cached = await getCachedImage(src);
      if (cancelled) return;
      if (cached) {
        objectUrl = URL.createObjectURL(cached);
        setCachedUrl(objectUrl);
        return;
      }
      if (!cacheImages) return;
      // Best-effort: nothing here is awaited by the render path, and every failure — offline, no
      // CORS, a 404 — is silently a "not cached yet", never a visible error. The image on screen
      // came from the plain <img> below, independently.
      try {
        const response = await fetch(src, { mode: 'cors' });
        if (!response.ok) return;
        const blob = await response.blob();
        if (cancelled) return;
        await putCachedImage(src, await resizeIfNeeded(blob));
      } catch {
        /* offline, CORS-blocked, or unreachable — nothing to do */
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, cacheImages]);

  if (failed && !cachedUrl) {
    return (
      <span
        role="img"
        aria-label={alt || t('plugins.notebook.imageNotFound')}
        className="my-3 flex flex-col items-center gap-1.5 rounded-lg border border-dashed bg-muted/40 py-6 text-muted-foreground"
      >
        <ImageOff className="size-5" aria-hidden />
        <span className="text-xs">{t('plugins.notebook.imageNotFound')}</span>
      </span>
    );
  }

  return (
    <img
      src={cachedUrl ?? src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="my-3 max-w-full rounded-lg"
    />
  );
}
