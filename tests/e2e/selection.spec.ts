import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

// "y=a+b" with "a+b" selected by keyboard: root atoms y = a + b, so 2–5.
async function selectAPlusB() {
  await wb.type('y=a+b')
  await wb.press('Shift+ArrowLeft', 3)
  await expect(wb.selection()).toHaveText('root 2–5')
}

test.describe('selecting', () => {
  test('Shift+← selects, shows a highlight and hides the caret', async () => {
    await selectAPlusB()
    await expect(wb.selectionHighlight()).toBeVisible()
    await expect(wb.caret()).toHaveCount(0)

    // The highlight covers the selected glyphs.
    const box = (await wb.selectionHighlight().boundingBox())!
    const a = await wb.atomBox(0, 'r', 2)
    const b = await wb.atomBox(0, 'r', 4)
    expect(box.x).toBeLessThanOrEqual(a.left + 1)
    expect(box.x + box.width).toBeGreaterThanOrEqual(b.right - 1)
  })

  test('Shift+→ takes a fraction whole', async () => {
    await wb.enterSample('fraction-sum')
    await wb.press('Home')
    await wb.press('ArrowRight', 2)
    await wb.press('Shift+ArrowRight')
    await expect(wb.selection()).toHaveText('root 2–3')
  })

  test('dragging selects', async () => {
    await wb.type('y=a+b')
    const a = await wb.atomBox(0, 'r', 2)
    const b = await wb.atomBox(0, 'r', 4)
    await wb.drag(wb.pointIn(a, 0.2), wb.pointIn(b, 0.9))
    await expect(wb.selection()).toHaveText('root 2–5')
  })

  test('dragging out of a numerator selects the whole fraction', async () => {
    await wb.enterSample('fraction-sum')
    const numerator = await wb.atomBox(0, 'r/2.num', 0)
    const field = await wb.fieldBox(0)
    await wb.drag(wb.pointIn(numerator, 0.5), {
      x: field.right - 10,
      y: (field.top + field.bottom) / 2,
    })
    await expect(wb.selection()).toHaveText('root 2–5')
  })

  test('Shift+click extends from the cursor', async () => {
    await wb.type('y=a+b')
    await wb.clickIn(await wb.atomBox(0, 'r', 2), 0.1)
    await expect(wb.cursor()).toHaveText('root @ 2')
    await wb.clickIn(await wb.atomBox(0, 'r', 4), 0.9, 0.5, { shift: true })
    await expect(wb.selection()).toHaveText('root 2–5')
  })

  test('select all, then Backspace clears the line', async () => {
    await wb.type('1/x')
    await wb.press('ControlOrMeta+a')
    await expect(wb.selection()).toHaveText('root 0–1')
    await wb.press('Backspace')
    await expect.poll(() => wb.mathJson()).toBeNull()
  })

  test('← collapses to the start, Escape clears where the cursor is', async () => {
    await selectAPlusB()
    await wb.press('ArrowLeft')
    await expect(wb.selection()).toHaveCount(0)
    await expect(wb.cursor()).toHaveText('root @ 2')

    await wb.press('End')
    await wb.press('Shift+ArrowLeft')
    await wb.press('Escape')
    await expect(wb.selection()).toHaveCount(0)
    await expect(wb.cursor()).toHaveText('root @ 4')
  })
})

test.describe('acting on the selection', () => {
  test('/ makes it the numerator', async () => {
    await selectAPlusB()
    await wb.type('/2')
    await wb.expectMathJson(['Equal', 'y', ['Divide', ['Add', 'a', 'b'], 2]])
  })

  test('the toolbar square root wraps it', async () => {
    await selectAPlusB()
    await wb.page.getByTitle('Square root  ( \\sqrt )').click()
    await expect(wb.line(0)).toBeFocused()
    await wb.expectMathJson(['Equal', 'y', ['Sqrt', ['Add', 'a', 'b']]])
  })

  test('\\sin makes it the argument', async () => {
    await selectAPlusB()
    await wb.type('\\sin ')
    await wb.expectMathJson(['Equal', 'y', ['Sin', ['Add', 'a', 'b']]])
  })

  test('^ brackets it and adds an exponent', async () => {
    await selectAPlusB()
    await wb.type('^2')
    await wb.expectMathJson(['Equal', 'y', ['Power', ['Add', 'a', 'b'], 2]])
  })

  test('( brackets it', async () => {
    await selectAPlusB()
    await wb.type('(')
    await wb.type('c')
    await wb.expectMathJson(['Equal', 'y', ['Multiply', ['Add', 'a', 'b'], 'c']])
  })

  test('typing replaces it', async () => {
    await selectAPlusB()
    await wb.type('c')
    await wb.expectMathJson(['Equal', 'y', 'c'])
  })

  test('undo brings back the selection as well as the content', async () => {
    await selectAPlusB()
    await wb.type('/')
    await wb.press('ControlOrMeta+z')
    await wb.expectMathJson(['Equal', 'y', ['Add', 'a', 'b']])
    await expect(wb.selection()).toHaveText('root 2–5')
  })
})
