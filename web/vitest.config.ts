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

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'logic',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
  },
});
