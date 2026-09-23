// Screenshot comparisons. Opt-in (tagged @visual), because font rendering
// differs between machines: run `npm run test:e2e:visual`, and when a change
// is intended, refresh the baselines with
// `npm run test:e2e:visual -- --update-snapshots`. Baselines are stored per
// platform (…-chromium-darwin.png), next to this file.

import { expect, test } from '@playwright/test'

import { Playground } from './playground'

test.use({ viewport: { width: 900, height: 1300 } })

test('playground layout @visual', async ({ page }) => {
  const pg = new Playground(page)
  await pg.goto()
  await expect(page.locator('main')).toHaveScreenshot('playground.png', { animations: 'disabled' })
})

test('caret beside a fraction @visual', async ({ page }) => {
  const pg = new Playground(page)
  await pg.goto()
  await pg.focus('fraction-sum')
  await pg.press('End')
  await pg.press('ArrowLeft', 2) // just after the fraction
  await pg.settle()
  await expect(pg.field('fraction-sum')).toHaveScreenshot('caret-after-fraction.png', {
    animations: 'disabled',
  })
})
