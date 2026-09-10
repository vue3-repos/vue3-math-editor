import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import katex from 'katex'
import { describe, expect, it } from 'vitest'

import { measureFocusRect } from '../src/editor/focusRect'
import { astToContentMathML } from '../src/renderers/mathml'
import { astToInteractiveLatex } from '../src/renderers/interactiveLatex'
import type { AstNode } from '../src/types/ast'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Mirrors tests/resources/cube_root_n.xml: root[3]{n} = 5.
const cubeRootN: AstNode = {
  type: 'Equal',
  left: {
    type: 'Root',
    radicand: { type: 'Identifier', name: 'n' },
    degree: { type: 'Number', value: 3 },
  },
  right: { type: 'Number', value: 5 },
}

function normalizeMathMl(mathml: string): string {
  return mathml.replace(/\s+/g, ' ').trim()
}

describe('measureFocusRect with a radical (cube_root_n fixture)', () => {
  it('matches the MathML resource for root[3]{n} = 5', () => {
    const fixture = readFileSync(path.join(dirname, 'resources/cube_root_n.xml'), 'utf-8')
    const generated = astToContentMathML(cubeRootN)

    expect(normalizeMathMl(generated)).toBe(normalizeMathMl(fixture))
  })

  it('does not include the radical glyph SVG intrinsic width in the focus rect', () => {
    const latex = astToInteractiveLatex(cubeRootN, ['left'])
    const html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode: true,
      strict: 'ignore',
      trust: (context) => context.command === '\\htmlData' || context.command === '\\htmlClass',
    })

    // The radical's clip comes from katex.css (".hide-tail { overflow: hidden }"),
    // which jsdom needs loaded to resolve computed styles correctly.
    const katexCssPath = path.join(dirname, '../node_modules/katex/dist/katex.css')
    const style = document.createElement('style')
    style.textContent = readFileSync(katexCssPath, 'utf-8')
    document.head.appendChild(style)

    document.body.innerHTML = html
    const target = document.querySelector('[data-path="r.left"]')
    expect(target).not.toBeNull()

    // jsdom performs no real layout, so getBoundingClientRect() always
    // returns zeros. Stub it with metrics that reproduce the real-world bug:
    // the radical's <svg> reports its huge intrinsic width (400em) while the
    // ancestor `.hide-tail` wrapper that clips it (overflow: hidden) reports
    // the real, small painted size.
    const rectFor = (el: Element): DOMRect => {
      if (el.tagName === 'svg') {
        return { left: 0, top: 0, right: 10480, bottom: 60, width: 10480, height: 60 } as DOMRect
      }
      if (el.classList.contains('hide-tail')) {
        return { left: 5, top: 10, right: 15, bottom: 40, width: 10, height: 30 } as DOMRect
      }
      if (el.classList.contains('pstrut')) {
        return { left: 0, top: -80, right: 0, bottom: 20, width: 0, height: 100 } as DOMRect
      }
      return { left: 0, top: 10, right: 40, bottom: 40, width: 40, height: 30 } as DOMRect
    }
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return rectFor(this)
    }

    const bounds = measureFocusRect(target as Element)
    const width = bounds.right - bounds.left
    const height = bounds.bottom - bounds.top

    // Before the fix this reproduced ~10479px x 93px because the clipped
    // <svg>'s intrinsic size leaked into the union.
    expect(width).toBeLessThan(200)
    expect(height).toBeLessThan(200)
  })
})

// d(t^2)/dt = 5. The exponent nests a second .vlist (KaTeX's superscript)
// inside the fraction's own numerator row, which is what exposes the bug.
const dDtTSquared: AstNode = {
  type: 'Equal',
  left: {
    type: 'Derivative',
    expression: {
      type: 'Power',
      base: { type: 'Identifier', name: 't' },
      exponent: { type: 'Number', value: 2 },
    },
    variable: { type: 'Identifier', name: 't' },
  },
  right: { type: 'Number', value: 5 },
}

describe('measureFocusRect with a fraction (derivative of t^2 wrt t)', () => {
  it('does not let a vlist row own-rect stand in for its children', () => {
    const latex = astToInteractiveLatex(dDtTSquared, ['left'])
    const html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode: true,
      strict: 'ignore',
      trust: (context) => context.command === '\\htmlData' || context.command === '\\htmlClass',
    })

    document.body.innerHTML = html
    const target = document.querySelector('[data-path="r.left"]')
    expect(target).not.toBeNull()

    // jsdom performs no real layout, so getBoundingClientRect() always
    // returns zeros. Stub it with metrics that reproduce the real-world bug:
    // each numerator/denominator row is an unclassed `<span>` directly under
    // `.vlist` (`display: block; height: 0; position: relative`, shifted
    // into place via an inline `top` offset). Its own rect is a zero-height
    // reference mark, not content — and once a superscript nests a second
    // .vlist inside the fraction's numerator (as here), that mark can report
    // a position far from where its children actually paint.
    const rectFor = (el: Element): DOMRect => {
      if (el.classList.contains('pstrut')) {
        return { left: 0, top: -80, right: 0, bottom: 20, width: 0, height: 100 } as DOMRect
      }
      if (el.parentElement?.classList.contains('vlist')) {
        return { left: 200, top: 900, right: 250, bottom: 900, width: 50, height: 0 } as DOMRect
      }
      return { left: 0, top: 10, right: 40, bottom: 40, width: 40, height: 30 } as DOMRect
    }
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return rectFor(this)
    }

    const bounds = measureFocusRect(target as Element)

    // Before the fix this reproduced a ~860px tall ring: unioning in each
    // vlist row's own (bogus) rect pulled `bottom` out to the row's
    // unshifted reference position instead of the real glyph extent
    // contributed by its children.
    expect(bounds.top).toBeGreaterThan(0)
    expect(bounds.bottom).toBeLessThan(900)
    expect(bounds.bottom - bounds.top).toBeLessThan(200)
  })
})
