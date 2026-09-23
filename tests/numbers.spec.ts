import katex from 'katex'
import { describe, expect, it } from 'vitest'

import { latexToRow, rowToLatexSource } from '../src/editor/clipboard'
import { contentMathML, exportRow } from '../src/editor/exports'
import { nameRuns, numberRuns } from '../src/editor/identifiers'
import { row } from '../src/editor/layout'
import { isExponentSignPosition, numberAt } from '../src/editor/numbers'
import { parseRow } from '../src/editor/parse'
import { KATEX_EDITOR_OPTIONS, rowToLatex } from '../src/renderers/layoutLatex'
import type { AstNode } from '../src/types/ast'
import { json, type } from './editorHelpers'

const typed = (keys: string) => type(keys).root
const parse = (keys: string) => parseRow(typed(keys))
const sci = (value: number, mantissa: string, exponent: number): AstNode => ({
  type: 'Number',
  value,
  scientific: { mantissa, exponent },
})

describe('numberAt', () => {
  it('reads an exponent: e or E, an optional sign, then digits', () => {
    const at = (keys: string) => numberAt(row(keys), 0)
    expect(at('1e-08')).toMatchObject({ end: 5, text: '1e-08', mantissa: '1', exponent: '-08' })
    expect(at('6.022E23')).toMatchObject({ end: 8, text: '6.022e23', exponent: '23' })
    expect(at('2.5e+3')).toMatchObject({ text: '2.5e+3', exponent: '+3' })
    expect(at('42')).toMatchObject({ end: 2, text: '42', exponent: null })
  })

  it('leaves the e alone without a digit after it', () => {
    expect(numberAt(row('2e'), 0)).toMatchObject({ end: 1, exponent: null })
    expect(numberAt(row('2e-x'), 0)).toMatchObject({ end: 1, exponent: null })
    expect(numberAt(row('2e+'), 0)).toMatchObject({ end: 1, exponent: null })
  })

  it('takes a stray decimal point into the exponent, so it is reported', () => {
    expect(numberAt(row('1e-0.5'), 0)).toMatchObject({ end: 6, text: '1e-0.5' })
  })

  it('only starts at a digit or decimal point', () => {
    expect(numberAt(row('e5'), 0)).toBeNull()
  })
})

describe('isExponentSignPosition', () => {
  it('is straight after the e of a number', () => {
    expect(isExponentSignPosition(row('1e'), 2)).toBe(true)
    expect(isExponentSignPosition(row('2.E'), 3)).toBe(true)
    expect(isExponentSignPosition(row('xe'), 2)).toBe(false)
    expect(isExponentSignPosition(row('x2e'), 3)).toBe(false)
    expect(isExponentSignPosition(row('y=12e'), 5)).toBe(true)
    expect(isExponentSignPosition(row('1e'), 1)).toBe(false)
    expect(isExponentSignPosition(row('1'), 1)).toBe(false)
  })
})

describe('names and numbers', () => {
  it('the e of a number is not a name; digits after a letter are part of a name', () => {
    expect(nameRuns(row('1e-08+x'))).toEqual([{ start: 6, end: 7, name: 'x', functionName: null }])
    expect(numberRuns(row('x2e5+3e1')).map((r) => r.text)).toEqual(['3e1'])
    expect(nameRuns(row('x2e5')).map((r) => r.name)).toEqual(['x2e5'])
  })
})

