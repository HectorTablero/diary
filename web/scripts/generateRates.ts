#!/usr/bin/env tsx
/**
 * Snapshots today's exchange rates into the expense tracker, for devices that are never online.
 *
 * Run from the repo root: npm run generate:rates (add `-- --force` to refresh outside CI).
 *
 * The plugin fetches rates itself whenever it needs them (src/plugins/expenses/rates.ts), but an APK
 * used fully offline never gets the chance — so the build bakes the latest ones in, and the plugin
 * uses whichever is newer, the snapshot or its own cache.
 *
 * Three properties this deliberately has, the same ones generateFlags.ts has:
 *
 *   - The snapshot is committed, so a checkout always builds, typechecks and tests without network.
 *   - It only refreshes in CI (GitHub Actions sets `CI=true`) or when asked to. A local build
 *     rewriting a tracked file every day would be a diff in every commit that nobody made on purpose.
 *     CI's checkout is thrown away after the build, so the APK and the OTA bundle it ships get fresh
 *     rates while the repository doesn't churn.
 *   - It never fails the build. Rates a few weeks old are still rates, and the plugin says how old
 *     they are; a release blocked because a CDN was slow would be much worse.
 *
 * Only currencies `Intl` knows are kept (the source also lists crypto tokens and metals), rounded to
 * six significant digits — far more precision than a diary's totals can show — and sorted, so two
 * runs over the same data write the same bytes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXCHANGE_RATE_SOURCES } from '@diary/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../src/plugins/expenses/rates.snapshot.json');

const SILENT =
  process.argv.includes('--silent') ||
  process.env.npm_config_silent === 'true' ||
  process.env.npm_config_loglevel === 'silent';
const FORCE = process.argv.includes('--force') || process.env.CI === 'true';
const REQUEST_TIMEOUT_MS = 15_000;

const log = (message: string) => {
  if (!SILENT) console.log(message);
};

const round = (value: number) => Number(value.toPrecision(6));

async function fetchRates(): Promise<{ date: string; eur: Record<string, number> } | null> {
  const known = new Set(Intl.supportedValuesOf('currency'));
  for (const url of EXCHANGE_RATE_SOURCES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) {
        console.warn(`rates: ${url} answered ${res.status}`);
        continue;
      }
      const json = (await res.json()) as { date?: unknown; eur?: Record<string, unknown> };
      if (typeof json.date !== 'string' || typeof json.eur !== 'object' || !json.eur) {
        console.warn(`rates: ${url} returned an unexpected shape`);
        continue;
      }
      const eur: Record<string, number> = {};
      for (const [key, value] of Object.entries(json.eur).sort(([a], [b]) => a.localeCompare(b))) {
        if (!known.has(key.toUpperCase())) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
        eur[key] = round(value);
      }
      return { date: json.date, eur };
    } catch (error) {
      console.warn(`rates: ${url} failed — ${(error as Error).message}`);
    }
  }
  return null;
}

async function main() {
  if (fs.existsSync(OUT) && !FORCE) {
    log('rates: snapshot present, not refreshing outside CI (pass --force to refresh)');
    return;
  }
  const rates = await fetchRates();
  if (!rates) {
    console.warn('rates: could not fetch exchange rates — keeping the committed snapshot');
    return;
  }
  fs.writeFileSync(OUT, `${JSON.stringify(rates, null, 2)}\n`);
  log(`rates: snapshot of ${Object.keys(rates.eur).length} currencies from ${rates.date}`);
}

void main();
