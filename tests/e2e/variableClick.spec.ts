import { type Page, expect, test } from '@playwright/test'

import { type Box, Workbench } from './workbench'

// The variable-click event: a plain click on a variable's name reports the
// name (as in the line's variables) and the line's id; the click still places
// the caret. Clicks elsewhere, with a modifier, double clicks and drags report
// nothing.

let wb: Workbench

interface Host {
  lines: { id: string; variables: string[] }[]
  variableClicks: { name: string; lineId: string }[]
}
const host = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as { __workbench: Host }).__workbench
    return { lines: [...h.lines], clicks: [...h.variableClicks] }
  })
const clicked = async () => (await host(wb.page)).clicks
const lineId = async (index: number) => (await host(wb.page)).lines[index].id

// The box of the first painted glyph in a line whose text is `text`.
async function glyph(line: number, text: string): Promise<Box> {
  await wb.settle()
  return wb.line(line).evaluate((field, text) => {
    const leaf = Array.from(field.querySelectorAll('.katex-html span')).find(
      (span) => span.children.length === 0 && span.textContent === text,
    )
    const rect = leaf?.getBoundingClientRect()
    if (!rect) throw new Error(`No glyph "${text}"`)
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
  }, text)
}
const centre = (box: Box) => wb.pointIn(box, 0.5)

test.beforeEach(async ({ page }) => {
  wb = new Workbench(page)
  await wb.goto()
  await wb.focusLine(0)
  await wb.type('g_Kr__max=V_m*2+sin(z)')
  await wb.press('Enter')
  await wb.type('y=g_Kr__max')
  await wb.press('Enter')
  await expect(wb.line(0).locator('[data-name]')).toHaveCount(2)
})

test('a click on a typeset name reports the whole name, and places the caret in it', async () => {
  // Kr, the subscript.
  await wb.clickIn(await glyph(0, 'K'), 0.5)
  await expect.poll(clicked).toEqual([{ name: 'g_Kr__max', lineId: await lineId(0) }])
  await expect(wb.cursor()).toHaveText(/^root @ [0-9]$/)
  // Now drawn as typed, with the caret in it.
  await expect(wb.line(0).locator('[data-name]')).toHaveCount(1)

  await wb.clickIn(await glyph(0, 'V'), 0.5)
  await expect.poll(clicked).toHaveLength(2)
  expect((await clicked())[1].name).toBe('V_m')
})

test('the line is the one clicked, active or not', async () => {
  await wb.clickIn(await glyph(1, 'y'), 0.5)
  await expect.poll(clicked).toEqual([{ name: 'y', lineId: await lineId(1) }])
  await wb.clickIn(await glyph(0, 'z'), 0.5)
  await expect.poll(clicked).toHaveLength(2)
  expect((await clicked())[1]).toEqual({ name: 'z', lineId: await lineId(0) })
})

test('numbers, operators and function names report nothing', async () => {
  for (const text of ['2', '=', 's']) {
    await wb.clickIn(await glyph(0, text), 0.5)
  }
  await wb.clickIn(await glyph(0, 'z'), 0.5)
  // Only the z.
  await expect.poll(clicked).toHaveLength(1)
  expect((await clicked())[0].name).toBe('z')
})

test('a click with a modifier, a double click or a drag reports nothing more', async () => {
  await wb.clickIn(await glyph(1, 'y'), 0.5, 0.5, { shift: true })
  for (const key of ['Control', 'Meta', 'Alt']) {
    await wb.clickIn(await glyph(1, 'y'), 0.5, 0.5, { modifiers: [key] })
  }

  // The first click of a double click is a click; the second is not.
  const { x, y } = centre(await glyph(0, 'z'))
  await wb.page.mouse.dblclick(x, y)
  await expect.poll(clicked).toHaveLength(1)

  // Selecting across the line's first name.
  const from = centre(await glyph(1, 'y'))
  const to = centre(await glyph(1, '='))
  await wb.drag(from, to)
  await expect(wb.selection()).toBeVisible()

  await wb.settle()
  expect(await clicked()).toEqual([{ name: 'z', lineId: await lineId(0) }])
})

test('a few pixels of movement while pressed is still a click, and selects nothing', async () => {
  const { x, y } = centre(await glyph(0, 'z'))
  await wb.page.mouse.move(x, y)
  await wb.page.mouse.down()
  await wb.page.mouse.move(x + 3, y + 1, { steps: 3 })
  await wb.page.mouse.up()
  await expect.poll(clicked).toEqual([{ name: 'z', lineId: await lineId(0) }])
  await expect(wb.selection()).toHaveCount(0)
})

// KaTeX draws a stack reaching below the baseline with an empty strut over
// whatever lies there, and a root's surd over its radicand; a click goes
// through both to the name drawn beneath.
test('a name in a denominator or under a root reports itself', async () => {
  for (const text of ['y=a/b', 'y=k/V_m', 'y=a/b/c']) {
    await wb.type(text)
    await wb.press('Enter')
  }
  await wb.type('y=\\sqrt x')
  await wb.type(' ')
  await wb.type('+1')
  await wb.press('Enter')

  const clicks: [number, string][] = [
    [2, 'a'],
    [2, 'b'],
    [3, 'V'],
    [4, 'b'],
    [4, 'c'],
    [5, 'x'],
  ]
  for (const [line, text] of clicks) {
    await wb.clickIn(await glyph(line, text), 0.5)
  }
  await expect
    .poll(async () => (await clicked()).map((click) => click.name))
    .toEqual(['a', 'b', 'V_m', 'b', 'c', 'x'])
})

test('a fraction bar reports nothing', async () => {
  await wb.type('y=a/b')
  await wb.press('Enter')
  await wb.clickIn(await wb.boxOf(wb.line(2).locator('.frac-line')), 0.5)
  await wb.clickIn(await glyph(2, 'y'), 0.5)
  // Only the y.
  await expect.poll(clicked).toHaveLength(1)
  expect((await clicked())[0].name).toBe('y')
})
