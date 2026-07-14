import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PKG_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

/** The root package.json version is the single source of truth for the app version. */
export function readVersion() {
  const { version } = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
  return parseVersion(version);
}

export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) throw new Error(`package.json version is not Major.Minor.Patch: "${version}"`);
  const [major, minor, patch] = match.slice(1).map(Number);
  return { major, minor, patch, version: `${major}.${minor}.${patch}` };
}

/** Bumping a level resets every level below it: 2.4.10 --major--> 3.0.0. */
export function bump({ major, minor, patch }, level) {
  if (level === 'major') return parseVersion(`${major + 1}.0.0`);
  if (level === 'minor') return parseVersion(`${major}.${minor + 1}.0`);
  if (level === 'patch') return parseVersion(`${major}.${minor}.${patch + 1}`);
  return parseVersion(`${major}.${minor}.${patch}`);
}

/** Android requires a monotonically increasing integer. Minor/patch are given three digits
    each, so 2.4.10 -> 2004010 and any later semver always sorts higher. */
export function versionCode({ major, minor, patch }) {
  if (minor > 999 || patch > 999) {
    throw new Error(`Minor and patch must stay below 1000 to keep versionCode monotonic`);
  }
  return major * 1_000_000 + minor * 1_000 + patch;
}

export function writeVersion(version) {
  const raw = readFileSync(PKG_PATH, 'utf8');
  // Rewrite in place rather than re-serialising, so formatting and key order survive.
  const next = raw.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
  if (next === raw) throw new Error('Could not find a "version" field in package.json');
  writeFileSync(PKG_PATH, next);
}
