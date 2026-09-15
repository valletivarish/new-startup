import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // No database, no network. The harness is a measuring instrument and its
    // tests must be able to run anywhere, including CI with no credentials.
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
