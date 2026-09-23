import { defineConfig, devices } from '@playwright/test'

// Browser (end-to-end) tests for the editor surface. They live in tests/e2e and
// are separate from the Vitest unit tests (see vitest.config.ts).
//
//   npm run test:e2e          run the suite (starts the Vite dev server itself)
//   npm run test:e2e:visual   screenshot comparisons only (see visual.spec.ts)
//
// PLAYWRIGHT_CHROMIUM_EXECUTABLE, if set, points at a system Chromium instead
// of the one `npx playwright install chromium` downloads.

const port = 5183

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // Screenshot comparisons are opt-in: they depend on the OS's font rendering.
  grepInvert: process.env.E2E_VISUAL ? undefined : /@visual/,

  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
        },
      },
    },
  ],

  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
  },
})
