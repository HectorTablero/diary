import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, localeCodes } from '../../scripts/locales.mjs';
// ./languages, not ./index: the table has no side effects, so this runs in the Node project
// alongside the build script it is being compared against.
import { DEFAULT_LANGUAGE, LANGUAGES, resolveLanguage } from './languages';

/*
 * The language list exists in four places that cannot import each other.
 *
 *   - the JSON files in ./locales, which are what actually ships
 *   - LANGUAGES here, which carries the endonyms a filename cannot
 *   - scripts/locales.mjs, read at build time because index.html's pre-hydration script needs the
 *     list before any module loads, and
 *   - scripts/checkI18n.ts, which derives its own from the directory
 *
 * Three of those derive themselves. LANGUAGES cannot — "日本語" is not recoverable from `ja.json` —
 * so this is where the four are held together. A mismatch would not throw anywhere: it would ship a
 * document labelled with the wrong language, or a picker missing an entry that works fine when
 * reached another way.
 */

const localesDir = fileURLToPath(new URL('./locales', import.meta.url));

const filesOnDisk = () =>
  readdirSync(localesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();

describe('the shipped locale list', () => {
  it('matches the files on disk', () => {
    expect([...LANGUAGES.map((l) => l.code)].sort()).toEqual(filesOnDisk());
  });

  it('is the same list the build stamps into index.html', () => {
    expect(localeCodes()).toEqual(filesOnDisk());
  });

  it('gives every language a non-empty endonym', () => {
    // Labelled in its own language: someone looking for theirs reads it in theirs, not in yours.
    for (const { code, label } of LANGUAGES) {
      expect(label, `${code} has no label`).toBeTruthy();
    }
  });
});

describe('the default language', () => {
  it('is the same value everywhere it is written down', () => {
    expect(DEFAULT_LOCALE).toBe(DEFAULT_LANGUAGE);
  });

  it('is a language that actually ships', () => {
    expect(filesOnDisk()).toContain(DEFAULT_LANGUAGE);
  });

  it('is the reference locale checkI18n compares the others against', () => {
    // That reference is the only locale guaranteed to define every key, which is what makes it
    // safe to fall back to a bundle that may not be loaded.
    const source = readFileSync(
      fileURLToPath(new URL('../../scripts/checkI18n.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toContain(`const REFERENCE = '${DEFAULT_LANGUAGE}'`);
  });
});

describe('resolveLanguage', () => {
  it('keeps a shipped language as itself', () => {
    expect(resolveLanguage('ja')).toBe('ja');
  });

  it('maps a regional tag onto its base language', () => {
    expect(resolveLanguage('zh-CN')).toBe('zh');
    expect(resolveLanguage('it-CH')).toBe('it');
    expect(resolveLanguage('EN-GB')).toBe('en');
  });

  it('falls back to the default for anything unshipped or absent', () => {
    expect(resolveLanguage('de')).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage(undefined)).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage('')).toBe(DEFAULT_LANGUAGE);
  });
});
