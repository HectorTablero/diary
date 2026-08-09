import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/* Standalone from vite.config.ts on purpose: the app config pulls in the PWA plugin and the env
   assertions, none of which the tests need. Only the `@` alias has to match.

   Two projects, because the suites want opposite things. The logic tests (scoring, trees, dates,
   the Dexie layer) are pure and run fastest with no DOM at all; the component tests need jsdom,
   the React plugin for JSX, and a shared setup that boots i18next. Splitting by file extension
   keeps that division obvious from the filename: `.test.ts` is logic, `.test.tsx` is a component. */
const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

/* The three constants vite.config.ts bakes into the bundle.
 *
 * They are not optional the way a plugin is: a module that reads one is reading a plain global,
 * and under a config that doesn't declare it that is a ReferenceError at the point of use rather
 * than a missing feature. lib/telemetry.ts stamps all three onto every event, so the moment
 * anything under test reported anything, it crashed — which is a test failure describing the test
 * environment and nothing about the code.
 *
 * Fixed values rather than the real ones. Tests must not vary with the version in package.json or
 * with which plugins happen to be installed, and no assertion here cares what they say — only that
 * reading them is not an error. */
const define = {
  __APP_VERSION__: JSON.stringify('0.0.0-test'),
  __BUILD_TIME__: JSON.stringify('1970-01-01T00:00:00.000Z'),
  __NATIVE_FINGERPRINT__: JSON.stringify('test'),
};

export default defineConfig({
  define,
  resolve: { alias },
  test: {
    projects: [
      {
        define,
        resolve: { alias },
        test: {
          name: 'logic',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        define,
        resolve: { alias },
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./src/test/setup.ts'],
          /* The app lock derives at 210,000 PBKDF2 iterations by design, which is ~100-200ms per
             verify under Node's webcrypto; a test that sets a passcode and then checks it pays that
             twice, on top of mounting a Radix dialog. Comfortably over 5s on a cold CI runner. */
          testTimeout: 10_000,
        },
      },
    ],
  },
});
