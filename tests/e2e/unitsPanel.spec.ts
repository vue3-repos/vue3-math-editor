import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

import { Workbench } from './workbench'

// Units checking in the demo: the units panel, useUnitsChecker and libCellML
// (through the vue3-libcellml.js plugin), and the demo without the plugin
// (?nolibcellml), as an application that doesn't provide it would run.

let wb: Workbench

const panel = () => wb.page.locator('[data-role="units-panel"]')
const summary = () => wb.page.locator('[data-role="units-summary"]')
const issues = () => wb.page.locator('[data-role="units-issues"] li')
const unitsMarks = (line = 0) => wb.line(line).locator('[data-role="mark"][data-kind="units"]')
const variable = (name: string) =>
  wb.page.locator(`[data-role="variables"] tr[data-variable="${name}"]`)
const unitsInput = (name: string) => variable(name).locator('input')

async function giveUnits(name: string, units: string) {
  await unitsInput(name).fill(units)
  await unitsInput(name).press('Enter')
}

// dV/dt = -(I_ion - I_stim)/C_m, typed into the focused line.
async function typeMembraneEquation() {
  await wb.type('\\dd')
  await wb.press('Space')
  await wb.type('V')
  await wb.press('Tab')
  await wb.type('t')
  await wb.press('ArrowRight')
  await wb.type('=-(I_ion-I_stim)/C_m')
}

test.describe('with libCellML', () => {
  test.beforeEach(async ({ page }) => {
    wb = new Workbench(page)
    await wb.goto()
    await expect(panel()).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })
    await wb.focusLine(0)
  })

  test('lists the variables as they are typed, and waits for units before checking', async () => {
    await wb.type('x=v*t')
    await expect(wb.page.locator('[data-role="variables"] tr')).toHaveCount(3)
    await expect(variable('x')).toHaveAttribute('data-state', 'missing')
    await expect(summary()).toContainText('to check units')
    await expect(unitsMarks()).toHaveCount(0)

    await giveUnits('x', 'metre')
    await expect(issues()).toHaveText(['v has no units', 't has no units'])
    await expect(unitsMarks()).toHaveCount(2)

    await giveUnits('v', 'metre_per_second')
    await expect(variable('v')).toHaveAttribute('data-state', 'unknown')
    await expect(issues()).toHaveText([
      't has no units',
      'No units called metre_per_second are defined',
    ])
  })

  test('checks an example as you type, and again as units change', async () => {
    await wb.page.locator('[data-role="load-example"]').click()
    await expect(wb.page.locator('[data-role="units-files"] li[data-file]')).toHaveCount(1)
    await expect(wb.page.locator('[data-file="example-units.cellml"]')).toContainText(
      '9 units definitions',
    )

    await wb.focusLine(0)
    await typeMembraneEquation()
    await expect(summary()).toHaveText('No units problems in 1 equation.')
    await expect(unitsMarks()).toHaveCount(0)

    // A capacitance in the wrong units.
    await giveUnits('C_m', 'farad')
    await expect(summary()).toHaveText('1 units problem in 1 equation.')
    await wb.focusLine(0)
    await expect(issues()).toHaveCount(1)
    await expect(issues().first()).toContainText("Units don't match")
    await expect(unitsMarks().first()).toBeVisible()

    await giveUnits('C_m', 'uF_per_cm2')
    await expect(summary()).toHaveText('No units problems in 1 equation.')
  })

  test('underlines a scale difference', async () => {
    await wb.page.locator('[data-role="load-example"]').click()
    await wb.focusLine(0)
    await wb.type('E_K=-77{volt}')
    await wb.focusLine(0)
    await expect(issues()).toHaveText([
      "Units don't match in E_K = -77.0: E_K is in mV, -77.0 is in volt",
    ])
    await expect(unitsMarks()).toHaveCount(2) // E_K, and 77 with its units
  })

  test('loads units files, keeps only their units, and reports their problems', async () => {
    await wb.page.locator('[data-role="units-file-input"]').setInputFiles([
      {
        name: 'mine.cellml',
        mimeType: 'application/xml',
        buffer: Buffer.from(
          '<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">' +
            '<units name="furlong"><unit units="metre" multiplier="201.168"/></units>' +
            '<units name="rate"><unit units="per_fortnight"/></units></model>',
        ),
      },
    ])
    const file = wb.page.locator('[data-file="mine.cellml"]')
    await expect(file).toContainText('2 units definitions')
    await expect(file.locator('[data-role="units-problems"]')).toContainText(
      '"rate" is made from "per_fortnight", which isn\'t defined',
    )

    await wb.focusLine(0)
    await wb.type('d=2{furlong}')
    await expect(variable('d')).toHaveAttribute('data-state', 'missing')
    await giveUnits('d', 'metre')
    await expect(summary()).toHaveText('No units problems in 1 equation.')

    await file.getByRole('button', { name: 'Remove mine.cellml' }).click()
    await wb.focusLine(0)
    await expect(issues()).toHaveText(['No units called furlong are defined'])
  })

  test('keys typed in the panel stay there', async () => {
    await wb.type('x=1')
    await unitsInput('x').fill('')
    await unitsInput('x').pressSequentially('\\metre')
    await expect(wb.page.locator('[data-role="command"]')).toHaveCount(0)
    await expect(unitsInput('x')).toHaveValue('\\metre')
    await unitsInput('x').press('ControlOrMeta+z')
    await expect(wb.line(0)).toContainText('x')
    await expect(wb.line(0)).toContainText('1')
  })
})

