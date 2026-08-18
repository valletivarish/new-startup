import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Testcontainers pulls and boots a real PostgreSQL image on first run.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One container, shared across files, created in the global setup.
    globalSetup: ['./test/setup/global-setup.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
