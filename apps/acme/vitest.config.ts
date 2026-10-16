import { defineConfig } from 'vitest/config';

// Real calls on the fake line take a minute or two each; checks share one setup, in order.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    sequence: { concurrent: false },
  },
});
