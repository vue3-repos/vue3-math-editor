import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

// The part of the equation the cursor is in (under a root, a numerator, an
// exponent) is tinted, so the caret at the end of √(x+1) reads as either still
// under the root or after it.

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

const tint = (line = 0) => wb.line(line).locator('[data-role="active-row"]')

test('under a root the radicand is tinted, and after the root nothing is', async () => {
  await wb.type('y=\\sqrt x+1')
  await expect(tint()).toHaveCount(1)
  const box = await wb.boxOf(tint())
  const caret = await wb.caretBox()
  expect(caret!.left).toBeGreaterThan(box.left)
  expect(caret!.right).toBeLessThan(box.right)

  await wb.press('ArrowRight')
  await expect(wb.cursor()).toHaveText('root @ 3')
  await expect(tint()).toHaveCount(0)
})

test('the tint follows the cursor into a fraction and an exponent', async () => {
  await wb.type('x/2')
  const denominator = await wb.rowBox(0, 'r/0.den')
  const box = await wb.boxOf(tint())
  expect(box.left).toBeLessThanOrEqual(denominator.left)
  expect(box.right).toBeGreaterThanOrEqual(denominator.right)

  await wb.press('ArrowRight')
  await wb.type('+a^n')
  const exponent = await wb.rowBox(0, 'r/3.sup')
  const around = await wb.boxOf(tint())
  expect(around.left).toBeLessThanOrEqual(exponent.left)
  expect(around.bottom).toBeLessThan(denominator.bottom)
})

test('an empty slot shows its placeholder rather than a tint, and a line not being edited has none', async () => {
  await wb.type('x/')
  await expect(tint()).toHaveCount(0)
  await wb.type('2')
  await expect(tint()).toHaveCount(1)
  await wb.blur()
  await expect(tint()).toHaveCount(0)
})
