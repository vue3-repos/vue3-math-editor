import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts'],
    // Browser tests run under Playwright (npm run test:e2e), not Vitest.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
})
