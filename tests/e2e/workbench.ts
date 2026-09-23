// Helpers for driving the equation workbench (index.html) from Playwright.

import { type Locator, type Page, expect } from '@playwright/test'

export class Workbench {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/')
    await this.page.locator('.math-field').first().waitFor()
    await this.page.evaluate(() => document.fonts.ready.then(() => undefined))
  }

  line(index: number): Locator {
    return this.page.locator(`[data-line="${index}"] .math-field`)
  }

  lines(): Locator {
    return this.page.locator('[data-line]')
  }

  // The active line's cursor, e.g. "0.den @ 1".
  cursor(): Locator {
    return this.page.locator('[data-role="cursor"]')
  }

  async focusLine(index = 0): Promise<void> {
    await this.line(index).focus()
    await expect(this.line(index)).toBeFocused()
  }

  // Type text into the focused line, one key press per character.
  async type(text: string): Promise<void> {
    await this.page.keyboard.type(text)
  }

  async press(key: string, times = 1): Promise<void> {
    for (let i = 0; i < times; i++) await this.page.keyboard.press(key)
  }

  // The active line's MathJSON, parsed; null when the line is empty.
  async mathJson(): Promise<unknown> {
    const text = (await this.page.locator('[data-role="mathjson"]').textContent())?.trim()
    return text ? JSON.parse(text) : null
  }

  async expectMathJson(expected: unknown): Promise<void> {
    await expect.poll(() => this.mathJson()).toEqual(expected)
  }

  // The box of the n-th atom directly inside a row of a line.
  async atomBox(line: number, rowPath: string, n: number) {
    return this.line(line).evaluate(
      (field, [rowPath, n]) => {
        const row = field.querySelector(`[data-row="${rowPath}"]`)
        const atoms = Array.from(row?.querySelectorAll('[data-atom]') ?? []).filter(
          (atom) => atom.closest('[data-row]') === row,
        )
        const rect = atoms[n as number]?.getBoundingClientRect()
        if (!rect) throw new Error(`No atom ${n} in ${rowPath}`)
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      },
      [rowPath, n] as const,
    )
  }
}
