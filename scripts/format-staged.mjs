import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

/* Formats the files a commit is about to introduce, then re-stages them.
 *
 * Runs from the pre-commit hook *after* bump-version.mjs, which is the whole reason it is a
 * separate step rather than part of that script: the bump writes package.json and `git add`s it,
 * so it has to already be staged for this to reach it.
 *
 * Scoped to staged paths rather than running `prettier --write .` because the repo is only
 * partly formatted — a whole-tree run would drag ~180 unrelated files into whatever commit
 * happened to be next. Formatting what you touch converges on the same place without ever
 * producing a diff nobody asked for.
 */

const require = createRequire(import.meta.url);
// Invoke the CLI through the current node binary. `npx prettier` would need a shell on Windows
// (npx is a .cmd), and shelling out with interpolated paths is how filenames with spaces break.
const PRETTIER = require.resolve('prettier/bin/prettier.cjs');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

// -z keeps paths NUL-separated, so spaces and non-ASCII survive intact. ACMR skips deletions and
// unmerged paths: there is nothing to format, and prettier exits non-zero on a path that is gone.
function paths(args) {
  return git([...args, '-z'])
    .split('\0')
    .filter(Boolean);
}

const staged = paths(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
if (staged.length === 0) process.exit(0);

/* A file that is staged *and* dirty in the working tree is left alone.
 *
 * Formatting rewrites the file on disk, and the `git add` below would then sweep the unstaged
 * edits into a commit the author deliberately kept them out of. Of everything this hook can get
 * wrong that is the only one that loses work rather than merely annoying, so the partially-staged
 * case opts out and says so. `git add -p` users keep their split; the file gets formatted by the
 * commit that finally stages the rest. */
const dirty = new Set(paths(['diff', '--name-only']));
const skipped = staged.filter((file) => dirty.has(file));
const targets = staged.filter((file) => !dirty.has(file));

if (skipped.length > 0) {
  console.log(`[format] left alone, staged copy differs from the working tree:`);
  for (const file of skipped) console.log(`           ${file}`);
}
if (targets.length === 0) process.exit(0);

/* --ignore-unknown drops paths prettier has no parser for (the keystore, *.gradle, images) rather
   than failing the commit over them. .prettierignore still applies on top, which is what keeps
   the generated files under web/android out of this. */
execFileSync(process.execPath, [PRETTIER, '--write', '--ignore-unknown', '--', ...targets], {
  stdio: 'inherit',
});

// Re-stage only the paths that were already staged: never widen the commit.
execFileSync('git', ['add', '--', ...targets], { stdio: 'inherit' });
