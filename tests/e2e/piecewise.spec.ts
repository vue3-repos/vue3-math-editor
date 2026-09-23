import { expect, test } from '@playwright/test'

import { type Box, Workbench } from './workbench'

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

const inside = (outer: Box, inner: Box, slack = 2) => {
  expect(inner.left).toBeGreaterThanOrEqual(outer.left - slack)
  expect(inner.right).toBeLessThanOrEqual(outer.right + slack)
  expect(inner.top).toBeGreaterThanOrEqual(outer.top - slack)
  expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + slack)
}

test('the toolbar inserts a piecewise with the cursor in the first value', async () => {
  await wb.type('y=')
  await wb.page.locator('button[title^="Piecewise"]').click()
  await expect(wb.cursor()).toHaveText('2.value0 @ 0')
  await expect(wb.line(0)).toBeFocused()
  // The first value and condition are empty slots; otherwise holds 0.0.
  await expect(wb.line(0).locator('.me-ph')).toHaveCount(2)
  await expect(wb.line(0)).toContainText('otherwise')
})

test.describe('clicking', () => {
  test.beforeEach(async () => {
    await wb.enterSample('piecewise')
  })

  test('in a value, a condition and otherwise places the cursor there', async () => {
    await wb.clickIn(await wb.atomBox(0, 'r/2.value0', 0), 0.8)
    await expect(wb.cursor()).toHaveText('2.value0 @ 1')

    await wb.clickIn(await wb.atomBox(0, 'r/2.cond0', 0), 0.2)
    await expect(wb.cursor()).toHaveText('2.cond0 @ 0')

    await wb.clickIn(await wb.atomBox(0, 'r/2.cond0', 2), 0.8)
    await expect(wb.cursor()).toHaveText('2.cond0 @ 3')

    await wb.clickIn(await wb.atomBox(0, 'r/2.otherwise', 2), 0.8)
    await expect(wb.cursor()).toHaveText('2.otherwise @ 3')
  })

  test('an empty slot', async () => {
    await wb.press('End')
    await wb.press('Enter')
    await wb.page.locator('button[title^="Piecewise"]').click()
    await wb.clickIn(await wb.rowBox(1, 'r/0.cond0'), 0.5)
    await expect(wb.cursor()).toHaveText('0.cond0 @ 0')
  })

  test('space right of it goes after the piecewise', async () => {
    const field = await wb.fieldBox(0)
    const piece = await wb.rowBox(0, 'r/2.otherwise')
    await wb.page.mouse.click(field.right - 10, (piece.top + piece.bottom) / 2)
    await expect(wb.cursor()).toHaveText('root @ 3')
  })
})

test('the caret sits inside the row it is in', async () => {
  await wb.enterSample('piecewise')
  for (const path of ['r/2.value0', 'r/2.cond0', 'r/2.otherwise']) {
    await wb.clickIn(await wb.atomBox(0, path, 0), 0.8)
    const caret = (await wb.caretBox(0))!
    inside(await wb.rowBox(0, path), caret, 4)
    expect(caret.bottom - caret.top).toBeGreaterThan(10)
  }
})

test('↑/↓ move between a value and otherwise, and a condition and otherwise', async () => {
  await wb.enterSample('piecewise')
  await wb.clickIn(await wb.atomBox(0, 'r/2.value0', 0), 0.8)
  await wb.press('ArrowDown')
  await expect(wb.cursor()).toHaveText(/^2\.otherwise @ [0-3]$/)
  await wb.press('ArrowUp')
  await expect(wb.cursor()).toHaveText(/^2\.value0 @ [01]$/)

  await wb.clickIn(await wb.atomBox(0, 'r/2.cond0', 0), 0.2)
  await wb.press('ArrowDown')
  await expect(wb.cursor()).toHaveText(/^2\.otherwise @ [0-3]$/)
})

test('the rows are laid out as cases: values left of conditions, pieces stacked', async () => {
  await wb.enterSample('piecewise')
  const value = await wb.rowBox(0, 'r/2.value0')
  const condition = await wb.rowBox(0, 'r/2.cond0')
  const otherwise = await wb.rowBox(0, 'r/2.otherwise')
  expect(condition.left).toBeGreaterThan(value.right)
  expect(otherwise.top).toBeGreaterThan(value.bottom - 2)
  expect(Math.abs(otherwise.left - value.left)).toBeLessThan(2)
})
