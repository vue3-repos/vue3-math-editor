import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

test.describe('clicking places the cursor at the nearest gap', () => {
  test('right half of the last digit in a denominator', async () => {
    await wb.enterSample('power-over-sum')
    await wb.press('Home')
    await wb.clickIn(await wb.atomBox(0, 'r/3.den', 2), 0.8)
    await expect(wb.cursor()).toHaveText('3.den @ 3')
  })

  test('left half of a numerator', async () => {
    await wb.enterSample('power-over-sum')
    await wb.clickIn(await wb.atomBox(0, 'r/3.num', 0), 0.2)
    await expect(wb.cursor()).toHaveText('3.num @ 0')
  })

  test('right half of an exponent', async () => {
    await wb.enterSample('power-over-sum')
    await wb.clickIn(await wb.atomBox(0, 'r/1.sup', 0), 0.8)
    await expect(wb.cursor()).toHaveText('1.sup @ 1')
  })

  test('left half of the first symbol', async () => {
    await wb.enterSample('power-over-sum')
    await wb.clickIn(await wb.atomBox(0, 'r', 0), 0.3)
    await expect(wb.cursor()).toHaveText('root @ 0')
  })

  test('empty space after the equation goes to the end', async () => {
    await wb.enterSample('power-over-sum')
    const field = await wb.fieldBox(0)
    await wb.page.mouse.click(field.right - 10, (field.top + field.bottom) / 2)
    await expect(wb.cursor()).toHaveText('root @ 4')
  })

  test('a fraction bar right of centre goes to just after the fraction', async () => {
    await wb.enterSample('fraction-sum')
    await wb.clickIn(await wb.atomBox(0, 'r', 2, '.frac-line'), 0.85)
    await expect(wb.cursor()).toHaveText('root @ 3')
  })

  test('a fraction bar left of centre goes to just before the fraction', async () => {
    await wb.enterSample('fraction-sum')
    await wb.clickIn(await wb.atomBox(0, 'r', 2, '.frac-line'), 0.15)
    await expect(wb.cursor()).toHaveText('root @ 2')
  })

  test('an empty placeholder', async () => {
    await wb.enterSample('empty-slots')
    await wb.clickIn(await wb.rowBox(0, 'r/0.num'), 0.5)
    await expect(wb.cursor()).toHaveText('0.num @ 0')
  })

  test('inside a nested fraction', async () => {
    await wb.enterSample('nested-fractions')
    await wb.clickIn(await wb.atomBox(0, 'r/0.num/0.den', 0), 0.8)
    await expect(wb.cursor()).toHaveText('0.num › 0.den @ 1')
  })

  test('inside a function argument', async () => {
    await wb.enterSample('sin-squared')
    await wb.clickIn(await wb.atomBox(0, 'r/3.body', 0), 0.8)
    await expect(wb.cursor()).toHaveText('3.body @ 1')
  })
})

test('clicking an unfocused line focuses it and shows the caret', async () => {
  await wb.enterSample('fraction-sum')
  await wb.blur()
  await expect(wb.caret(0)).toHaveCount(0)

  await wb.clickIn(await wb.atomBox(0, 'r', 0), 0.8)
  await expect(wb.line(0)).toBeFocused()
  await expect(wb.caret(0)).toBeVisible()
  await expect(wb.cursor()).toHaveText('root @ 1')
})
