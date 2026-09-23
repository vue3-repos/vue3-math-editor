// Helpers for driving the equation workbench (index.html) from Playwright.

import { type Locator, type Page, expect } from '@playwright/test'

import { parseRow } from '../../src/editor/parse'
import { astToMathJson } from '../../src/renderers/mathjson'
import { expectedShape, sample } from './samples'

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export class Workbench {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/')
    await this.page.locator('.math-field').first().waitFor()
    // Glyph metrics change once the KaTeX fonts load.
    await this.page.evaluate(() => document.fonts.ready.then(() => undefined))
  }

  line(index = 0): Locator {
    return this.page.locator(`[data-line="${index}"] .math-field`)
  }

  lines(): Locator {
    return this.page.locator('[data-line]')
  }

  // The active line's cursor, e.g. "0.den @ 1".
  cursor(): Locator {
    return this.page.locator('[data-role="cursor"]')
  }

  caret(line = 0): Locator {
    return this.line(line).locator('.caret')
  }

  // The active line's selection, e.g. "root 2–5"; absent when nothing is
  // selected.
  selection(): Locator {
    return this.page.locator('[data-role="selection"]')
  }

  // The drawn selection highlight in a line.
  selectionHighlight(line = 0): Locator {
    return this.line(line).locator('.selection')
  }

  // The problem underlines drawn in a line.
  marks(line = 0): Locator {
    return this.line(line).locator('[data-role="mark"]')
  }

  // The message shown for the mark under the pointer.
  markTip(): Locator {
    return this.page.locator('[data-role="mark-tip"]')
  }

  async boxOf(locator: Locator): Promise<Box> {
    await this.settle()
    const rect = await locator.boundingBox()
    if (!rect) throw new Error('Not visible')
    return { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height }
  }

  // Drag with the mouse from one point to another.
  async drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    await this.page.mouse.move(from.x, from.y)
    await this.page.mouse.down()
    await this.page.mouse.move(to.x, to.y, { steps: 6 })
    await this.page.mouse.up()
  }

  async focusLine(index = 0): Promise<void> {
    await this.line(index).focus()
    await expect(this.line(index)).toBeFocused()
  }

  // Move focus off the equations (clicks the page heading).
  async blur(): Promise<void> {
    await this.page.locator('h1').click()
  }

  // Type text into the focused line, one key press per character.
  async type(text: string): Promise<void> {
    await this.page.keyboard.type(text)
  }

  async press(key: string, times = 1): Promise<void> {
    for (let i = 0; i < times; i++) await this.page.keyboard.press(key)
  }

  // Type a sample into the focused line and check the result is exactly the
  // sample's tree (same rows, same number of atoms in each, same MathJSON).
  async enterSample(id: string, line = 0): Promise<void> {
    for (const step of sample(id).keys) {
      const named = /^\{(\w+)\}$/.exec(step)
      if (named) await this.press(named[1])
      else await this.type(step)
    }

    await expect.poll(() => this.shape(line)).toEqual(expectedShape(id))
    await this.expectMathJson(astToMathJson(parseRow(sample(id).build()).ast))
  }

  // The rendered tree's shape: "<data-row>:<atoms directly in it>", sorted.
  async shape(line = 0): Promise<string[]> {
    return this.line(line).evaluate((field) =>
      Array.from(field.querySelectorAll('[data-row]'))
        .map((row) => {
          const atoms = Array.from(row.querySelectorAll('[data-atom]')).filter(
            (atom) => atom.closest('[data-row]') === row,
          )
          return `${row.getAttribute('data-row')}:${atoms.length}`
        })
        .sort(),
    )
  }

  // The active line's MathJSON, parsed; null when the line is empty.
  async mathJson(): Promise<unknown> {
    const text = (await this.page.locator('[data-role="mathjson"]').textContent())?.trim()
    return text ? JSON.parse(text) : null
  }

  async expectMathJson(expected: unknown): Promise<void> {
    await expect.poll(() => this.mathJson()).toEqual(expected)
  }

  // Wait for Vue's update and the caret re-measure that follows it.
  async settle(): Promise<void> {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
  }

  // The box of the n-th atom directly inside a row ("r", "r/3.den", …) of a
  // line, or of the first element inside that atom matching `part`
  // (e.g. ".frac-line").
  async atomBox(line: number, rowPath: string, n: number, part?: string): Promise<Box> {
    await this.line(line).scrollIntoViewIfNeeded()
    return this.line(line).evaluate(
      (field, [rowPath, n, part]) => {
        const row = field.querySelector(`[data-row="${rowPath}"]`)
        if (!row) throw new Error(`No row ${rowPath}`)
        const atoms = Array.from(row.querySelectorAll('[data-atom]')).filter(
          (atom) => atom.closest('[data-row]') === row,
        )
        const atom = atoms[n as number]
        const target = part ? atom?.querySelector(part as string) : atom
        const rect = target?.getBoundingClientRect()
        if (!rect) throw new Error(`No atom ${n}${part ? ` ${part}` : ''} in ${rowPath}`)
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      },
      [rowPath, n, part ?? ''] as const,
    )
  }

  async rowBox(line: number, rowPath: string): Promise<Box> {
    await this.line(line).scrollIntoViewIfNeeded()
    return this.line(line).evaluate((field, rowPath) => {
      const rect = field.querySelector(`[data-row="${rowPath}"]`)?.getBoundingClientRect()
      if (!rect) throw new Error(`No row ${rowPath}`)
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    }, rowPath)
  }

  async fieldBox(line = 0): Promise<Box> {
    await this.line(line).scrollIntoViewIfNeeded()
    const rect = await this.line(line).boundingBox()
    if (!rect) throw new Error(`Line ${line} is not visible`)
    return { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height }
  }

  async caretBox(line = 0): Promise<Box | null> {
    await this.settle()
    // Absent in an empty slot (the placeholder is highlighted instead).
    if ((await this.caret(line).count()) === 0) return null
    const rect = await this.caret(line).boundingBox()
    return rect
      ? { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height }
      : null
  }

  // A point a fraction of the way across (fx) and down (fy) a box.
  pointIn(box: Box, fx: number, fy = 0.5): { x: number; y: number } {
    return { x: box.left + (box.right - box.left) * fx, y: box.top + (box.bottom - box.top) * fy }
  }

  // Click at a fraction of the way across (fx) and down (fy) a box,
  // optionally holding Shift.
  async clickIn(box: Box, fx: number, fy = 0.5, { shift = false } = {}): Promise<void> {
    const { x, y } = this.pointIn(box, fx, fy)
    if (shift) await this.page.keyboard.down('Shift')
    await this.page.mouse.click(x, y)
    if (shift) await this.page.keyboard.up('Shift')
  }
}
