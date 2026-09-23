import { expect, test } from '@playwright/test'

import { SAMPLES } from '../../src/dev/samples'
import { Playground, expectedStops } from './playground'

let pg: Playground

test.beforeEach(async ({ page }) => {
  pg = new Playground(page)
  await pg.goto()
})

for (const { id, label } of SAMPLES) {
  test.describe(label, () => {
    test('→ visits every position in order and stops at the end', async () => {
      const stops = expectedStops(id)
      await pg.focus(id)

      for (const stop of stops) {
        await expect(pg.cursor(id)).toHaveText(stop)
        await pg.press('ArrowRight')
      }

      // One more press at the end changes nothing.
      await expect(pg.cursor(id)).toHaveText(stops[stops.length - 1])
    })

    test('← from the end retraces the same positions in reverse', async () => {
      const stops = expectedStops(id).reverse()
      await pg.focus(id)
      await pg.press('End')

      for (const stop of stops) {
        await expect(pg.cursor(id)).toHaveText(stop)
        await pg.press('ArrowLeft')
      }

      await expect(pg.cursor(id)).toHaveText('root @ 0')
    })
  })
}

test('Home and End jump to the start and end of the equation', async () => {
  await pg.focus('power-over-sum')
  await pg.press('ArrowRight', 8) // inside the denominator
  await expect(pg.cursor('power-over-sum')).toHaveText('3.den @ 0')

  await pg.press('End')
  await expect(pg.cursor('power-over-sum')).toHaveText('root @ 4')

  await pg.press('Home')
  await expect(pg.cursor('power-over-sum')).toHaveText('root @ 0')
})

test('each field keeps its own cursor', async () => {
  await pg.focus('fraction-sum')
  await pg.press('ArrowRight', 3)
  await pg.focus('sin-squared')
  await pg.press('ArrowRight', 2)

  await expect(pg.cursor('fraction-sum')).toHaveText('2.num @ 0')
  await expect(pg.cursor('sin-squared')).toHaveText('1.body @ 0')
})

test('↑ and ↓ move between stacked rows, matching the caret x position', async () => {
  const id = 'power-over-sum'
  // After the numerator's "1", which sits above the middle of "x+1".
  await pg.clickIn(await pg.atomBox(id, 'r/3.num', 0), 0.9)
  await expect(pg.cursor(id)).toHaveText('3.num @ 1')

  await pg.press('ArrowDown')
  await expect(pg.cursor(id)).toHaveText('3.den @ 2')

  await pg.press('ArrowUp')
  await expect(pg.cursor(id)).toHaveText('3.num @ 1')
})

test('↓ from a nested denominator goes to the outer denominator', async () => {
  const id = 'nested-fractions'
  await pg.clickIn(await pg.atomBox(id, 'r/0.num/0.den', 0), 0.8)
  await expect(pg.cursor(id)).toHaveText('0.num › 0.den @ 1')

  await pg.press('ArrowDown')
  await expect(pg.cursor(id)).toHaveText('0.den @ 0')
})

test('↑/↓ move between an nth root index and its body', async () => {
  const id = 'roots-abs-derivative'
  await pg.clickIn(await pg.atomBox(id, 'r/2.index', 0), 0.8)
  await expect(pg.cursor(id)).toHaveText('2.index @ 1')

  await pg.press('ArrowDown')
  await expect(pg.cursor(id)).toHaveText(/^2\.body @ [01]$/)

  await pg.press('ArrowUp')
  await expect(pg.cursor(id)).toHaveText(/^2\.index @ [01]$/)
})

test('↑/↓ in the root row or a superscript leave the cursor alone', async () => {
  const id = 'power-over-sum'
  await pg.focus(id)
  await pg.press('End')
  await pg.press('ArrowUp')
  await expect(pg.cursor(id)).toHaveText('root @ 4')

  await pg.press('Home')
  await pg.press('ArrowRight', 2)
  await expect(pg.cursor(id)).toHaveText('1.sup @ 0')
  await pg.press('ArrowDown')
  await expect(pg.cursor(id)).toHaveText('1.sup @ 0')
})
