import { expect, test } from '@playwright/test'

import { SAMPLES, expectedStops } from './samples'
import { Workbench } from './workbench'

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

test('the caret only shows while the line has focus', async () => {
  await wb.type('x+1')
  await expect(wb.caret(0)).toBeVisible()

  await wb.blur()
  await expect(wb.caret(0)).toHaveCount(0)

  await wb.focusLine(0)
  await expect(wb.caret(0)).toBeVisible()
})

for (const { id, label } of SAMPLES) {
  test(`${label}: every position shows a caret or an active placeholder inside the field`, async () => {
    await wb.enterSample(id)
    await wb.press('Home')
    const field = await wb.fieldBox(0)

    for (const stop of expectedStops(id)) {
      await expect(wb.cursor()).toHaveText(stop)
      const caret = await wb.caretBox(0)

      if (caret) {
        expect(caret.left, stop).toBeGreaterThanOrEqual(field.left)
        expect(caret.right, stop).toBeLessThanOrEqual(field.right)
        expect(caret.top, stop).toBeGreaterThanOrEqual(field.top)
        expect(caret.bottom, stop).toBeLessThanOrEqual(field.bottom)
        expect(caret.bottom - caret.top, stop).toBeGreaterThan(10)
      } else {
        await expect(wb.line(0).locator('.me-ph-active'), stop).toHaveCount(1)
      }

      await wb.press('ArrowRight')
    }
  })
}

test('the caret moves left to right along the root row', async () => {
  const id = 'fraction-sum'
  await wb.enterSample(id)
  await wb.press('Home')
  const xs: number[] = []

  for (const stop of expectedStops(id).filter((s) => s.startsWith('root'))) {
    // Walk to the stop, stepping over any positions inside the fraction.
    while ((await wb.cursor().textContent()) !== stop) await wb.press('ArrowRight')
    xs.push((await wb.caretBox(0))!.left)
  }

  for (let i = 1; i < xs.length; i++) {
    expect(xs[i], `root @ ${i} is right of root @ ${i - 1}`).toBeGreaterThan(xs[i - 1])
  }
})

test('the caret sits between neighbouring glyphs, not on top of them', async () => {
  await wb.enterSample('fraction-sum')
  await wb.press('Home')
  await wb.press('ArrowRight') // between "x" and "+"

  const caret = (await wb.caretBox(0))!
  const x = await wb.atomBox(0, 'r', 0)
  const plus = await wb.atomBox(0, 'r', 1)
  const middle = (caret.left + caret.right) / 2

  // The atom boxes include KaTeX's spacing, so compare with some slack.
  expect(middle).toBeGreaterThan(x.left + (x.right - x.left) / 2)
  expect(middle).toBeLessThan(plus.left + (plus.right - plus.left) / 2)
})

test('an empty slot highlights its placeholder instead of drawing a caret', async () => {
  await wb.type('/')
  await expect(wb.cursor()).toHaveText('0.num @ 0')

  await expect(wb.caret(0)).toHaveCount(0)
  const active = wb.line(0).locator('.me-ph-active')
  await expect(active).toHaveCount(1)
  // …and it is the numerator's placeholder, not the denominator's.
  await expect(wb.line(0).locator('[data-row="r/0.num"] .me-ph-active')).toHaveCount(1)

  await wb.press('ArrowRight') // into the empty denominator
  await expect(wb.line(0).locator('[data-row="r/0.den"] .me-ph-active')).toHaveCount(1)
  await expect(active).toHaveCount(1)

  await wb.press('ArrowRight') // out of the fraction: a normal caret again
  await expect(wb.caret(0)).toBeVisible()
  await expect(active).toHaveCount(0)
})
