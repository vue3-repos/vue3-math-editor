import { expect, test } from '@playwright/test'

import { type Box, Workbench } from './workbench'

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

const centre = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 })

// An atom's element box can include the operator spacing after it, so check
// the mark reaches the atom's centre rather than its right edge.
function expectCovers(outer: Box, inner: Box) {
  expect(outer.left).toBeLessThanOrEqual(inner.left + 1)
  expect(outer.right).toBeGreaterThanOrEqual(centre(inner).x)
}

test('a parser diagnostic is underlined on the atom it is about', async () => {
  await wb.type('1,2')
  await expect(wb.marks()).toHaveCount(1)

  const mark = await wb.boxOf(wb.marks())
  const comma = await wb.atomBox(0, 'r', 1)
  expectCovers(mark, comma)
  // Only the comma, not its neighbours.
  expect(mark.left).toBeGreaterThan((await wb.atomBox(0, 'r', 0)).left)
  expect(mark.right).toBeLessThan((await wb.atomBox(0, 'r', 2)).right)
  await expect(wb.line(0)).toHaveAttribute('aria-invalid', 'true')

  await wb.press('Backspace', 2)
  await expect(wb.marks()).toHaveCount(0)
  await expect(wb.line(0)).not.toHaveAttribute('aria-invalid')
})

test('a malformed number is underlined as a whole', async () => {
  await wb.type('1.2.3+x')
  await expect(wb.marks()).toHaveCount(1)

  const mark = await wb.boxOf(wb.marks())
  expectCovers(mark, await wb.atomBox(0, 'r', 0))
  expectCovers(mark, await wb.atomBox(0, 'r', 4))
  expect(mark.right).toBeLessThan((await wb.atomBox(0, 'r', 5)).right)
})

test('a problem inside a structure is underlined there', async () => {
  await wb.type('x=(1,2')
  await expect(wb.marks()).toHaveCount(1)
  expectCovers(await wb.boxOf(wb.marks()), await wb.atomBox(0, 'r/2.body', 1))
})

test('hovering a mark shows its message', async () => {
  await wb.type('x+1,2')
  const mark = centre(await wb.boxOf(wb.marks()))

  await expect(wb.markTip()).toHaveCount(0)
  await wb.page.mouse.move(mark.x, mark.y)
  await expect(wb.markTip()).toHaveText('Unexpected ","')

  const x = centre(await wb.atomBox(0, 'r', 0))
  await wb.page.mouse.move(x.x, x.y)
  await expect(wb.markTip()).toHaveCount(0)
})

test('every line shows its own marks, not just the active one', async () => {
  await wb.type('1,2')
  await wb.press('Enter')
  await wb.type('x+1')

  await expect(wb.marks(0)).toHaveCount(1)
  await expect(wb.marks(1)).toHaveCount(0)
  // The diagnostics list is for the active line.
  await expect(wb.page.locator('[data-role="diagnostics"]')).toHaveCount(0)
})
