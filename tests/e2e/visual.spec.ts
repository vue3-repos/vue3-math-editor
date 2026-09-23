// Screenshot comparisons. Opt-in (tagged @visual), because font rendering
// differs between machines: run `npm run test:e2e:visual`, and when a change
// is intended, refresh the baselines with
// `npm run test:e2e:visual -- --update-snapshots`. Baselines are stored per
// platform (…-chromium-darwin.png), next to this file.

import { expect, test } from '@playwright/test'

import { SAMPLES } from './samples'
import { Workbench } from './workbench'

test.use({ viewport: { width: 1200, height: 1400 } })

test('every sample, one per line @visual', async ({ page }) => {
  const wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)

  for (const [index, { id }] of SAMPLES.entries()) {
    if (index > 0) {
      await wb.press('End')
      await wb.press('Enter')
    }
    await wb.enterSample(id, index)
  }

  await wb.blur() // no caret or focus ring in the picture
  await expect(page.locator('.equations-stack')).toHaveScreenshot('samples.png', {
    animations: 'disabled',
  })
})

test('caret beside a fraction @visual', async ({ page }) => {
  const wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
  await wb.enterSample('fraction-sum')
  await wb.press('End')
  await wb.press('ArrowLeft', 2) // just after the fraction
  await wb.settle()
  await expect(wb.line(0)).toHaveScreenshot('caret-after-fraction.png', {
    animations: 'disabled',
  })
})
