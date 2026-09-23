// Helpers for driving the cursor playground (playground.html) from Playwright.

import { type Locator, type Page, expect } from '@playwright/test'

import { allPositions } from '../../src/editor/cursor'
import { SAMPLES, type Sample, describeCursor } from '../../src/dev/samples'

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export function sample(id: string): Sample {
  const found = SAMPLES.find((s) => s.id === id)
  if (!found) throw new Error(`No playground sample "${id}"`)
  return found
}

// Every cursor position of a sample in traversal order, as the playground
// prints them.
export function expectedStops(id: string): string[] {
  return allPositions(sample(id).build()).map(describeCursor)
}

export class Playground {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/playground.html')
    await this.page.locator('.math-field').first().waitFor()
    // Glyph metrics change once the KaTeX fonts load.
    await this.page.evaluate(() => document.fonts.ready.then(() => undefined))
  }

  section(id: string): Locator {
    return this.page.locator(`[data-sample="${id}"]`)
  }

  field(id: string): Locator {
    return this.section(id).locator('.math-field')
  }

  // The playground's printed cursor, e.g. "3.den @ 2".
  cursor(id: string): Locator {
    return this.section(id).locator('[data-role="cursor"]')
  }

  caret(id: string): Locator {
    return this.field(id).locator('.caret')
  }

  // Keyboard focus without a click (a click would also move the cursor).
  async focus(id: string): Promise<void> {
    await this.field(id).focus()
    await this.page.keyboard.press('Home')
    await expect(this.cursor(id)).toHaveText('root @ 0')
  }

  async press(key: string, times = 1): Promise<void> {
    for (let i = 0; i < times; i++) await this.page.keyboard.press(key)
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

  // Scroll a field into view first: coordinates are viewport-relative, and
  // the lower samples start below the fold.
  private async inView(id: string): Promise<void> {
    await this.field(id).scrollIntoViewIfNeeded()
  }

  // The box of the n-th atom directly inside a row ("r", "r/3.den", …), or
  // of the first element inside it matching `part` (e.g. ".frac-line").
  async atomBox(id: string, rowPath: string, n: number, part?: string): Promise<Box> {
    await this.inView(id)
    return this.field(id).evaluate(
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

  async rowBox(id: string, rowPath: string): Promise<Box> {
    await this.inView(id)
    return this.field(id).evaluate((field, rowPath) => {
      const rect = field.querySelector(`[data-row="${rowPath}"]`)?.getBoundingClientRect()
      if (!rect) throw new Error(`No row ${rowPath}`)
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    }, rowPath)
  }

  async fieldBox(id: string): Promise<Box> {
    await this.inView(id)
    const rect = await this.field(id).boundingBox()
    if (!rect) throw new Error(`Field ${id} is not visible`)
    return { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height }
  }

  async caretBox(id: string): Promise<Box | null> {
    await this.settle()
    // Absent in an empty slot (the placeholder is highlighted instead).
    if ((await this.caret(id).count()) === 0) return null
    const rect = await this.caret(id).boundingBox()
    return rect
      ? { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height }
      : null
  }

  // Click at a fraction of the way across (fx) and down (fy) a box.
  async clickIn(box: Box, fx: number, fy = 0.5): Promise<void> {
    await this.page.mouse.click(
      box.left + (box.right - box.left) * fx,
      box.top + (box.bottom - box.top) * fy,
    )
  }
}
