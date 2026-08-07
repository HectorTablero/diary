#!/usr/bin/env tsx
/**
 * Fetches the circular language flag for every shipped locale that doesn't have one yet.
 *
 * Run from web/: npx tsx scripts/generateFlags.ts
 *
 * The locale list is discovered from src/i18n/locales/*.json — the same way scripts/checkI18n.ts
 * finds them — so adding a language is still "drop in the JSON file". The next dev start or build
 * downloads its flag, it gets committed with the rest of the change, and nothing has to be fetched
 * by hand.
 *
 * Two properties this deliberately has:
 *
 *   - It skips flags that already exist, so an ordinary build makes no network requests at all.
 *     The files are committed; this only ever fills gaps.
 *   - It never fails the build. A flag is decoration next to a language's own endonym, and CI
 *     going red because GitHub Pages was briefly slow would be a much worse outcome than a picker
 *     with one icon missing — which src/i18n/flags/index.ts already renders correctly.
 *
 * Not every language in the world has an upstream flag (the set is smaller than the country one,
 * and a language deliberately has no flag when no single one would be honest). A miss is reported
 * and moved past.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES = path.resolve(__dirname, '../src/i18n/locales');
const FLAGS = path.resolve(__dirname, '../src/i18n/flags');
const SOURCE = (code: string) =>
  `https://hatscripts.github.io/circle-flags/flags/language/${code}.svg`;

const SILENT =
  process.argv.includes('--silent') ||
  process.env.npm_config_silent === 'true' ||
  process.env.npm_config_loglevel === 'silent';

const REQUEST_TIMEOUT_MS = 10_000;

const log = (message: string) => {
  if (!SILENT) console.log(message);
};

const localeCodes = (): string[] =>
  fs
    .readdirSync(LOCALES)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();

/** The downloaded body, or null with a reason already reported. */
async function fetchFlag(code: string): Promise<string | null> {
  try {
    const res = await fetch(SOURCE(code), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (res.status === 404) {
      console.warn(`flags: no language flag published for "${code}" — the picker will omit it`);
      return null;
    }
    if (!res.ok) {
      console.warn(`flags: ${code} returned HTTP ${res.status} — skipped`);
      return null;
    }
    const body = (await res.text()).trim();
    // A CDN error page is a 200 with HTML in it, and writing that to a .svg would ship a broken
    // icon rather than no icon — which is the one outcome worse than missing.
    if (!body.startsWith('<svg')) {
      console.warn(`flags: ${code} did not come back as SVG — skipped`);
      return null;
    }
    return body;
  } catch (err) {
    console.warn(`flags: could not fetch ${code} (${(err as Error).message}) — skipped`);
    return null;
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(FLAGS, { recursive: true });

  const codes = localeCodes();
  const missing = codes.filter((code) => !fs.existsSync(path.join(FLAGS, `${code}.svg`)));

  if (missing.length === 0) {
    log(`flags: ${codes.length} locales, all have one — nothing to fetch.`);
  } else {
    log(`flags: fetching ${missing.join(', ')}…`);
    let written = 0;
    for (const code of missing) {
      const svg = await fetchFlag(code);
      if (!svg) continue;
      fs.writeFileSync(path.join(FLAGS, `${code}.svg`), `${svg}\n`);
      written++;
      log(`flags: wrote ${code}.svg`);
    }
    log(`flags: ${written}/${missing.length} fetched. Commit them with the locale.`);
  }

  /* Reported, not deleted. A flag whose locale has gone is dead weight, but a generator that
     removes files on every `npm run dev` is a generator you have to think about before running. */
  const orphans = fs
    .readdirSync(FLAGS)
    .filter((name) => name.endsWith('.svg'))
    .map((name) => name.slice(0, -'.svg'.length))
    .filter((code) => !codes.includes(code));
  if (orphans.length > 0) {
    console.warn(`flags: no locale for ${orphans.join(', ')} — safe to delete from src/i18n/flags`);
  }
}

// Reported rather than thrown, for the reason in the header: this must not be able to fail a build.
void main().catch((err: unknown) => console.warn('flags: generation skipped —', err));
