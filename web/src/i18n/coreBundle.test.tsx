import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Core strings and plugin strings share one i18next bundle, and that sharing had a bug in it.
 *
 * Both halves call `addResourceBundle(code, 'translation', …)` — core with the app's own strings,
 * plugins with theirs nested under `plugins.<id>.`. That is deliberate and load-bearing: a key
 * prefix rather than an i18next namespace is what keeps `scripts/checkI18n.ts` able to see plugin
 * keys at all (a colon is outside its `[\w.]+` extractor).
 *
 * The consequence nobody had to think about until a plugin shipped: `hasResourceBundle(code,
 * 'translation')` stops meaning "the core strings for that language are loaded" the moment a plugin
 * has registered anything for it. `ensurePluginLocales` fetches *every* language in the background
 * so switching works offline, so after one notification reconcile all five languages answer `true`
 * — and `ensureLanguage` short-circuits, leaving the app's own strings for the new language never
 * fetched.
 *
 * What that looks like in use is very specific, and is exactly what was reported: the plugin's own
 * labels switch instantly (their strings really are loaded) while the whole app around them stays
 * in the previous language, until a reload — where `ensureLanguage` runs from bootstrap before any
 * plugin has touched the bundle, and works.
 *
 * `.tsx` so it lands in the jsdom project: i18n/index.ts registers window and document listeners.
 */

const CORE = { greeting: 'Hola' };
const PLUGIN = { plugins: { habits: { title: 'Hábitos' } } };

/** Locale files are fetched by URL; only the core one is counted, since the bug is that it is
    skipped entirely. */
let coreFetches = 0;

beforeEach(() => {
  coreFetches = 0;
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      // The core locales live in i18n/locales/, plugin ones in plugins/<id>/locales/.
      if (!url.includes('plugins')) coreFetches++;
      return {
        ok: true,
        status: 200,
        json: async () => (url.includes('plugins') ? PLUGIN : CORE),
      } as Response;
    }),
  );
});

describe('ensureLanguage, once a plugin shares the bundle', () => {
  it('still fetches the app’s own strings for a language a plugin has already registered', async () => {
    const { default: i18n, ensureLanguage } = await import('./index');

    /* Exactly what a background plugin-locale pass does: register that language's plugin strings
       into the shared `translation` bundle, without any core strings having been loaded for it. */
    i18n.addResourceBundle('es', 'translation', PLUGIN, true, true);
    expect(i18n.hasResourceBundle('es', 'translation')).toBe(true);

    await ensureLanguage('es');

    // The regression: this was 0, because `hasResourceBundle` had already answered "loaded".
    expect(coreFetches).toBe(1);
    expect(i18n.getResource('es', 'translation', 'greeting')).toBe('Hola');
    // And the plugin's strings must survive the merge rather than being replaced by it.
    expect(i18n.getResource('es', 'translation', 'plugins.habits.title')).toBe('Hábitos');
  });

  it('does not re-fetch a language whose core strings really are loaded', async () => {
    // The short-circuit still has to work, or every language switch re-downloads its strings.
    const { ensureLanguage } = await import('./index');
    await ensureLanguage('es');
    expect(coreFetches).toBe(1);
    await ensureLanguage('es');
    expect(coreFetches).toBe(1);
  });

  it('switches language with the app’s strings present, not just the plugin’s', async () => {
    const { default: i18n, changeLanguage } = await import('./index');
    i18n.addResourceBundle('es', 'translation', PLUGIN, true, true);

    await changeLanguage('es');

    expect(i18n.language).toBe('es');
    // `t` resolving to the key itself is the raw-key flash this ordering exists to prevent.

    const temp = i18n.t; // Otherwise the i18n tests would find the "greeting" key via regex and report it as missing
    expect(temp('greeting')).toBe('Hola');
  });
});
