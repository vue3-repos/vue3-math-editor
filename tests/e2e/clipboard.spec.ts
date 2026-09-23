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
const writeClipboard = (text: string) =>
  wb.page.evaluate((value) => navigator.clipboard.writeText(value), text)

test.describe('copy', () => {
  test('puts the selection on the clipboard as LaTeX and leaves the equation alone', async () => {
    await wb.type('1/x')
    await wb.press('ArrowRight')
    await wb.type('+y')
    await wb.press('ControlOrMeta+a')
    await wb.press('ControlOrMeta+c')

    await expect.poll(readClipboard).toBe('\\frac{1}{x}+y')
    await wb.expectMathJson(['Add', ['Divide', 1, 'x'], 'y'])
    await expect(wb.selection()).toHaveText('root 0–3')
  })

  test('with nothing selected, leaves the clipboard alone', async () => {
    await writeClipboard('keep me')
    await wb.type('x+1')
    await wb.press('ControlOrMeta+c')
    await expect.poll(readClipboard).toBe('keep me')
  })
})

test.describe('cut', () => {
  test('removes the selection and puts it on the clipboard', async () => {
    await wb.type('a+b')
    await wb.press('Shift+ArrowLeft', 2)
    await wb.press('ControlOrMeta+x')

    await wb.expectMathJson('a')
    await expect.poll(readClipboard).toBe('+b')
    await expect(wb.selection()).toHaveCount(0)
  })

  test('then paste puts it back', async () => {
    await wb.type('a+b')
    await wb.press('Shift+ArrowLeft', 2)
    await wb.press('ControlOrMeta+x')
    await wb.press('ControlOrMeta+v')
    await wb.expectMathJson(['Add', 'a', 'b'])
  })
})

test.describe('paste', () => {
  test('a copied selection, at the cursor', async () => {
    await wb.type('y=a+b')
    await wb.press('Shift+ArrowLeft', 3)
    await wb.press('ControlOrMeta+c')
    await wb.press('End')
    await wb.type('+')
    await wb.press('ControlOrMeta+v')
    await wb.expectMathJson(['Equal', 'y', ['Add', 'a', 'b', 'a', 'b']])
    await expect(wb.cursor()).toHaveText('root @ 9')
  })

  test('a copied structure into another line', async () => {
    await wb.enterSample('roots-abs-derivative')
    await wb.press('ControlOrMeta+a')
    await wb.press('ControlOrMeta+c')
    await wb.press('End')
    await wb.press('Enter')
    await wb.press('ControlOrMeta+v')
    await expect(wb.lines()).toHaveCount(2)
    await expect.poll(() => wb.shape(1)).toEqual(await wb.shape(0))
  })

  test('LaTeX from another app', async () => {
    await writeClipboard('\\frac{1}{2}+\\sqrt{x}')
    await wb.press('ControlOrMeta+v')
    await wb.expectMathJson(['Add', ['Divide', 1, 2], ['Sqrt', 'x']])
  })

  test('plain text as it would be typed', async () => {
    await writeClipboard('y = (x+1)/2 + sin(x)^2')
    await wb.press('ControlOrMeta+v')
    await wb.expectMathJson([
      'Equal',
      'y',
      ['Add', ['Divide', ['Add', 'x', 1], 2], ['Power', ['Sin', 'x'], 2]],
    ])
  })

  test('replaces the selection', async () => {
    await wb.type('y=a+b')
    await wb.press('Shift+ArrowLeft', 3)
    await writeClipboard('\\sqrt{c}')
    await wb.press('ControlOrMeta+v')
    await wb.expectMathJson(['Equal', 'y', ['Sqrt', 'c']])
  })

  test('inside a structure', async () => {
    await wb.type('1/')
    await writeClipboard('x+1')
    await wb.press('ControlOrMeta+v')
    await wb.expectMathJson(['Divide', 1, ['Add', 'x', 1]])
    await expect(wb.cursor()).toHaveText('0.den @ 3')
  })

  test('is one undo step', async () => {
    await wb.type('y=')
    await writeClipboard('a+b+c')
    await wb.press('ControlOrMeta+v')
    await wb.expectMathJson(['Equal', 'y', ['Add', 'a', 'b', 'c']])
    await wb.press('ControlOrMeta+z')
    await wb.expectMathJson(['Equal', 'y', ['Missing']])
  })
})
