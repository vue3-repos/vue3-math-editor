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

test.describe('scientific numbers', () => {
  test('1e-08 is one number', async () => {
    await wb.type('k=1e-08*V')
    await wb.expectMathJson(['Equal', 'k', ['Multiply', 1e-8, 'V']])
    await expect(wb.page.locator('[data-role="mathml"]')).toContainText(
      '<cn type="e-notation">1<sep/>-8</cn>',
    )
  })

  test('is drawn tight, without operator spacing around the exponent sign', async () => {
    await wb.type('1e-08-x')
    // Atoms: 1 e - 0 8 - x. The exponent's minus sits close to the e; the
    // subtraction has operator spacing.
    const e = await wb.glyphBox(0, 'r', 1)
    const sign = await wb.glyphBox(0, 'r', 2)
    const eight = await wb.glyphBox(0, 'r', 4)
    const minus = await wb.glyphBox(0, 'r', 5)
    expect(sign.left - e.right).toBeLessThan(2)
    expect(minus.left - eight.right).toBeGreaterThan(3)
  })

  test('the cursor moves through it one character at a time', async () => {
    await wb.type('1e-08')
    await wb.press('Home')
    for (let offset = 0; offset <= 5; offset++) {
      await expect(wb.cursor()).toHaveText(`root @ ${offset}`)
      await wb.press('ArrowRight')
    }
  })
})

test.describe('conditions', () => {
  test('comparisons and logic are typed as keys', async () => {
    await wb.type('t>=0&t<1')
    await wb.expectMathJson(['And', ['GreaterEqual', 't', 0], ['Less', 't', 1]])
    await expect(wb.page.locator('[data-role="mathml"]')).toContainText('<geq/>')
    await expect(wb.page.locator('[data-role="latex"]')).toHaveText('t\\geq 0\\land t<1')
  })

  test('!= becomes ≠ and ! alone is ¬', async () => {
    await wb.type('!x!=1')
    await wb.expectMathJson(['Not', ['NotEqual', 'x', 1]])
  })

  test('the toolbar inserts them', async () => {
    await wb.type('a')
    await wb.page.locator('[data-role="condition-buttons"] button[title^="Or"]').click()
    await wb.type('b')
    await wb.expectMathJson(['Or', 'a', 'b'])
  })

  test('a chained comparison is marked', async () => {
    await wb.type('0<x<1')
    await expect(wb.marks()).toHaveCount(1)
    await expect(wb.page.locator('[data-role="diagnostics"]')).toContainText("can't be chained")
  })
})

test.describe('constants and functions', () => {
  test('\\pi, \\e and \\inf insert the constants', async () => {
    await wb.type('A=\\pi r^2')
    await wb.press(' ')
    await wb.type('+\\e ^x')
    await wb.press(' ')
    await wb.type('+\\inf ')
    await wb.expectMathJson([
      'Equal',
      'A',
      [
        'Add',
        ['Multiply', 'Pi', ['Power', 'r', 2]],
        ['Power', 'ExponentialE', 'x'],
        { num: '+Infinity' },
      ],
    ])
    const mathml = wb.page.locator('[data-role="mathml"]')
    for (const tag of ['<pi/>', '<exponentiale/>', '<infinity/>']) {
      await expect(mathml).toContainText(tag)
    }
  })

  test('the toolbar inserts π', async () => {
    await wb.type('2')
    await wb.page.locator('[data-role="constant-buttons"] button[title^="Pi"]').click()
    await wb.expectMathJson(['Multiply', 2, 'Pi'])
  })

  test('floor, ceiling, min, max and rem are functions', async () => {
    await wb.type('floor(x)+max(a,b)+rem(n,2)')
    await wb.expectMathJson(['Add', ['Floor', 'x'], ['Max', 'a', 'b'], ['Remainder', 'n', 2]])
    await expect(wb.page.locator('[data-role="mathml"]')).toContainText('<rem/>')
  })
})
