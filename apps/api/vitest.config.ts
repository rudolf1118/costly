import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is needed because esbuild (Vitest's default transformer) does not emit
// decorator metadata, which NestJS dependency injection relies on.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    environment: 'node',
    // Configuration every suite needs; suites set connection URLs themselves.
    env: {
      JWT_ACCESS_SECRET: 'test-only-secret-that-is-long-enough-for-hs256',
      // Suites about other behaviour register and log in many times from one
      // IP; the rate limit suites turn it back on.
      AUTH_RATE_LIMIT: 'off',
    },
    // Integration tests start PostgreSQL and Redis containers (Testcontainers).
    hookTimeout: 120_000,
    testTimeout: 15_000,
  },
});
