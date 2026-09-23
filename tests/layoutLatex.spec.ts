import katex from 'katex'
import { describe, expect, it } from 'vitest'

import { allPositions } from '../src/editor/cursor'
import {
  type Atom,
  type Row,
  childRows,
  derivative,
  fraction,
  func,
  group,
  root,
  row,
  superscript,
  symbol,
} from '../src/editor/layout'
import {
  KATEX_EDITOR_OPTIONS,
  decodeRowPath,
  encodeRowPath,
  rowToLatex,
} from '../src/renderers/layoutLatex'

function allAtoms(tree: Row): Atom[] {
  return tree.flatMap((atom) => [atom, ...childRows(atom).flatMap(([, child]) => allAtoms(child))])
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('row path encoding', () => {
  it('round-trips every row path', () => {
    const tree = row(
      'x',
      superscript(row('2')),
      '+',
      fraction(row(root(row('y'), row('3'))), row('1')),
    )
    for (const { path } of allPositions(tree)) {
      expect(decodeRowPath(encodeRowPath(path))).toEqual(path)
    }
  })

  it('rejects malformed encodings', () => {
    expect(decodeRowPath('x/1.num')).toBeNull()
    expect(decodeRowPath('r/one.num')).toBeNull()
    expect(decodeRowPath(null)).toBeNull()
  })
})

describe('rowToLatex', () => {
  it('tags every atom and every row exactly once', () => {
    const tree = row(
      func('sin'),
      group(row('x')),
      superscript(row('2')),
      '=',
      fraction(row('1'), row()),
      derivative(row('f'), row('t')),
    )
    const latex = rowToLatex(tree)

    for (const atom of allAtoms(tree)) {
      expect(countOf(latex, `{atom=${atom.id}}`)).toBe(1)
    }

    const rows = new Set(allPositions(tree).map(({ path }) => encodeRowPath(path)))
    for (const encoded of rows) {
      expect(countOf(latex, `{row=${encoded}}`)).toBe(1)
    }
  })

  it('keeps operator spacing classes', () => {
    const [x, plus, one, eq] = row('x+1=')
    const latex = rowToLatex([x, plus, one, eq])
    expect(latex).toContain(`\\mathbin{\\htmlData{atom=${plus.id}}{+}}`)
    expect(latex).toContain(`\\mathrel{\\htmlData{atom=${eq.id}}{=}}`)
  })

  it('attaches a superscript to the previous atom, or an empty base after an operator', () => {
    const [x, sup] = row('x', superscript(row('2')))
    expect(rowToLatex([x, sup])).toContain(
      `{\\htmlData{atom=${x.id}}{x}}^{\\htmlData{atom=${sup.id}}`,
    )

    const [plus, lone] = row('+', superscript(row('2')))
    expect(rowToLatex([plus, lone])).toContain(`{}^{\\htmlData{atom=${lone.id}}`)
  })

  it('marks only the active empty row', () => {
    const tree = row(fraction())
    const latex = rowToLatex(tree, { activeRow: [{ atom: 0, branch: 'den' }] })
    expect(countOf(latex, 'me-ph-active')).toBe(1)
    expect(countOf(latex, '{me-ph}')).toBe(1)
    expect(latex.indexOf('me-ph-active')).toBeGreaterThan(latex.indexOf('row=r/0.den'))
  })

  it('keeps a name together and draws a function name upright', () => {
    const vm = row('Vm')
    // In \\mathit, TeX's italic for words, so it reads as one name.
    expect(rowToLatex(vm)).toContain(
      `{\\htmlData{atom=${vm[0].id}}{\\mathit{V}}\\htmlData{atom=${vm[1].id}}{\\mathit{m}}}`,
    )

    const sin = row('sin')
    expect(rowToLatex(sin)).toContain(
      `\\mathop{\\htmlData{atom=${sin[0].id}}{\\mathrm{s}}\\htmlData{atom=${sin[1].id}}{\\mathrm{i}}\\htmlData{atom=${sin[2].id}}{\\mathrm{n}}}`,
    )
    expect(rowToLatex(row('cost'))).not.toContain('mathrm')
  })

  it('attaches an exponent to the whole name', () => {
    const [v, m, sup] = row('Vm', superscript(row('2')))
    expect(rowToLatex([v, m, sup])).toContain(
      `{{\\htmlData{atom=${v.id}}{\\mathit{V}}\\htmlData{atom=${m.id}}{\\mathit{m}}}}^{\\htmlData{atom=${sup.id}}`,
    )
  })

  it('renders greek names, other words and unusual glyphs', () => {
    expect(rowToLatex([symbol('alpha')])).toContain('{\\alpha}')
    expect(rowToLatex([symbol('speed')])).toContain('{\\mathit{speed}}')
    expect(rowToLatex([symbol('%')])).toContain('{\\text{\\%}}')
  })
})

// ---------------------------------------------------------------------------
// KaTeX accepts everything we produce
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Includes LaTeX special characters, which must be escaped, and the letters
// of "sin", so runs sometimes spell a function name.
const GLYPHS = Array.from('xysinsin2.+-=*,?{}^_\\%&#~$')

function randomRow(rand: () => number, depth: number): Row {
  const length = Math.floor(rand() * 6)
  const atoms: Atom[] = []
  const child = () => randomRow(rand, depth - 1)

  for (let i = 0; i < length; i++) {
    switch (depth > 0 ? Math.floor(rand() * 10) : 0) {
      case 1:
        atoms.push(fraction(child(), child()))
        break
      case 2:
        atoms.push(superscript(child()))
        break
      case 3:
        atoms.push(root(child(), rand() < 0.5 ? child() : null))
        break
      case 4:
        atoms.push(group(child(), rand() < 0.5 ? '(' : '|'))
        break
      case 5:
        atoms.push(derivative(child(), child()))
        break
      case 6:
        atoms.push(func(rand() < 0.5 ? 'sin' : 'asin'))
        break
      default:
        atoms.push(symbol(GLYPHS[Math.floor(rand() * GLYPHS.length)]))
    }
  }

  return atoms
}

describe('KaTeX compatibility', () => {
  it('renders any layout tree without a parse error', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const tree = randomRow(mulberry32(seed), 3)
      const latex = rowToLatex(tree, { activeRow: [] })
      expect(
        () => katex.renderToString(latex, { ...KATEX_EDITOR_OPTIONS, throwOnError: true }),
        latex,
      ).not.toThrow()
    }
  })

  it('emits data-atom and data-row attributes for every atom and row', () => {
    const tree = row('x', superscript(row('2')), '+', fraction(row('1'), row('x+1')))
    const html = katex.renderToString(rowToLatex(tree), KATEX_EDITOR_OPTIONS)

    for (const atom of allAtoms(tree)) {
      expect(html).toContain(`data-atom="${atom.id}"`)
    }
    expect(html).toContain('data-row="r/3.den"')
  })
})
