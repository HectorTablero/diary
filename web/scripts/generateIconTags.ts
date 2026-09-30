#!/usr/bin/env tsx
/**
 * Fetches Lucide's search tags for the installed `lucide-react`, when the committed copy is for a
 * different version.
 *
 * Run from the repo root: npm run generate:icon-tags
 *
 * The tags are what lets the icon picker find `piggy-bank` from "savings" and `utensils` from
 * "restaurant". `lucide-react` doesn't ship them — only `lucide-static` does, a ~50 MB package of
 * SVGs, fonts and sprites of which this needs one 260 kB file — so rather than install all of that
 * to read one file, the file is fetched once per lucide version and committed.
 *
 * Same two properties as generateFlags.ts, for the same reasons:
 *
 *   - It skips when the committed file already matches the installed version, so an ordinary build
 *     makes no network request. It only ever runs for real after a lucide upgrade.
 *   - It never fails the build. Tags are a search aid; the picker still searches icon names without
 *     them, and an icon newer than the tags simply has none until the next successful fetch.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const TARGET = path.resolve(__dirname, '../src/components/icons/lucide-tags.json');
const SOURCE = (version: string) => `https://unpkg.com/lucide-static@${version}/tags.json`;
const REQUEST_TIMEOUT_MS = 15_000;

const SILENT =
  process.argv.includes('--silent') ||
  process.env.npm_config_silent === 'true' ||
  process.env.npm_config_loglevel === 'silent';

const log = (message: string) => {
  if (!SILENT) console.log(message);
};

interface TagsFile {
  lucideVersion: string;
  tags: Record<string, string[]>;
}

function committedVersion(): string | null {
  try {
    return (JSON.parse(fs.readFileSync(TARGET, 'utf8')) as TagsFile).lucideVersion;
  } catch {
    return null;
  }
}

/** One icon per line: a lucide upgrade then diffs as the icons it added, not as one changed line. */
function serialize(file: TagsFile): string {
  const lines = Object.entries(file.tags)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, tags]) => `    ${JSON.stringify(name)}: ${JSON.stringify(tags)}`);
  return (
    `{\n  "lucideVersion": ${JSON.stringify(file.lucideVersion)},\n  "tags": {\n` +
    `${lines.join(',\n')}\n  }\n}\n`
  );
}

async function main(): Promise<void> {
  const { version } = require('lucide-react/package.json') as { version: string };
  if (committedVersion() === version) {
    log(`icon tags: already for lucide ${version} — nothing to fetch.`);
    return;
  }

  log(`icon tags: fetching for lucide ${version}…`);
  const res = await fetch(SOURCE(version), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    console.warn(`icon tags: HTTP ${res.status} — keeping the committed tags`);
    return;
  }
  const body: unknown = await res.json();
  // A CDN error page can come back as a 200; only write something shaped like the real file.
  const valid =
    typeof body === 'object' &&
    body !== null &&
    Object.values(body).every(
      (tags) => Array.isArray(tags) && tags.every((tag) => typeof tag === 'string'),
    );
  if (!valid) {
    console.warn('icon tags: response was not a tag map — keeping the committed tags');
    return;
  }

  fs.writeFileSync(
    TARGET,
    serialize({ lucideVersion: version, tags: body as Record<string, string[]> }),
  );
  log(`icon tags: wrote ${Object.keys(body).length} icons. Commit it with the lucide upgrade.`);
}

// Reported rather than thrown, for the reason in the header: this must not be able to fail a build.
void main().catch((err: unknown) => console.warn('icon tags: generation skipped —', err));
