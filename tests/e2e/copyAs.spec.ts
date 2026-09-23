import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

const readClipboard = () => wb.page.evaluate(() => navigator.clipboard.readText())
const button = () => wb.page.locator('[data-role="copy-as"]')

async function copyAs(label: string) {
  await button().click()
  await wb.page.getByRole('menuitem', { name: label }).click()
}

test('is disabled for an empty equation', async () => {
  await expect(button()).toBeDisabled()
  await wb.type('x')
  await expect(button()).toBeEnabled()
})

test('copies the whole equation as MathJSON', async () => {
  await wb.type('y=1/x')
  await wb.press('ArrowRight')
  await wb.type('+1')
  await copyAs('MathJSON')

  await expect
    .poll(async () => JSON.parse(await readClipboard()))
    .toEqual(['Equal', 'y', ['Add', ['Divide', 1, 'x'], 1]])
  await expect(button()).toContainText('Copied MathJSON')
  await expect(wb.line(0)).toBeFocused()
})

test('copies the whole equation as Content MathML', async () => {
  await wb.type('x+1')
  await copyAs('Content MathML')

  await expect
    .poll(readClipboard)
    .toBe(
      [
        '<math xmlns="http://www.w3.org/1998/Math/MathML">',
        '  <apply>',
        '    <plus/>',
        '    <ci>x</ci>',
        '    <cn>1</cn>',
        '  </apply>',
        '</math>',
      ].join('\n'),
    )
})

test('copies as LaTeX, which pastes back', async () => {
  await wb.enterSample('roots-abs-derivative')
  await copyAs('LaTeX')
  await expect
    .poll(readClipboard)
    .toBe('\\sqrt{x+1}+\\sqrt[3]{y}-\\left|z\\right|=\\frac{\\mathrm{d}f}{\\mathrm{d}t}')

  const shape = await wb.shape(0)
  await wb.press('End')
  await wb.press('Enter')
  await wb.press('ControlOrMeta+v')
  await expect.poll(() => wb.shape(1)).toEqual(shape)
})

test('with a selection, copies just the selection and keeps it selected', async () => {
  await wb.type('y=a+b')
  await wb.press('Shift+ArrowLeft', 3)
  await expect(button()).toContainText('Copy selection as')

  await copyAs('MathJSON')
  await expect.poll(async () => JSON.parse(await readClipboard())).toEqual(['Add', 'a', 'b'])
  await expect(wb.line(0)).toBeFocused()
  await expect(wb.selection()).toHaveText('root 2–5')

  await copyAs('Content MathML')
  await expect.poll(readClipboard).toContain('<plus/>')
  await expect.poll(readClipboard).not.toContain('<eq/>')
})

test('the MathML panel shows the same document', async () => {
  await wb.type('x+1')
  await expect(wb.page.locator('[data-role="mathml"]')).toContainText(
    '<math xmlns="http://www.w3.org/1998/Math/MathML">',
  )
})

test.describe('CellML mode', () => {
  test.beforeEach(async () => {
    await wb.goto('/?cellml')
    await wb.focusLine(0)
  })

  test('the Content MathML panel is CellML-ready', async () => {
    await wb.type('y=2x')
    await expect(wb.page.locator('[data-role="cellml-mode"]')).toBeVisible()
    const panel = wb.page.locator('[data-role="mathml"]')
    await expect(panel).toContainText('xmlns:cellml="http://www.cellml.org/cellml/2.0#"')
    await expect(panel).toContainText('<cn cellml:units="undefined">2</cn>')
  })

  test('copies CellML-ready Content MathML', async () => {
    await wb.type('y=2x')
    await copyAs('Content MathML (CellML)')
    await expect.poll(readClipboard).toContain('<cn cellml:units="undefined">2</cn>')
    await expect.poll(readClipboard).toContain('xmlns:cellml="http://www.cellml.org/cellml/2.0#"')
  })
})

test('without CellML mode, Content MathML has no CellML markup', async () => {
  await wb.type('y=2x')
  await expect(wb.page.locator('[data-role="cellml-mode"]')).toHaveCount(0)
  await expect(wb.page.locator('[data-role="mathml"]')).toContainText('<cn>2</cn>')
  await expect(wb.page.locator('[data-role="mathml"]')).not.toContainText('cellml')
})

test('the LaTeX panel shows the same LaTeX as copying', async () => {
  const panel = wb.page.locator('[data-role="latex"]')
  await expect(panel).toHaveText('')

  await wb.type('Vm_init=2Vm*sin(t)')
  await wb.press('End')
  await wb.type('+1/x')
  const expected = '\\mathit{Vm\\_init}=2\\mathit{Vm}\\cdot \\sin \\left(t\\right)+\\frac{1}{x}'
  await expect(panel).toHaveText(expected)

  await copyAs('LaTeX')
  await expect.poll(readClipboard).toBe(expected)
})
