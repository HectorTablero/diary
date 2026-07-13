import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/* Standalone from vite.config.ts on purpose: the app config pulls in the PWA and React plugins,
   none of which the (pure, DOM-free) unit tests need. Only the `@` alias has to match. */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
