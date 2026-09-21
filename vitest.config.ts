import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'test/**/*.test.mjs'],
    restoreMocks: true,
    testTimeout: 15_000,
  },
});