test.describe('new units', () => {
  test.beforeEach(async ({ page }) => {
    wb = new Workbench(page)
    await wb.goto()
  })

  const form = () => wb.page.locator('[data-role="units-form"]')
  const part = (index: number) => form().locator('[data-role="units-form-part"]').nth(index)

  // name = (prefix units)^exponent · …
  async function define(name: string, parts: [prefix: string, units: string, exponent?: string][]) {
    await wb.page.locator('[data-role="define-units"]').click()
    await form().locator('[data-role="units-form-name"]').fill(name)
    for (const [index, [prefix, units, exponent]] of parts.entries()) {
      if (index > 0) await form().locator('[data-role="units-form-add-part"]').click()
      if (prefix) await part(index).locator('select').selectOption(prefix)
      await part(index)
        .getByLabel(`Units of part ${index + 1}`)
        .fill(units)
      if (exponent)
        await part(index)
          .getByLabel(`Exponent of part ${index + 1}`)
          .fill(exponent)
    }
    await form().locator('[data-role="units-form-save"]').click()
  }

  test('are defined in the panel, used in equations, and downloaded as a file of their own', async () => {
    await define('ms', [['milli', 'second']])
    await define('mV_per_ms', [
      ['milli', 'volt'],
      ['', 'ms', '-1'],
    ])
    await expect(
      wb.page.locator('[data-units="mV_per_ms"] [data-role="new-units-definition"]'),
    ).toHaveText('= milli volt · ms^-1')

    await wb.focusLine(0)
    await wb.type('r=2{mV_per_ms}')
    await giveUnits('r', 'mV_per_ms')
    await expect(summary()).toHaveText('No units problems in 1 equation.')

    const [download] = await Promise.all([
      wb.page.waitForEvent('download'),
      wb.page.locator('[data-role="download-new-units"]').click(),
    ])
    expect(download.suggestedFilename()).toBe('new-units.cellml')
    const text = await readFile((await download.path())!, 'utf8')
    expect(text).toContain('<units name="ms">')
    expect(text).toContain('<unit units="ms" exponent="-1"/>')
    expect(text).not.toContain('<component')
  })

  test('the form says what’s wrong, and names in use can’t be taken', async () => {
    await wb.page.locator('[data-role="define-units"]').click()
    await form().locator('[data-role="units-form-name"]').fill('volt')
    await part(0).getByLabel('Units of part 1').fill('furlong')
    await form().locator('[data-role="units-form-save"]').click()
    await expect(form().locator('[data-role="units-form-problems"] li')).toHaveText([
      'There are units called volt already',
      'no units called furlong are defined',
    ])
  })

  test('renaming follows through other new units; units in use can’t be removed', async () => {
    await define('ms', [['milli', 'second']])
    await define('per_ms', [['', 'ms', '-1']])
    const ms = wb.page.locator('[data-units="ms"]')
    await expect(ms.getByRole('button', { name: 'Remove ms' })).toBeDisabled()

    await ms.getByRole('button', { name: 'Change ms' }).click()
    await form().locator('[data-role="units-form-name"]').fill('msec')
    await form().locator('[data-role="units-form-save"]').click()
    await expect(
      wb.page.locator('[data-units="per_ms"] [data-role="new-units-definition"]'),
    ).toHaveText('= msec^-1')

    await wb.page
      .locator('[data-units="per_ms"]')
      .getByRole('button', { name: 'Remove per_ms' })
      .click()
    await expect(wb.page.locator('[data-units="per_ms"]')).toHaveCount(0)
    await expect(
      wb.page.locator('[data-units="msec"]').getByRole('button', { name: 'Remove msec' }),
    ).toBeEnabled()
  })
})

