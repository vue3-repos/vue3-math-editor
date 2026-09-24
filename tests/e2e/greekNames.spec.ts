import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

// Names that are Greek letters' names are drawn as the letters, however they
// were typed; the demo's checkbox is the workbench's greekNames prop.

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

const text = (line = 0) => wb.line(line).locator('.katex-html').innerText()

test('a typed Greek word stays spelled out while typed, then becomes the letter', async () => {
  await wb.type('tau_m')
  expect(await text()).toContain('tau')
  await wb.type('=1')
  await expect.poll(text).toContain('τ')
  expect(await text()).not.toContain('tau')
  await wb.expectMathJson(['Equal', 'tau_m', 1])
})

test('\\alpha and alpha are the same variable, drawn the same', async () => {
  await wb.type('\\alpha')
  await wb.press('Space')
  await wb.type('_m+alpha_m')
  await wb.press('Enter')
  await expect.poll(() => text(0)).toMatch(/α_m\s*\+\s*α_m/)
  await expect(wb.page.locator('[data-role="variables"] tr[data-variable="alpha_m"]')).toHaveCount(
    1,
  )
})

test('the caret steps back over the letter as one, and Backspace deletes it', async () => {
  await wb.type('tau_m=1')
  await wb.press('ArrowLeft', 4)
  await expect(wb.cursor()).toHaveText('root @ 1')
  await wb.press('ArrowLeft')
  await expect(wb.cursor()).toHaveText('root @ 0')
  const caret = await wb.caretBox(0)
  const field = await wb.fieldBox(0)
  expect(caret!.left).toBeGreaterThanOrEqual(field.left)

  await wb.press('ArrowRight')
  await wb.press('Backspace')
  await expect.poll(() => text()).not.toContain('τ')
  expect(await text()).toContain('_m')
})

test('pi typed out is the constant π', async () => {
  await wb.type('A=pi*r^2')
  await wb.expectMathJson(['Equal', 'A', ['Multiply', 'Pi', ['Power', 'r', 2]]])
  await expect.poll(() => text()).toContain('π')
})

test('with Greek names off, letters are spelled out, and turning them on draws them', async () => {
  await wb.type('\\alpha')
  await wb.press('Space')
  await wb.type('=beta_2')
  await wb.press('Enter')
  const toggle = wb.page.locator('[data-role="greek-names"]')
  await toggle.uncheck()
  await expect.poll(() => text(0)).toContain('alpha')
  expect(await text(0)).toContain('beta_2')
  await toggle.check()
  await expect.poll(() => text(0)).toMatch(/α\s*=\s*β_2/)
})
