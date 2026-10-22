import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Lets a test render a component to static markup (the tsconfig keeps JSX for Next).
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.{ts,tsx}', 'components/**/*.test.{ts,tsx}', 'features/**/*.test.{ts,tsx}', 'embed/**/*.test.ts', 'app/**/*.test.{ts,tsx}'],
  },
});
