import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts'],
    // Browser tests run under Playwright (npm run test:e2e), not Vitest.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    // Test files share workers rather than each getting a fresh one: setting up
    // a jsdom environment per file was most of the run time (about 4x slower).
    // No test relies on module state another file leaves behind; if one ever
    // fails only in the full run, suspect this first.
    isolate: false,
  },
})
