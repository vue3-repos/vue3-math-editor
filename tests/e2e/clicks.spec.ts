import { expect, test } from '@playwright/test'

import { Playground } from './playground'

let pg: Playground

test.beforeEach(async ({ page }) => {
  pg = new Playground(page)
  await pg.goto()
})

test.describe('clicking places the cursor at the nearest gap', () => {
  test('right half of the last digit in a denominator', async () => {
    await pg.clickIn(await pg.atomBox('power-over-sum', 'r/3.den', 2), 0.8)
    await expect(pg.cursor('power-over-sum')).toHaveText('3.den @ 3')
  })

  test('left half of a numerator', async () => {
    await pg.clickIn(await pg.atomBox('power-over-sum', 'r/3.num', 0), 0.2)
    await expect(pg.cursor('power-over-sum')).toHaveText('3.num @ 0')
  })

  test('right half of an exponent', async () => {
    await pg.clickIn(await pg.atomBox('power-over-sum', 'r/1.sup', 0), 0.8)
    await expect(pg.cursor('power-over-sum')).toHaveText('1.sup @ 1')
  })

  test('left half of the first symbol', async () => {
    await pg.clickIn(await pg.atomBox('power-over-sum', 'r', 0), 0.3)
    await expect(pg.cursor('power-over-sum')).toHaveText('root @ 0')
  })

  test('empty space after the equation goes to the end', async () => {
    const field = await pg.fieldBox('power-over-sum')
    await pg.page.mouse.click(field.right - 10, (field.top + field.bottom) / 2)
    await expect(pg.cursor('power-over-sum')).toHaveText('root @ 4')
  })

  test('a fraction bar right of centre goes to just after the fraction', async () => {
    await pg.clickIn(await pg.atomBox('fraction-sum', 'r', 2, '.frac-line'), 0.85)
    await expect(pg.cursor('fraction-sum')).toHaveText('root @ 3')
  })

  test('a fraction bar left of centre goes to just before the fraction', async () => {
    await pg.clickIn(await pg.atomBox('fraction-sum', 'r', 2, '.frac-line'), 0.15)
    await expect(pg.cursor('fraction-sum')).toHaveText('root @ 2')
  })

  test('an empty placeholder', async () => {
    await pg.clickIn(await pg.rowBox('empty-slots', 'r/0.num'), 0.5)
    await expect(pg.cursor('empty-slots')).toHaveText('0.num @ 0')
  })

  test('inside a nested fraction', async () => {
    await pg.clickIn(await pg.atomBox('nested-fractions', 'r/0.num/0.den', 0), 0.8)
    await expect(pg.cursor('nested-fractions')).toHaveText('0.num › 0.den @ 1')
  })

  test('inside a function argument', async () => {
    await pg.clickIn(await pg.atomBox('sin-squared', 'r/1.body', 0), 0.8)
    await expect(pg.cursor('sin-squared')).toHaveText('1.body @ 1')
  })
})

test('clicking focuses the field and shows the caret', async () => {
  await expect(pg.caret('fraction-sum')).toHaveCount(0)
  await pg.clickIn(await pg.atomBox('fraction-sum', 'r', 0), 0.8)
  await expect(pg.field('fraction-sum')).toBeFocused()
  await expect(pg.caret('fraction-sum')).toBeVisible()
})