describe('parsing scientific numbers', () => {
  it('is one number that keeps its notation', () => {
    expect(parse('1e-08').ast).toEqual(sci(1e-8, '1', -8))
    expect(parse('6.022E23').ast).toEqual(sci(6.022e23, '6.022', 23))
    expect(parse('2.5e+3').ast).toEqual(sci(2500, '2.5', 3))
    expect(parse('1e-08').diagnostics).toEqual([])
  })

  it('combines with everything else like any number', () => {
    expect(json(type('-1e-8'))).toEqual(['Negate', 1e-8])
    expect(json(type('2e5x'))).toEqual(['Multiply', 200000, 'x'])
    expect(json(type('k=1.5e-3*V'))).toEqual(['Equal', 'k', ['Multiply', 0.0015, 'V']])
    expect(json(type('x2e5'))).toEqual('x2e5')
  })

  it('without digits after the e, the e is a variable', () => {
    expect(json(type('2e'))).toEqual(['Multiply', 2, 'e'])
    expect(json(type('2e-x'))).toEqual(['Subtract', ['Multiply', 2, 'e'], 'x'])
  })

  it('reports malformed and out-of-range numbers', () => {
    expect(parse('1e-0.5').diagnostics.map((d) => d.message)).toEqual(['Malformed number "1e-0.5"'])
    const huge = parse('1e999')
    expect(huge.diagnostics.map((d) => d.message)).toEqual(['Number out of range "1e999"'])
    expect(huge.diagnostics[0].atomIds).toHaveLength(5)
  })
})

describe('exporting scientific numbers', () => {
  it('Content MathML uses e-notation, kept on one line', () => {
    const mathml = contentMathML(typed('x=1e-08'))
    expect(mathml).toContain('    <cn type="e-notation">1<sep/>-8</cn>\n')
  })

  it('CellML mode adds the units placeholder', () => {
    expect(contentMathML(typed('1.5E3'), { cellml: true })).toContain(
      '<cn cellml:units="undefined" type="e-notation">1.5<sep/>3</cn>',
    )
  })

  it('a plain number too small or large for decimal text also uses e-notation', () => {
    expect(contentMathML(typed('0.0000001'))).toContain('<cn type="e-notation">1<sep/>-7</cn>')
    expect(contentMathML(typed('0.001'))).toContain('<cn>0.001</cn>')
  })

  it('Content MathML is well-formed', () => {
    const doc = new DOMParser().parseFromString(
      contentMathML(typed('y=1e-08+2'), { cellml: true }),
      'application/xml',
    )
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    const cn = doc.getElementsByTagName('cn')[0]
    expect(cn.getAttribute('type')).toBe('e-notation')
    expect(cn.textContent).toBe('1-8')
    expect(cn.getElementsByTagName('sep')).toHaveLength(1)
  })

  it('MathJSON is the number', () => {
    expect(JSON.parse(exportRow(typed('1e-08'), 'mathjson'))).toBe(1e-8)
  })

  it('LaTeX has an upright e and a braced exponent, and pastes back as typed', () => {
    const latex = rowToLatexSource(typed('k=1e-08+2.5E+3'))
    expect(latex).toBe('k=1\\mathrm{e}{-08}+2.5\\mathrm{E}{+3}')
    const back = latexToRow(latex)
    expect(back.map((a) => (a as { value: string }).value).join('')).toBe('k=1e-08+2.5E+3')
    expect(json({ root: back, cursor: { path: [], offset: 0 } })).toEqual([
      'Equal',
      'k',
      ['Add', 1e-8, 2500],
    ])
  })

  it('pasting plain text reads scientific numbers too', () => {
    expect(json({ root: latexToRow('y = 3.2e-4 x'), cursor: { path: [], offset: 0 } })).toEqual([
      'Equal',
      'y',
      ['Multiply', 0.00032, 'x'],
    ])
  })
})

describe('rendering scientific numbers', () => {
  it('draws the e upright and the sign without operator spacing', () => {
    const atoms = typed('1e-08')
    const latex = rowToLatex(atoms)
    expect(latex).toContain(`\\htmlData{atom=${atoms[1].id}}{\\mathrm{e}}`)
    expect(latex).toContain(`\\htmlData{atom=${atoms[2].id}}{{-}}`)
    expect(latex).not.toContain('mathbin')
    expect(() =>
      katex.renderToString(latex, { ...KATEX_EDITOR_OPTIONS, throwOnError: true }),
    ).not.toThrow()
  })

  it('keeps operator spacing for a minus that is not an exponent sign', () => {
    const atoms = typed('2e-x')
    expect(rowToLatex(atoms)).toContain(`\\mathbin{\\htmlData{atom=${atoms[2].id}}{-}}`)
  })
})
