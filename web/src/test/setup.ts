/* MUST be the first import in this file, and this file is the components project's only setupFile.
 *
 * Dexie captures its `indexedDB` binding when *dexie itself* is evaluated, not lazily at open time.
 * The imports below reach `../i18n`, which transitively reaches `@/db/db`, which constructs the
 * Dexie singleton — so anything ordered ahead of this line means Dexie captures `undefined` and no
 * test file can recover, whatever it imports or mocks afterwards. Hence global rather than
 * per-file: there is no such thing here as a component test that doesn't drag the store in, and the
 * ordering trap should not have to be rediscovered once per file. */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { toast } from 'sonner';
import { afterEach, beforeEach } from 'vitest';
import i18n, { seedCoreLanguage } from '../i18n';
import en from '../i18n/locales/en.json';
import { queryClient } from '../lib/queryClient';
import { resetDb } from './seed';

/* Shared setup for the component suite.

   English is loaded into the app's *own* i18next instance rather than into a fresh one made here.
   That is not a stylistic preference: several components reach `@/i18n` transitively (lib/dates
   does), and importing it runs its `init({ resources: {} })` — which replaces the resource store
   and would silently empty a separately-configured instance. The symptom is a component rendering
   `common.today` instead of "Today", and only in the files whose import graph happens to include
   it, which is a genuinely confusing thing to debug.

   Loading it here also means tests query by the label a user would actually read rather than by a
   test id, and that a missing key fails a test instead of rendering as itself.

   `seedCoreLanguage` rather than a bare `addResourceBundle`, which is what this used to be: the
   strings are in the bundle either way, but only the seam records them as *core* strings that have
   been loaded. Code that waits for its own strings before using them — lib/notifications.ts does,
   since a notification's words are fixed at schedule time — would otherwise reach `ensureLanguage`,
   find nothing loaded, and try to fetch a locale file from a jsdom with no server behind it. */
seedCoreLanguage('en', en);
await i18n.changeLanguage('en');

/**
 * How long `waitFor` and `findBy*` keep retrying before giving up.
 *
 * Testing Library's default is one second, which is generous for a re-render and much too tight for
 * two things this app does on purpose. The app lock derives at 210,000 PBKDF2 iterations, so a test
 * that saves a passcode and then verifies it spends most of a second on arithmetic that is *meant*
 * to be slow; and several screens wait on a Dexie read behind a query cache. Both are comfortably
 * under a second on an idle machine and neither is under contention.
 *
 * Raising it costs nothing when tests pass — `waitFor` returns the moment its condition holds, so
 * this only changes how long a *failing* one is retried before it is called a failure. What it buys
 * is that a loaded machine stops producing failures that move from file to file between runs and
 * vanish when the file is run alone, which is the least debuggable shape a red suite can take.
 *
 * Kept well below the 10s test timeout, so a genuinely stuck test still fails as a stuck test.
 */
configure({ asyncUtilTimeout: 5_000 });

/* jsdom implements neither, and Radix uses both — ResizeObserver to measure poppers, pointer
   capture for its dismissable layers. Absent, any test touching a popover or dialog throws before
   it can assert anything. */
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};
// cmdk and Radix's scroll areas call this on the list container when the active item moves.
Element.prototype.scrollTo ??= () => {};

/* jsdom does not implement matchMedia at all, and `lib/theme.ts` calls it at *module scope* — so
   without this, importing anything whose graph reaches the theme (SettingsPage does) throws before
   a test body runs. Both listener APIs are stubbed because the modern one is what the app uses and
   the legacy `addListener` pair is what some dependencies still call. */
window.matchMedia ??= ((query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList) as typeof window.matchMedia;

/* jsdom 27 does implement `crypto.randomUUID` (apiClient.ts calls it at module scope and is fine),
   but not `crypto.subtle` — which lib/appLock.ts needs for PBKDF2. Node's webcrypto is a strict
   superset of what jsdom provides, so swapping the whole object is simpler and safer than patching
   one method onto it.

   Worth knowing when a lock test feels slow: the app derives at 210,000 iterations, deliberately,
   and that is ~100-200ms per verify here. The components project's testTimeout is raised to suit. */
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

/* Node 24's undici validates `RequestInit.signal` by realm identity. In Vitest's jsdom project,
   AbortController can come from jsdom while Request can be Node's, which throws during
   react-router navigation (`new Request(..., { signal })`) and cascades into unrelated failures.
   Keep strict behavior where it already works; only on this exact mismatch, retry without signal. */
{
  const requestCtor = globalThis.Request;
  const testSignal = new AbortController().signal;
  let needsSignalCompat = false;
  try {
    new requestCtor('http://localhost/', { signal: testSignal });
  } catch (error) {
    if (error instanceof TypeError && /Expected signal/.test(String(error))) {
      needsSignalCompat = true;
    } else {
      throw error;
    }
  }

  if (needsSignalCompat) {
    class RequestWithSignalCompat extends requestCtor {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        try {
          super(input, init);
        } catch (error) {
          if (init?.signal && error instanceof TypeError && /Expected signal/.test(String(error))) {
            const { signal: _ignored, ...rest } = init;
            super(input, rest);
            return;
          }
          throw error;
        }
      }
    }
    Object.defineProperty(globalThis, 'Request', {
      value: RequestWithSignalCompat,
      configurable: true,
      writable: true,
    });
  }
}

/* A clean database per test, not merely per file. Vitest isolates module registries per file, so
   each file already gets its own in-memory IndexedDB; this is what stops the second test in a file
   from reading the first one's entries. */
beforeEach(resetDb);

// Testing Library's auto-cleanup only registers itself with globals enabled; this suite doesn't
// use them, so unmount between tests explicitly or the DOM accumulates across files.
afterEach(cleanup);

afterEach(() => {
  /* Sonner keeps its toasts in a module-level store that RTL's cleanup knows nothing about, so
     without this a toast raised in one test is still on screen for the next one — and `getByText`
     finding a toast from a previous test is about the most misleading pass available. */
  toast.dismiss();
  /* The harness renders against the app's singleton QueryClient on purpose (see
     renderWithProviders), which means cached queries outlive a test unless they are cleared here. */
  queryClient.clear();
});
