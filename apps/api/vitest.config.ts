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
    // Each integration test file starts its own PostgreSQL and Redis
    // containers. With one worker per core (9 here) all eight such files start
    // about 14 containers at once, and Docker Desktop then sometimes misses
    // Testcontainers' 10 s port-binding deadline: 2 of 20 full runs failed
    // (the cause captured for one was that timeout), 0 of 20 with four
    // workers, which were also faster (about 19 s against 27 s). GitHub's
    // 4-vCPU runners use 3 workers anyway.
    maxWorkers: 4,
    // Integration tests start PostgreSQL and Redis containers (Testcontainers).
    hookTimeout: 120_000,
    testTimeout: 15_000,
  },
});
