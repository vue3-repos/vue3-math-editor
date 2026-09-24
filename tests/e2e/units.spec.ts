import { expect, test } from '@playwright/test'

import { Workbench } from './workbench'

// The units interface: the workbench reports its lines (equations-change)
// and shows the issues and variable units a host sends back. The demo app
// exposes both on window.__workbench (src/App.vue).

interface Line {
  id: string
  mathml: string
  variables: string[]
  units: string[]
  complete: boolean
}

let wb: Workbench

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
})

const lines = () =>
  wb.page.evaluate(
    () => (window as unknown as { __workbench: { lines: Line[] } }).__workbench.lines,
  )

const setUnits = (units: { issues?: unknown[]; variableUnits?: Record<string, string> }) =>
  wb.page.evaluate(
    (u) =>
      (window as unknown as { __workbench: { setUnits(u: unknown): void } }).__workbench.setUnits(
        u,
      ),
    units,
  )

const unitsMarks = (line = 0) => wb.line(line).locator('[data-role="mark"][data-kind="units"]')

test('reports each line: id, CellML-mode MathML, variables, completeness', async () => {
  await wb.type('x=v+t*2{s}')
  await expect
    .poll(async () => (await lines())[0])
    .toMatchObject({
      id: 'line-1',
      variables: ['x', 'v', 't'],
      units: ['s'],
      complete: true,
    })
  expect((await lines())[0].mathml).toContain('<cn cellml:units="s">2</cn>')

  await wb.type('+')
  await expect.poll(async () => (await lines())[0].complete).toBe(false)
})

test('line ids stay with their lines as lines are added and removed', async () => {
  await wb.type('a=1')
  await wb.press('Enter')
  await wb.type('b=2')
  await expect.poll(async () => (await lines()).map((l) => l.id)).toEqual(['line-1', 'line-2'])

  await wb.focusLine(0)
  await wb.press('End')
  await wb.press('Enter')
  await expect
    .poll(async () => (await lines()).map((l) => l.id))
    .toEqual(['line-1', 'line-3', 'line-2'])

  // Backspace in the new, empty line removes it.
  await wb.press('Backspace')
  await expect.poll(async () => (await lines()).map((l) => l.id)).toEqual(['line-1', 'line-2'])
})

test('issues are underlined in amber on the right line, and listed', async () => {
  await wb.type('x=v+t')
  await wb.press('Enter')
  await wb.type('y=v')
  await setUnits({
    issues: [
      { lineId: 'line-1', message: "'v' and 't' have different units", variables: ['v', 't'] },
    ],
  })

  await expect(unitsMarks(0)).toHaveCount(2)
  await expect(unitsMarks(1)).toHaveCount(0)

  // Listed under the equations for the active line only.
  await expect(wb.page.locator('[data-role="units-issues"]')).toHaveCount(0)
  await wb.focusLine(0)
  await expect(wb.page.locator('[data-role="units-issues"]')).toContainText('different units')

  const box = await wb.boxOf(unitsMarks(0).first())
  await wb.page.mouse.move((box.left + box.right) / 2, (box.top + box.bottom) / 2)
  await expect(wb.markTip()).toHaveText("'v' and 't' have different units")
})

test('an issue follows its line when a line is inserted before it', async () => {
  await wb.type('a=1')
  await wb.press('Enter')
  await wb.type('x=v+t')
  await setUnits({ issues: [{ lineId: 'line-2', message: 'units', variables: ['v'] }] })
  await expect(unitsMarks(1)).toHaveCount(1)

  await wb.focusLine(0)
  await wb.press('End')
  await wb.press('Enter')
  await expect(unitsMarks(1)).toHaveCount(0)
  await expect(unitsMarks(2)).toHaveCount(1)
})

test('variable and number units show on hover, without underlines', async () => {
  await wb.type('x=v*2{s}')
  await setUnits({ variableUnits: { v: 'metre_per_second' } })
  await expect(wb.marks()).toHaveCount(0)

  const v = await wb.atomBox(0, 'r', 2)
  await wb.page.mouse.move((v.left + v.right) / 2, (v.top + v.bottom) / 2)
  await expect(wb.markTip()).toHaveText('v: metre_per_second')

  const two = await wb.atomBox(0, 'r', 4)
  await wb.page.mouse.move((two.left + two.right) / 2, (two.top + two.bottom) / 2)
  await expect(wb.markTip()).toHaveText('2: s')
})

test('a number’s units are typed in braces and drawn after it', async () => {
  await wb.type('k=0.25{per_s')
  await expect(wb.cursor()).toHaveText('6.units @ 5')
  await wb.type('}')
  await expect(wb.cursor()).toHaveText('root @ 7')
  await expect(wb.line(0).locator('.me-units')).toHaveText('per_s')
  await wb.expectMathJson(['Equal', 'k', 0.25])
})
