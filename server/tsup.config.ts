import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node20',
  noExternal: ['@diary/shared'],
  clean: true,
  sourcemap: true,
});
