import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is needed because esbuild (Vitest's default transformer) does not emit
// decorator metadata, which NestJS dependency injection relies on.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    environment: 'node',
  },
});
