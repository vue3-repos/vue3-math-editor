import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'

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
