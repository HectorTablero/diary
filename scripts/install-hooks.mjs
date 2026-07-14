import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* Points git at the tracked .githooks/ directory. Runs from the `prepare` npm lifecycle, which
   also fires during `npm ci` in CI and in the Docker build — neither has a .git directory
   (it is .dockerignore'd), so this is a no-op there rather than a build failure. */

const gitDir = fileURLToPath(new URL('../.git', import.meta.url));
if (!existsSync(gitDir)) process.exit(0);

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
} catch {
  // A missing git binary should never break `npm install`.
}
