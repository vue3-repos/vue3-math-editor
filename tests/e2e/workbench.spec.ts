import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

test.describe('typing builds the equation', () => {
  const cases: Array<[string, unknown]> = [
    ['2x+1', ['Add', ['Multiply', 2, 'x'], 1]],
    ['4t-3', ['Subtract', ['Multiply', 4, 't'], 3]],
    ['x^2 +1', ['Add', ['Power', 'x', 2], 1]],
    ['sin(x)', ['Sin', 'x']],
    ['(x+1)/2', ['Divide', ['Add', 'x', 1], 2]],
    ['(x+1)^2', ['Power', ['Add', 'x', 1], 2]],
    ['|x|+1', ['Add', ['Abs', 'x'], 1]],
    [
      'y=3x^2 -x+1',
      ['Equal', 'y', ['Add', ['Subtract', ['Multiply', 3, ['Power', 'x', 2]], 'x'], 1]],
    ],
    ['log(x,2)', ['Log', 'x', 2]],
  ]

  for (const [keys, expected] of cases) {
    test(JSON.stringify(keys), async () => {
      await wb.type(keys)
      await wb.expectMathJson(expected)
    })
  }

  test('→ leaves a denominator so typing continues outside it', async () => {
    await wb.type('1/x')
    await expect(wb.cursor()).toHaveText('0.den @ 1')
    await wb.press('ArrowRight')
    await wb.type('+1')
    await wb.expectMathJson(['Add', ['Divide', 1, 'x'], 1])
    await expect(wb.cursor()).toHaveText('root @ 3')
  })

  test('the caret follows the typing', async () => {
    await wb.type('x+1')
    await expect(wb.cursor()).toHaveText('root @ 3')
    await expect(wb.line(0).locator('.caret')).toBeVisible()
  })
})

test.describe('editing in place', () => {
  test('clicking places the cursor for the next key press', async () => {
    await wb.type('x+1')
    const x = await wb.atomBox(0, 'r', 0)
    await wb.page.mouse.click(x.left + 1, (x.top + x.bottom) / 2)
    await expect(wb.cursor()).toHaveText('root @ 0')
    await wb.type('2')
    await wb.expectMathJson(['Add', ['Multiply', 2, 'x'], 1])
  })

  test('Backspace deletes, and steps through structures', async () => {
    await wb.type('12')
    await wb.press('Backspace')
    await wb.expectMathJson(1)

    await wb.type('/3 ')
    await wb.expectMathJson(['Divide', 1, 3])
    await wb.press('Backspace') // into the denominator
    await expect(wb.cursor()).toHaveText('0.den @ 1')
    await wb.press('Backspace', 3) // "3", then to the numerator, then "1"
    await wb.press('Backspace') // the now-empty fraction
    await expect.poll(() => wb.mathJson()).toBeNull()
  })

  test('Delete removes the symbol after the cursor', async () => {
    await wb.type('ab')
    await wb.press('Home')
    await wb.press('Delete')
    await wb.expectMathJson('b')
  })

  test('Tab jumps to the next empty slot', async () => {
    await wb.type('/')
    await expect(wb.cursor()).toHaveText('0.num @ 0')
    await wb.press('Tab')
    await expect(wb.cursor()).toHaveText('0.den @ 0')
    await wb.type('2')
    await wb.press('Shift+Tab')
    await expect(wb.cursor()).toHaveText('0.num @ 0')
  })

  test('↑/↓ move between numerator and denominator', async () => {
    await wb.type('12/3')
    await wb.press('ArrowUp')
    await expect(wb.cursor()).toHaveText(/^0\.num @ \d$/)
    await wb.press('ArrowDown')
    await expect(wb.cursor()).toHaveText(/^0\.den @ \d$/)
  })
})

test.describe('commands', () => {
  test('\\sqrt opens a square root', async () => {
    await wb.type('\\sqrt')
    await expect(wb.page.locator('[data-role="command"]')).toHaveText('\\sqrt')
    await wb.press('Space')
    await expect(wb.page.locator('[data-role="command"]')).toHaveCount(0)
    await wb.type('x')
    await wb.expectMathJson(['Sqrt', 'x'])
  })

  test('\\alpha inserts a named symbol', async () => {
    await wb.type('\\alpha')
    await wb.press('Enter')
    await wb.type('+1')
    await wb.expectMathJson(['Add', 'alpha', 1])
  })

  test('Escape cancels a command', async () => {
    await wb.type('\\fr')
    await wb.press('Escape')
    await expect(wb.page.locator('[data-role="command"]')).toHaveCount(0)
    await expect.poll(() => wb.mathJson()).toBeNull()
  })

  test('toolbar buttons act at the cursor and keep focus', async () => {
    await wb.type('x')
    await wb.page.getByTitle('Fraction  ( / )').click()
    await expect(wb.line(0)).toBeFocused()
    await wb.type('2')
    await wb.expectMathJson(['Divide', 'x', 2])
  })
})

test.describe('undo and redo', () => {
  test('undo and redo each edit', async () => {
    await wb.type('ab')
    await wb.press('ControlOrMeta+z')
    await wb.expectMathJson('a')
    await wb.press('ControlOrMeta+Shift+z')
    await wb.expectMathJson('ab')
  })
})

test.describe('lines', () => {
  test('Enter adds a line, ↑/↓ move between lines, Backspace removes an empty one', async () => {
    await wb.type('x=1')
    await wb.press('Enter')
    await expect(wb.lines()).toHaveCount(2)
    await expect(wb.line(1)).toBeFocused()

    await wb.type('y=2')
    await wb.expectMathJson(['Equal', 'y', 2])

    await wb.press('ArrowUp')
    await expect(wb.line(0)).toBeFocused()
    await wb.expectMathJson(['Equal', 'x', 1])

    await wb.press('ArrowDown')
    await expect(wb.line(1)).toBeFocused()
    await wb.press('Backspace', 3)
    await expect.poll(() => wb.mathJson()).toBeNull()
    await wb.press('Backspace')
    await expect(wb.lines()).toHaveCount(1)
    await expect(wb.line(0)).toBeFocused()
    await expect(wb.cursor()).toHaveText('root @ 3')
  })
})

test.describe('names', () => {
  test('letters, digits and underscores without an operator form one name', async () => {
    await wb.type('Vm_init=2Vm')
    await wb.expectMathJson(['Equal', 'Vm_init', ['Multiply', 2, 'Vm']])
  })

  test('* multiplies names, shown as a dot', async () => {
    await wb.type('a*b')
    await wb.expectMathJson(['Multiply', 'a', 'b'])
  })

  test('a function spelling is a function; a longer name is not', async () => {
    await wb.type('cost+sin(t)')
    await wb.expectMathJson(['Add', 'cost', ['Sin', 't']])
  })

  test('the cursor moves through a name one character at a time', async () => {
    await wb.type('Vm_init')
    await wb.press('Home')
    await wb.press('ArrowRight', 2)
    await wb.type('x')
    await wb.expectMathJson('Vmx_init')
  })

  test('an exponent applies to the whole name', async () => {
    await wb.type('Vm^2')
    await wb.expectMathJson(['Power', 'Vm', 2])
  })
})

test('stray input is reported, not lost', async () => {
  await wb.type('1,2')
  await expect(wb.page.locator('[data-role="diagnostics"]')).toContainText('Unexpected ","')
  await wb.press('Backspace', 2)
  await expect(wb.page.locator('[data-role="diagnostics"]')).toHaveCount(0)
})
