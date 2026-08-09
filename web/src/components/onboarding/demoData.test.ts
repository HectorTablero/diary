import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { segmentContent } from '@/lib/tokens';
import en from '@/i18n/locales/en.json';
import es from '@/i18n/locales/es.json';
import it_ from '@/i18n/locales/it.json';
import ja from '@/i18n/locales/ja.json';
import zh from '@/i18n/locales/zh.json';
import { demoData } from './demoData';

/*
 * The one thing about the onboarding tour that can break silently, in a language nobody on this
 * project reads.
 *
 * The tour's second screen exists to teach that `@` links a person and `#` links a tag. Both are
 * rendered by `segmentContent`, which matches the text immediately after the sigil against an
 * entity's name — so the demo entries interpolate the names rather than spelling them out
 * ("@{{person}}"), and a translator who writes "@ {{person}}", drops the sigil, or reorders it away
 * from the placeholder turns the token into ordinary grey text. The screen still renders. The
 * sentence still reads. It simply demonstrates the opposite of what it says.
 *
 * checkI18n cannot see this: the placeholder is still present, so its interpolation-parity rule is
 * satisfied. Nothing else in the suite renders the tour in anything but English.
 *
 * Deliberately in the `logic` project (`.test.ts`, no DOM): the locale JSON is read straight off
 * disk and fed through a two-line `t`, so this asserts against the shipped files rather than
 * against whatever i18next happens to have loaded.
 */

const BUNDLES: Record<string, unknown> = { en, es, it: it_, ja, zh };

/** Just enough of i18next: dotted lookup plus {{var}} substitution. */
const tFor = (bundle: unknown): TFunction =>
  ((key: string, vars?: Record<string, string>) => {
    const raw = key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], bundle);
    if (typeof raw !== 'string') throw new Error(`no string at "${key}"`);
    return raw.replace(/\{\{(\w+)}}/g, (_, name: string) => vars?.[name] ?? `{{${name}}}`);
  }) as unknown as TFunction;

describe('demoData · the tour teaches the sigils in every language', () => {
  for (const [lang, bundle] of Object.entries(BUNDLES)) {
    describe(lang, () => {
      const demo = demoData(tFor(bundle));
      const entries = [demo.entry, ...demo.entry.children];

      it('leaves no @ or # stranded outside a matched token', () => {
        for (const entry of entries) {
          const stranded = segmentContent(entry.content, entry.people, entry.tags)
            .filter((segment) => segment.kind === 'text' && /[@#]/.test(segment.text))
            .map((segment) => segment.text);
          /* A stranded sigil is exactly the symptom: the name drifted away from it — usually by a
             space — so the token matched nothing and fell through as plain text. */
          expect(stranded, `${lang}: "${entry.content}"`).toEqual([]);
        }
      });

      it('highlights both a person and a tag in the headline entry', () => {
        const kinds = segmentContent(demo.entry.content, demo.entry.people, demo.entry.tags).map(
          (segment) => segment.kind,
        );
        expect(kinds).toContain('person');
        expect(kinds).toContain('tag');
      });

      it('gives every token an id, so it resolves to something real', () => {
        for (const entry of entries) {
          for (const segment of segmentContent(entry.content, entry.people, entry.tags)) {
            if (segment.kind !== 'text') expect(segment.id).toBeTruthy();
          }
        }
      });

      it('names the person and the tag in this language rather than falling back', () => {
        // A locale that copied the English demo names verbatim would still pass everything above.
        expect(demo.person.name).toBe(tFor(bundle)('onboarding.demo.person'));
        expect(demo.tag.name).toBe(tFor(bundle)('onboarding.demo.tag'));
        expect(demo.person.name.length).toBeGreaterThan(0);
        expect(demo.tag.name.length).toBeGreaterThan(0);
      });
    });
  }
});
