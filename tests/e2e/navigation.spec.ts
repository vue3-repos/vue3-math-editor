import { expect, test } from '@playwright/test'

import { SAMPLES, expectedStops } from './samples'
import { Workbench } from './workbench'

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

for (const { id, label } of SAMPLES) {
  test.describe(label, () => {
    test('→ visits every position in order and stops at the end', async () => {
      const stops = expectedStops(id)
      await wb.enterSample(id)
      await wb.press('Home')

      for (const stop of stops) {
        await expect(wb.cursor()).toHaveText(stop)
        await wb.press('ArrowRight')
      }

      // One more press at the end changes nothing.
      await expect(wb.cursor()).toHaveText(stops[stops.length - 1])
    })

    test('← from the end retraces the same positions in reverse', async () => {
      const stops = expectedStops(id).reverse()
      await wb.enterSample(id)
      await wb.press('End')

      for (const stop of stops) {
        await expect(wb.cursor()).toHaveText(stop)
        await wb.press('ArrowLeft')
      }

      await expect(wb.cursor()).toHaveText('root @ 0')
    })
  })
}

test('Home and End jump to the start and end of the equation', async () => {
  await wb.enterSample('power-over-sum')
  await expect(wb.cursor()).toHaveText('3.den @ 3')

  await wb.press('Home')
  await expect(wb.cursor()).toHaveText('root @ 0')

  await wb.press('End')
  await expect(wb.cursor()).toHaveText('root @ 4')
})

test('each line keeps its own cursor', async () => {
  await wb.enterSample('fraction-sum')
  await wb.press('Home')
  await wb.press('ArrowRight', 3)
  await expect(wb.cursor()).toHaveText('2.num @ 0')

  await wb.press('End')
  await wb.press('Enter')
  await wb.enterSample('sin-squared', 1)
  await wb.press('Home')
  await wb.press('ArrowRight', 4) // s, i, n, then into the brackets
  await expect(wb.cursor()).toHaveText('3.body @ 0')

  await wb.focusLine(0)
  await expect(wb.cursor()).toHaveText('root @ 5')
  await wb.focusLine(1)
  await expect(wb.cursor()).toHaveText('3.body @ 0')
})

test('↑ and ↓ move between stacked rows, matching the caret x position', async () => {
  await wb.enterSample('power-over-sum')
  // After the numerator's "1", which sits above the middle of "x+1".
  await wb.clickIn(await wb.atomBox(0, 'r/3.num', 0), 0.9)
  await expect(wb.cursor()).toHaveText('3.num @ 1')

  await wb.press('ArrowDown')
  await expect(wb.cursor()).toHaveText('3.den @ 2')

  await wb.press('ArrowUp')
  await expect(wb.cursor()).toHaveText('3.num @ 1')
})

test('↓ from a nested denominator goes to the outer denominator', async () => {
  await wb.enterSample('nested-fractions')
  await wb.clickIn(await wb.atomBox(0, 'r/0.num/0.den', 0), 0.8)
  await expect(wb.cursor()).toHaveText('0.num › 0.den @ 1')

  await wb.press('ArrowDown')
  await expect(wb.cursor()).toHaveText('0.den @ 0')
})

test('↑/↓ move between an nth root index and its body', async () => {
  await wb.enterSample('roots-abs-derivative')
  await wb.clickIn(await wb.atomBox(0, 'r/2.index', 0), 0.8)
  await expect(wb.cursor()).toHaveText('2.index @ 1')

  await wb.press('ArrowDown')
  await expect(wb.cursor()).toHaveText(/^2\.body @ [01]$/)

  await wb.press('ArrowUp')
  await expect(wb.cursor()).toHaveText(/^2\.index @ [01]$/)
})

test('↑/↓ in a superscript leave the cursor where it is', async () => {
  await wb.enterSample('power-over-sum')
  await wb.press('Home')
  await wb.press('ArrowRight', 2)
  await expect(wb.cursor()).toHaveText('1.sup @ 0')
  await wb.press('ArrowDown')
  await expect(wb.cursor()).toHaveText('1.sup @ 0')
})
