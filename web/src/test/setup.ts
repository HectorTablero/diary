import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import i18n from '../i18n';
import en from '../i18n/locales/en.json';

/* Shared setup for the component suite.

   English is loaded into the app's *own* i18next instance rather than into a fresh one made here.
   That is not a stylistic preference: several components reach `@/i18n` transitively (lib/dates
   does), and importing it runs its `init({ resources: {} })` — which replaces the resource store
   and would silently empty a separately-configured instance. The symptom is a component rendering
   `common.today` instead of "Today", and only in the files whose import graph happens to include
   it, which is a genuinely confusing thing to debug.

   Loading it here also means tests query by the label a user would actually read rather than by a
   test id, and that a missing key fails a test instead of rendering as itself. */
i18n.addResourceBundle('en', 'translation', en, true, true);
await i18n.changeLanguage('en');

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

// Testing Library's auto-cleanup only registers itself with globals enabled; this suite doesn't
// use them, so unmount between tests explicitly or the DOM accumulates across files.
afterEach(cleanup);