test.describe('layout', () => {
  test.beforeEach(async ({ page }) => {
    wb = new Workbench(page)
    await wb.goto()
  })

  const box = async (selector: string) => (await wb.page.locator(selector).boundingBox())!

  test('the units panel is beside the editor, with the outputs in tabs under it', async () => {
    const editor = await box('.editor-card')
    const side = await box('[data-role="units-panel"]')
    const outputs = await box('[data-role="outputs"]')
    expect(side.x).toBeGreaterThanOrEqual(editor.x + editor.width)
    expect(side.y).toBeCloseTo(editor.y, 0)
    expect(outputs.y).toBeGreaterThanOrEqual(editor.y + editor.height)
    expect(outputs.x).toBeCloseTo(editor.x, 0)

    // Content MathML first; the others a click away.
    await expect(wb.page.locator('[data-role="mathml"]')).toBeVisible()
    await expect(wb.page.locator('[data-role="latex"]')).toBeHidden()
    await wb.page.locator('[data-role="tab-latex"]').click()
    await expect(wb.page.locator('[data-role="latex"]')).toBeVisible()
    await expect(wb.page.locator('[data-role="mathml"]')).toBeHidden()
  })

  test('on a narrow screen: editor, units, then outputs', async () => {
    await wb.page.setViewportSize({ width: 800, height: 900 })
    const editor = await box('.editor-card')
    const side = await box('[data-role="units-panel"]')
    const outputs = await box('[data-role="outputs"]')
    expect(side.y).toBeGreaterThanOrEqual(editor.y + editor.height)
    expect(outputs.y).toBeGreaterThanOrEqual(side.y + side.height)
  })
})

test.describe('without libCellML', () => {
  test.beforeEach(async ({ page }) => {
    wb = new Workbench(page)
    await wb.goto('/?nolibcellml')
    await wb.focusLine(0)
  })

  test('the editor works as always, and units given still show on hover', async () => {
    await expect(panel()).toHaveAttribute('data-status', 'unavailable')
    await expect(summary()).toContainText('needs libCellML')
    expect(await wb.page.evaluate(() => 'libcellml' in window)).toBe(false)

    await wb.type('x=v*t')
    await giveUnits('v', 'metre_per_second')
    await expect(variable('v')).toHaveAttribute('data-state', 'ok') // nothing to know it by
    await wb.focusLine(0)
    await expect(unitsMarks()).toHaveCount(0)
    await expect(issues()).toHaveCount(0)
  })
})
