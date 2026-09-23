import { expect, test } from '@playwright/test'

import { SAMPLES } from '../../src/dev/samples'
import { Playground, expectedStops } from './playground'

let pg: Playground

test.beforeEach(async ({ page }) => {
  pg = new Playground(page)
  await pg.goto()
})

test('the caret only shows while the field has focus', async () => {
  await expect(pg.caret('fraction-sum')).toHaveCount(0)

  await pg.focus('fraction-sum')
  await expect(pg.caret('fraction-sum')).toBeVisible()

  await pg.page.locator('h1').click()
  await expect(pg.caret('fraction-sum')).toHaveCount(0)
})

for (const { id, label } of SAMPLES) {
  test(`${label}: every position shows a caret or an active placeholder inside the field`, async () => {
    await pg.focus(id)
    const field = await pg.fieldBox(id)

    for (const stop of expectedStops(id)) {
      await expect(pg.cursor(id)).toHaveText(stop)
      const caret = await pg.caretBox(id)

      if (caret) {
        expect(caret.left, stop).toBeGreaterThanOrEqual(field.left)
        expect(caret.right, stop).toBeLessThanOrEqual(field.right)
        expect(caret.top, stop).toBeGreaterThanOrEqual(field.top)
        expect(caret.bottom, stop).toBeLessThanOrEqual(field.bottom)
        expect(caret.bottom - caret.top, stop).toBeGreaterThan(10)
      } else {
        await expect(pg.field(id).locator('.me-ph-active'), stop).toHaveCount(1)
      }

      await pg.press('ArrowRight')
    }
  })
}

test('the caret moves left to right along the root row', async () => {
  const id = 'fraction-sum'
  await pg.focus(id)
  const xs: number[] = []

  for (const stop of expectedStops(id).filter((s) => s.startsWith('root'))) {
    // Walk to the stop, stepping over any positions inside the fraction.
    while ((await pg.cursor(id).textContent()) !== stop) await pg.press('ArrowRight')
    xs.push((await pg.caretBox(id))!.left)
  }

  for (let i = 1; i < xs.length; i++) {
    expect(xs[i], `root @ ${i} is right of root @ ${i - 1}`).toBeGreaterThan(xs[i - 1])
  }
})

test('the caret sits between neighbouring glyphs, not on top of them', async () => {
  const id = 'fraction-sum'
  await pg.focus(id)
  await pg.press('ArrowRight') // between "x" and "+"

  const caret = (await pg.caretBox(id))!
  const x = await pg.atomBox(id, 'r', 0)
  const plus = await pg.atomBox(id, 'r', 1)
  const middle = (caret.left + caret.right) / 2

  // The atom boxes include KaTeX's spacing, so compare with some slack.
  expect(middle).toBeGreaterThan(x.left + (x.right - x.left) / 2)
  expect(middle).toBeLessThan(plus.left + (plus.right - plus.left) / 2)
})

test('an empty slot highlights its placeholder instead of drawing a caret', async () => {
  const id = 'empty-slots'
  await pg.focus(id)
  await pg.press('ArrowRight') // into the empty numerator
  await expect(pg.cursor(id)).toHaveText('0.num @ 0')

  await expect(pg.caret(id)).toHaveCount(0)
  const active = pg.field(id).locator('.me-ph-active')
  await expect(active).toHaveCount(1)
  // …and it is the numerator's placeholder, not the denominator's.
  await expect(pg.field(id).locator('[data-row="r/0.num"] .me-ph-active')).toHaveCount(1)

  await pg.press('ArrowRight') // into the empty denominator
  await expect(pg.field(id).locator('[data-row="r/0.den"] .me-ph-active')).toHaveCount(1)
  await expect(active).toHaveCount(1)

  await pg.press('ArrowRight') // out of the fraction: a normal caret again
  await expect(pg.caret(id)).toBeVisible()
  await expect(active).toHaveCount(0)
})

test('the playground shows the parsed MathJSON', async () => {
  await expect(pg.section('fraction-sum').locator('[data-role="mathjson"]')).toHaveText(
    '["Add","x",["Divide",1,2],3]',
  )
})
