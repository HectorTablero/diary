import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { useSyncExternalStore } from 'react';
import { isNative } from './native';

/**
 * Whether to drop non-essential motion, from whichever source can actually see the setting.
 *
 * On the web that is `prefers-reduced-motion` and nothing else. In the Android app the media query
 * is not dependable — the WebView decides it from preferences computed when it was created, so a
 * setting turned on afterwards never reaches the running page, and on the builds this app meets it
 * doesn't arrive at all. The native side reads Android's own animator duration scale instead (see
 * ReducedMotionPlugin.java) and this ORs the two: either saying "reduce" is enough. Nothing here
 * can turn motion back on against the media query, so the web path behaves exactly as before.
 *
 * The result is published two ways, because the app reduces motion in two places that can't see
 * each other: `data-reduced-motion` on <html> for the CSS in index.css, and this store for
 * Framer Motion's MotionConfig, whose animations run in JavaScript.
 */
interface ReducedMotionPlugin {
  isReduced(): Promise<{ reduced: boolean }>;
}

const Native = registerPlugin<ReducedMotionPlugin>('ReducedMotion');

const QUERY = '(prefers-reduced-motion: reduce)';

let fromMedia = false;
let fromSystem = false;
let reduced = false;
const listeners = new Set<() => void>();

const publish = () => {
  const next = fromMedia || fromSystem;
  if (next === reduced) return;
  reduced = next;
  // Removed rather than set to a falsy value: the CSS matches on the attribute's presence, and an
  // empty one left behind would be a state nothing can style.
  if (reduced) {
    document.documentElement.dataset.reducedMotion = 'reduce';
  } else {
    delete document.documentElement.dataset.reducedMotion;
  }
  for (const listener of listeners) listener();
};

/** Reads both sources and keeps watching them. Call once, before the first render. */
export function initReducedMotion(): void {
  const media = window.matchMedia(QUERY);
  fromMedia = media.matches;
  media.addEventListener('change', (event) => {
    fromMedia = event.matches;
    publish();
  });
  publish();

  if (!isNative) return;

  /* Re-read on every foreground rather than once at launch: the only way to change this setting is
     to leave for the system settings app and come back, so a resume is precisely when the answer
     can have changed.

     Failure is silent on purpose. A live-updated bundle (lib/liveUpdate.ts) can be newer than the
     APK it runs inside, so this call may reach a shell with no such plugin — and the honest
     fallback there is the media query alone, not a broken boot. */
  const pull = () =>
    void Native.isReduced()
      .then(({ reduced: value }) => {
        fromSystem = value;
        publish();
      })
      .catch(() => {});

  pull();
  void App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) pull();
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useReducedMotion = (): boolean => useSyncExternalStore(subscribe, () => reduced);
