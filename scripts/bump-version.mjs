import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { bump, readVersion, versionCode, writeVersion } from './version.mjs';

/* Interactive version bump, run from the pre-commit hook. The root package.json version is the
   source of truth for the release tag, the APK versionName/versionCode and the OTA bundle, so it
   has to move whenever a commit ships something. */

const CHOICES = {
  1: 'major',
  2: 'minor',
  3: 'patch',
  4: 'none',
};

async function main() {
  const current = readVersion();

  // No terminal (GUI client, CI, `git commit` piped): leave the version alone rather than hang.
  if (!process.stdin.isTTY) {
    console.log(`[version] non-interactive terminal, keeping v${current.version}`);
    return;
  }

  const preview = (level) => bump(current, level).version;
  console.log(`\nCurrent version: v${current.version}`);
  console.log(`  1) major  -> v${preview('major')}`);
  console.log(`  2) minor  -> v${preview('minor')}`);
  console.log(`  3) patch  -> v${preview('patch')}`);
  console.log(`  4) none   -> v${preview('none')} (unchanged)`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Bump version [1-4, default 4]: ')).trim();
  rl.close();

  const level = CHOICES[answer || '4'];
  if (!level) {
    console.log(`[version] "${answer}" is not a choice, keeping v${current.version}`);
    return;
  }
  if (level === 'none') {
    console.log(`[version] keeping v${current.version}`);
    return;
  }

  const next = bump(current, level);
  writeVersion(next.version);
  // Stage it so the bump lands in the commit that triggered the hook.
  execFileSync('git', ['add', 'package.json'], { stdio: 'inherit' });
  console.log(`[version] v${current.version} -> v${next.version} (versionCode ${versionCode(next)})`);
}

await main();
